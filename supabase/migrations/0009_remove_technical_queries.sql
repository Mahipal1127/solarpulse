-- Solar Pulse OS
-- Migration 0009: remove the Technical Queries feature
--
-- Technical Queries and Product Suggestions were dropped from the product. The
-- shared queue where Sales asked Technical a feasibility question is gone; IT
-- support remains, and raising a ticket now happens from the Report button in
-- every module header rather than from a page inside the Technical module.
--
-- 0008 has been edited so a fresh database never creates these objects at all.
-- This migration exists for databases where 0008 already ran: a migration is
-- applied once, so editing it in place has no effect on a database that has
-- already seen it. Both paths have to be handled, and they are handled
-- differently — that is why the definition lives in 0008 and the removal lives
-- here rather than one file trying to do both.
--
-- Everything below is `if exists`, so this is safe to apply to a database that
-- never ran the original 0008 — it becomes a no-op rather than an error. That
-- matters because the two paths converge: after this migration, a database built
-- from the edited 0008 and a database built from the original 0008 plus this file
-- have the same schema.
--
-- WHAT THIS DESTROYS: every row in technical_queries and product_suggestions,
-- irreversibly. If those queues hold anything worth keeping, export them before
-- applying this. Nothing else in the schema depends on them — no surviving table,
-- function, trigger or policy from 0008 references either one, so this removal is
-- self-contained and does not touch surveys, designs, generation reports or IT
-- tickets.
--
-- Product Suggestions goes with Queries rather than surviving on its own. It was
-- only ever reachable from the queries page and product_suggestions.technical_query_id
-- is a foreign key into technical_queries, so there is no coherent half to keep.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tables
--
-- Child before parent: product_suggestions.technical_query_id references
-- technical_queries. The FK is `on delete cascade`, which governs row deletion
-- and not DROP TABLE, so dropping the parent first would fail on the dependent
-- constraint. Ordering it this way avoids reaching for `cascade`, which would
-- also silently drop anything else that happened to depend on the table — the
-- kind of blast radius worth not granting when the explicit order is this cheap.
--
-- The indexes and RLS policies on both tables go with them automatically; there
-- is no separate drop policy / drop index needed, and naming them here would only
-- create a second list to keep in step.
-- ---------------------------------------------------------------------------

drop table if exists product_suggestions;
drop table if exists technical_queries;

-- ---------------------------------------------------------------------------
-- Enums
--
-- After the tables, never before: a type cannot be dropped while a column still
-- uses it. technical_query_status was used only by technical_queries.status and
-- product_category only by product_suggestions.product_category, so with both
-- tables gone nothing references either type.
--
-- Note product_category is NOT the same thing as Distribution's material
-- categories, which are their own vocabulary in 0007 and are untouched here.
-- ---------------------------------------------------------------------------

drop type if exists technical_query_status;
drop type if exists product_category;

-- ---------------------------------------------------------------------------
-- Seeded permission rows
--
-- 0008 seeded a `technical_queries` permission row for the Technical Manager and
-- Technical Executive roles. Those rows are live configuration rather than
-- history: permissions.module is plain text with no foreign key, so a row naming
-- a module that no longer exists is not a broken reference — it is a stale grant
-- that would show up in any permissions screen as a feature nobody can find.
--
-- Not scoped to an organization or a role on purpose. 'technical_queries' was
-- only ever written by that one seed block, so any row carrying it is stale by
-- definition, in any tenant.
-- ---------------------------------------------------------------------------

delete from permissions where module = 'technical_queries';

-- ---------------------------------------------------------------------------
-- Audit log rows are deliberately NOT deleted.
--
-- audit_logs still holds technical_query_raised, technical_query_answered,
-- technical_query_updated and product_suggested rows from before the feature was
-- removed. Those stay.
--
-- The audit log is an append-only record of what people actually did, and the
-- CEO module's security rules require every mutating action to leave one. Tidying
-- away the rows for a discontinued feature would be rewriting that record to
-- match the current schema — which is the one thing an audit trail must never do.
-- A log that only describes features that still exist cannot answer "what
-- happened last quarter", which is the question it is for.
--
-- Nothing breaks by leaving them: entity_type is text and entity_id is a bare
-- uuid with no foreign key, precisely so a log row outlives the row it describes.
-- ---------------------------------------------------------------------------
