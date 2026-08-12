/**
 * One JSON Schema, three provider dialects.
 *
 * lib/ai/proposalSchema.ts declares AI_TURN_JSON_SCHEMA once and every provider has
 * to be handed its own spelling of it. The differences are not cosmetic — each of
 * the three rejects something the others require, so a single shared object sent
 * verbatim to all three produces a 400 from at least two of them.
 *
 * WHAT EACH DIALECT DEMANDS
 *
 *   Anthropic  Accepts the schema as written. `additionalProperties: false`,
 *              `type: ['string','null']` and a null inside `enum` are all fine.
 *              This is the shape the file was authored in, so: pass through.
 *
 *   OpenAI     Strict mode *requires* `additionalProperties: false` on every
 *              object and every property listed in `required` — which is exactly
 *              why the schema already looks the way it does. Nullable is spelled
 *              `type: ['string','null']`, same as ours. The one shaky spot is a
 *              null inside an `enum`; see toOpenAISchema below.
 *
 *   Gemini     The strictest and the most different. `responseSchema` is a subset
 *              of OpenAPI 3.0, parsed as a protobuf message, which means an
 *              unrecognised key is a hard error rather than something ignored:
 *                - `additionalProperties` does not exist        → must be removed
 *                - `type` is a single enum, never an array       → 'STRING', not ['string','null']
 *                - the enum names are UPPERCASE and case-sensitive (proto3 JSON
 *                  matches the enum name, so 'string' is not 'STRING')
 *                - nullability is a sibling flag, `nullable: true`
 *                - `enum` members must be strings; a null in the list is invalid
 *
 * WHY DEGRADING THE SCHEMA IS SAFE
 * None of this is a security boundary. Whatever comes back is parsed by
 * `aiTurnSchema` (zod) and then by `validateProposal()`, and the proposal is
 * re-read from the database in /api/ai/confirm before anything is written. The
 * JSON schema is there to make the model's output well-formed on the first try,
 * not to enforce the contract — so where a dialect cannot express a constraint,
 * dropping it costs a retry at worst and never lets a bad action through.
 */

type JsonSchema = Record<string, unknown>

const isObject = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Splits our `type` into a single type plus a nullable flag.
 * `['string','null']` → `{ type: 'string', nullable: true }`
 */
function splitType(raw: unknown): { type: string | null; nullable: boolean } {
  if (typeof raw === 'string') return { type: raw, nullable: false }
  if (Array.isArray(raw)) {
    const types = raw.filter((t): t is string => typeof t === 'string')
    const nullable = types.includes('null')
    const concrete = types.find((t) => t !== 'null') ?? null
    return { type: concrete, nullable }
  }
  return { type: null, nullable: false }
}

/** Enum members minus the null, and whether one was there. */
function splitEnum(raw: unknown): { values: unknown[]; hadNull: boolean } {
  if (!Array.isArray(raw)) return { values: [], hadNull: false }
  return {
    values: raw.filter((v) => v !== null),
    hadNull: raw.some((v) => v === null),
  }
}

/**
 * Anthropic and, for now, the pass-through baseline.
 *
 * Returned as a deep clone rather than the original object. AI_TURN_JSON_SCHEMA is
 * declared `as const` and shared across requests; handing the same reference to an
 * SDK that might annotate it in place would corrupt it for every later call.
 */
export function toAnthropicSchema(schema: JsonSchema): JsonSchema {
  return structuredClone(schema) as JsonSchema
}

/**
 * OpenAI strict mode.
 *
 * The one transform: a nullable enum loses its `enum` list, and the permitted
 * values are folded into the description instead.
 *
 * Our `priority` field is `type: ['string','null']` with `enum: ['low',…,null]`.
 * OpenAI documents `type: ['string','null']` as the way to express nullable and
 * documents `enum` for closed sets, but a null *member* inside the list sits in
 * the gap between those two rules and is the kind of thing that earns an opaque
 * "invalid schema" 400. Rather than gamble on it, the constraint moves into prose
 * — the model reads the description, and zod still rejects a value outside the set
 * on the way back in, so nothing is actually unenforced.
 *
 * Non-nullable enums (`kind`, `action`) keep their `enum` untouched; those are the
 * ones that matter most for well-formedness and they are unambiguously legal.
 */
export function toOpenAISchema(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!isObject(node)) return node

    const out: JsonSchema = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && isObject(value)) {
        out.properties = Object.fromEntries(
          Object.entries(value).map(([name, sub]) => [name, walk(sub)])
        )
        continue
      }
      out[key] = key === 'items' ? walk(value) : value
    }

    const { nullable } = splitType(out.type)
    const { values, hadNull } = splitEnum(out.enum)

    if (nullable && hadNull && values.length > 0) {
      delete out.enum
      const allowed = `Allowed values: ${values.map((v) => JSON.stringify(v)).join(', ')}, or null.`
      out.description = out.description ? `${out.description} ${allowed}` : allowed
    }

    return out
  }

  return walk(structuredClone(schema)) as JsonSchema
}

/** Maps a JSON Schema type to Gemini's uppercase Type enum name. */
const GEMINI_TYPES: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
}

/**
 * Gemini `responseSchema`.
 *
 * Rebuilt key by key rather than filtered, because the parser rejects unknown
 * fields outright: an allowlist fails safe when this schema later grows a keyword
 * Gemini has never heard of, whereas a blocklist would silently pass it through
 * and 400 at request time.
 *
 * `propertyOrdering` is set from `required`. It is Gemini-specific and optional,
 * but without it the field order in the generated JSON is unspecified — and since
 * the model writes JSON as a token stream, giving it a stable order measurably
 * improves how often the result parses.
 */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (!isObject(node)) return node

    const out: JsonSchema = {}

    const { type, nullable } = splitType(node.type)
    if (type) {
      const mapped = GEMINI_TYPES[type]
      if (mapped) out.type = mapped
    }

    // `nullable` covers both spellings: a 'null' member in the type array, and a
    // null inside the enum list — Gemini expresses either as this one flag.
    const { values, hadNull } = splitEnum(node.enum)
    if (nullable || hadNull) out.nullable = true

    if (typeof node.description === 'string') out.description = node.description

    // Gemini takes enum members as strings only, and only on a STRING type.
    if (values.length > 0 && out.type === 'STRING') {
      out.enum = values.map((v) => String(v))
    }

    if (isObject(node.properties)) {
      out.properties = Object.fromEntries(
        Object.entries(node.properties).map(([name, sub]) => [name, walk(sub)])
      )
    }

    if (Array.isArray(node.required)) {
      const required = node.required.filter((r): r is string => typeof r === 'string')
      if (required.length > 0) {
        out.required = required
        // Same list, second purpose: a deterministic emission order.
        out.propertyOrdering = required
      }
    }

    if (node.items !== undefined) out.items = walk(node.items)

    /*
     * Deliberately not copied: additionalProperties (no such field), $schema,
     * title, default, examples, format, minimum/maximum, anyOf/oneOf/allOf. None
     * of those appear in AI_TURN_JSON_SCHEMA today; if one is added later it is
     * dropped here rather than sent and rejected. The zod parse on the way back is
     * what actually enforces the contract.
     */

    return out
  }

  return walk(structuredClone(schema)) as JsonSchema
}
