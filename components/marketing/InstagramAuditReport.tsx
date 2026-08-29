import { Sparkles, TriangleAlert } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/primitives'
import { formatDate, formatDateTime } from '@/lib/format'
import type { InstagramAudit, InstagramSliceStats } from '@/lib/instagram/types'

/**
 * One stored audit, rendered.
 *
 * TWO RULES RUN THROUGH EVERY CELL BELOW.
 *
 * 1. null renders as an em dash, never as 0. The whole chain — the schema, metrics.ts, the
 *    collector — treats null as "could not be read", and a 0 on screen would throw that away
 *    at the last step. `fmt` is the only thing that turns a number into text here, and it is
 *    the one place that decision lives.
 *
 * 2. Sample sizes are shown next to averages, not hidden. "4.2 avg over 3 posts" is a
 *    different claim from "4.2 avg over 40 posts", and a marketing team about to change its
 *    posting strategy needs to see which one it has.
 *
 * The narrative is the AI's reading of the figures; the figures are the audit. They are shown
 * together, in that order, so the prose can always be checked against what it was written
 * from — and when there is no prose (AI off, or the model declined) the figures still stand
 * on their own.
 */

const NBSP = '—'

/** The single place a number becomes text. null → em dash, never 0. */
function fmt(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return NBSP
  return `${value.toLocaleString('en-IN')}${suffix}`
}

/**
 * Split the model's markdown into its five sections.
 *
 * A four-line splitter rather than a markdown dependency: the prompt asks for exactly `## `
 * headings and prose, so that is all this needs to understand. Anything before the first
 * heading is kept as an untitled lead paragraph rather than dropped, so a model that ignored
 * the format still renders readably instead of silently losing its first paragraph.
 */
function splitSections(narrative: string): Array<{ heading: string | null; body: string }> {
  const parts = narrative.split(/^##\s+/m)
  const sections: Array<{ heading: string | null; body: string }> = []

  const lead = parts.shift()?.trim()
  if (lead) sections.push({ heading: null, body: lead })

  for (const part of parts) {
    const newline = part.indexOf('\n')
    if (newline === -1) {
      sections.push({ heading: part.trim(), body: '' })
    } else {
      sections.push({ heading: part.slice(0, newline).trim(), body: part.slice(newline + 1).trim() })
    }
  }
  return sections
}

export function InstagramAuditReport({ audit }: { audit: InstagramAudit }) {
  const { facts } = audit

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<Sparkles className="h-4 w-4" />}
          title={`Audit of @${facts.profile.username}`}
          subtitle={`${audit.posts_analysed} posts · ${
            audit.window_start
              ? `${formatDate(audit.window_start)} to ${formatDate(audit.window_end)}`
              : 'all stored posts'
          } · generated ${formatDateTime(audit.created_at)}${
            audit.requested_by_name ? ` by ${audit.requested_by_name}` : ''
          }`}
        />

        <div className="space-y-5 px-5 py-4">
          {audit.narrative ? (
            splitSections(audit.narrative).map((section, index) => (
              <section key={`${section.heading ?? 'lead'}-${index}`}>
                {section.heading && (
                  <h3 className="text-sm font-semibold text-brand-slate">{section.heading}</h3>
                )}
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                  {section.body}
                </p>
              </section>
            ))
          ) : (
            <div className="notice-warning rounded-xl px-4 py-3">
              <p className="text-xs font-medium">
                {audit.unavailable_reason ??
                  'No written audit was produced. The measured figures below are complete.'}
              </p>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="The figures this was written from"
          subtitle="Computed from the collected posts. The AI was given exactly these numbers and asked only to phrase them."
        />

        <div className="space-y-6 px-5 py-4">
          <HeadlineStats audit={audit} />

          <SliceTable
            title="By format"
            label="Format"
            rows={facts.by_format.map((row) => ({ label: row.media_type, ...row }))}
          />

          <SliceTable
            title="By day of week (IST)"
            label="Day"
            rows={facts.by_weekday_ist.map((row) => ({ label: row.weekday, ...row }))}
          />

          <SliceTable
            title="By time of day (IST)"
            label="Time"
            rows={facts.by_time_of_day_ist.map((row) => ({ label: row.time_of_day_ist, ...row }))}
          />

          <SliceTable
            title="By caption length"
            label="Length"
            rows={facts.by_caption_length.map((row) => ({ label: row.caption_length, ...row }))}
          />

          {facts.hashtags.top.length > 0 && (
            <SliceTable
              title={`Hashtags — ${facts.hashtags.distinct_used} distinct, ${facts.hashtags.posts_without_hashtags} posts used none`}
              label="Hashtag"
              rows={facts.hashtags.top.map((row) => ({ label: `#${row.tag}`, ...row }))}
            />
          )}

          <PostTable title="Strongest posts" posts={facts.top_posts} />
          {facts.weakest_posts.length > 0 && (
            <PostTable title="Weakest posts" posts={facts.weakest_posts} />
          )}

          {facts.caption_keywords.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Recurring caption words
              </h4>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {facts.caption_keywords.map((entry) => (
                  <span
                    key={entry.word}
                    className="rounded-full bg-surface-bg px-2.5 py-1 text-xs text-text-muted"
                  >
                    {entry.word}
                    <span className="ml-1 text-[10px] opacity-60">{entry.posts}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Shown last and shown plainly. These are facts about the DATA, and a reader
              deciding how much weight to put on the audit needs them. */}
          <div>
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <TriangleAlert className="h-3.5 w-3.5" />
              What could not be measured
            </h4>
            <ul className="mt-2 space-y-1">
              {facts.data_gaps.map((gap) => (
                <li key={gap} className="text-xs leading-relaxed text-text-muted">
                  · {gap}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}

function HeadlineStats({ audit }: { audit: InstagramAudit }) {
  const { facts } = audit
  const stats = [
    { label: 'Followers', value: fmt(facts.profile.followers) },
    { label: 'Posts analysed', value: fmt(facts.window.posts_analysed) },
    { label: 'Avg engagement', value: fmt(facts.engagement.avg_engagement_rate_pct, '%') },
    { label: 'Avg likes', value: fmt(facts.engagement.avg_likes) },
    { label: 'Avg comments', value: fmt(facts.engagement.avg_comments) },
    { label: 'Posts / week', value: fmt(facts.cadence.posts_per_week) },
    { label: 'Longest gap', value: fmt(facts.cadence.longest_gap_days, ' days') },
    { label: 'Days since last', value: fmt(facts.cadence.days_since_last_post) },
  ]

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-surface-bg px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">{stat.label}</p>
            <p className="mt-0.5 text-lg font-semibold text-brand-slate">{stat.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
        {facts.engagement.metric_definition}
      </p>
    </div>
  )
}

/** Every performance table has the same columns, so it has one component. */
function SliceTable({
  title,
  label,
  rows,
}: {
  title: string
  label: string
  rows: Array<InstagramSliceStats & { label: string }>
}) {
  if (rows.length === 0) return null

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h4>
      {/* Own scroll container: a wide table must never make the page scroll sideways. */}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead>
            <tr className="border-b border-border-subtle text-text-muted">
              <th className="py-1.5 pr-3 font-medium">{label}</th>
              <th className="py-1.5 pr-3 font-medium">Posts</th>
              <th className="py-1.5 pr-3 font-medium">Avg likes</th>
              <th className="py-1.5 pr-3 font-medium">Avg comments</th>
              <th className="py-1.5 pr-3 font-medium">Avg engagement</th>
              <th className="py-1.5 font-medium">Measured on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border-subtle/60 last:border-0">
                <td className="py-1.5 pr-3 font-medium text-brand-slate">{row.label}</td>
                <td className="py-1.5 pr-3 text-text-muted">{fmt(row.posts)}</td>
                <td className="py-1.5 pr-3 text-text-muted">{fmt(row.avg_likes)}</td>
                <td className="py-1.5 pr-3 text-text-muted">{fmt(row.avg_comments)}</td>
                <td className="py-1.5 pr-3 text-text-muted">
                  {fmt(row.avg_engagement_rate_pct, '%')}
                </td>
                {/* The denominator, in plain sight. An average over 2 of 30 posts is a
                    different claim from one over 30, and this column is where a reader
                    sees which they are looking at. */}
                <td className="py-1.5 text-text-muted">
                  {row.engagement_sample === row.posts
                    ? `all ${row.posts}`
                    : `${row.engagement_sample} of ${row.posts}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PostTable({
  title,
  posts,
}: {
  title: string
  posts: InstagramAudit['facts']['top_posts']
}) {
  if (posts.length === 0) return null

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h4>
      <ul className="mt-2 space-y-2">
        {posts.map((post) => (
          <li key={post.shortcode} className="rounded-xl bg-surface-bg px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              <a
                href={`https://www.instagram.com/p/${post.shortcode}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-slate underline decoration-dotted underline-offset-2"
              >
                {post.shortcode}
              </a>
              {post.media_type && <span>{post.media_type}</span>}
              {post.posted_at_ist && <span>{post.posted_at_ist.replace('T', ' ')}</span>}
              <span>{fmt(post.likes)} likes</span>
              <span>{fmt(post.comments)} comments</span>
              {post.views !== null && <span>{fmt(post.views)} views</span>}
              <span className="font-medium text-brand-slate">
                {fmt(post.engagement_rate_pct, '%')}
              </span>
            </div>
            {post.caption_excerpt && (
              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-text-muted">
                {post.caption_excerpt}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
