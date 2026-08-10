/**
 * Shared class strings for the app shell: the sidebar, its logo lockup, its nav
 * items, and the filter pills / tabs used across every module.
 *
 * These lived as copy-pasted literals in five sidebar components (CEO, Tender,
 * Sales, Distribution, Technical) that were byte-identical to each other, and the
 * pill styling was duplicated again in every list page. Re-theming meant the same
 * edit five or ten times, and whoever tweaked a hover state next would have fixed
 * one module and left the others behind — which is how an app ends up looking like
 * separate builds stitched together.
 *
 * Plain strings rather than a component, deliberately: the five sidebars differ in
 * how they decide `active` (the CEO's /ai needs an exact match, the others
 * prefix-match) and in what they render around the nav, so a shared component would
 * need props for all of it. Only the styling is genuinely common, so only the
 * styling is shared. No 'use client' — a module of constants is importable from both
 * server layouts and client components.
 *
 * THE SURFACE RULE
 * Chrome is light: the sidebar and top bar are `surface-card` white, separated from
 * the `surface-bg` page by a hairline `border-subtle`. An earlier revision made
 * them navy; that was a regression and is corrected here. Do not reintroduce
 * `bg-brand-navy` — that token is reserved and must not back any chrome.
 *
 * WHERE GOLD GOES
 * Gold marks state, not surface. The active nav item is a *solid* gold pill with
 * white text and its icon in a lightened square — the confident treatment, matching
 * the InsightHub reference this system is styled after. An earlier revision used a
 * 10% tint here; solid is the settled answer, so do not soften it back.
 *
 * Selected filter pills are solid gold too. What keeps that from turning into noise
 * is scarcity everywhere else: hover is neutral grey, inactive icons are grey, and
 * general chrome (search, bell, help) is grey. Gold should land in a handful of
 * deliberate places per screen — the active nav item, the primary action, one
 * highlighted chart bar — and nowhere else. That restraint is what makes it read as
 * a signal rather than decoration.
 */

/** The sidebar column itself. */
export const SIDEBAR_SHELL =
  'flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface-card'

/**
 * The logo row at the top of the sidebar. A column, not a row: the logo artwork is
 * a wide lockup (roughly 3.5:1) that already contains the wordmark, so the
 * department line sits underneath it rather than beside it.
 */
export const SIDEBAR_BRAND_ROW =
  'flex flex-col items-start gap-1.5 border-b border-border-subtle px-5 py-4'

/**
 * The department/role line under the logo, where a module shows one.
 *
 * `SIDEBAR_BRAND_MARK` and `SIDEBAR_BRAND_TEXT` used to live here — a slate tile
 * holding an inline SVG glyph, plus a text wordmark. Both are gone: the real logo
 * is one image containing mark and wordmark together, so a separate tile and a
 * second copy of the name would duplicate it.
 */
export const SIDEBAR_BRAND_SUBTEXT = 'truncate text-xs text-text-muted'

/** The scrolling nav body below the logo. */
export const SIDEBAR_BODY = 'flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4'

/** Divider above a sidebar's footer group ("Back to CEO", AI Settings). */
export const SIDEBAR_FOOTER_GROUP = 'space-y-1 border-t border-border-subtle pt-4'

/**
 * A nav link. Solid gold pill when active, plain row when not.
 *
 * `gap-2` rather than the roomier gap used before: the icon now carries its own
 * padding (see navIconClass), so the visual gap between glyph and label is that
 * padding plus this gap.
 */
export function navItemClass(active: boolean): string {
  return [
    'group flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
    active
      ? 'bg-brand-gold text-white'
      : 'text-text-muted hover:bg-surface-bg hover:text-brand-slate',
  ].join(' ')
}

/**
 * The icon inside a nav link, sitting in a small rounded square — lightened white
 * on the gold pill, invisible otherwise.
 *
 * `box-content` with padding on both states is deliberate: the square must occupy
 * the same space whether or not it is filled. Give the box to the active state
 * alone and every item in the sidebar shifts a few pixels the moment you navigate.
 * `bg-white/20` rather than solid white, so the square reads as a lighter panel
 * within the pill instead of a hard white chip fighting the label beside it.
 */
export function navIconClass(active: boolean): string {
  return [
    'h-4 w-4 shrink-0 box-content rounded-lg p-1.5 transition-colors',
    active ? 'bg-white/20 text-white' : 'text-text-muted group-hover:text-brand-slate',
  ].join(' ')
}

/**
 * A small caption above a nav group ("Dashboard" in the reference). Exported for
 * sidebars that have a genuinely named group — not applied to groups whose names
 * would have to be invented, since this pass is styling and inventing navigation
 * copy is not.
 */
export const SIDEBAR_SECTION_LABEL =
  'px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted'

/**
 * A free-standing filter chip — the "All / Open / In Progress / Resolved / Closed"
 * rows above the Technical and approvals lists, which sit loose on a surface with
 * nothing drawn around them.
 *
 * Solid gold when selected, unlike the sidebar's tint: these are small, transient
 * controls where a strong fill is unambiguous feedback rather than a permanent
 * loud object. Unselected chips carry their own hairline, because without one a
 * row of untinted labels on a near-white surface does not read as a set of
 * controls at all.
 */
export function pillClass(selected: boolean): string {
  return [
    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
    // `border` sits in the shared half above and both branches set a colour, so the
    // box is the same size either way. Put a border on only one state and every pill
    // in the row jumps 2px the moment you click it.
    selected
      ? 'border-brand-gold bg-brand-gold text-white'
      : 'border-border-subtle bg-surface-card text-text-muted hover:bg-surface-bg',
  ].join(' ')
}

/**
 * The track a segmented control sits in. Holds the single hairline and the inset
 * padding that lets the selected option's fill sit inside the border.
 *
 * No shadow: Part 7 of the design system reserves `shadow-sm` for things that
 * genuinely float above the page — modals and dropdowns — and a toggle welded to
 * the page is not one of them.
 */
export const SEGMENT_TRACK =
  'flex gap-1 rounded-lg border border-border-subtle bg-surface-card p-1'

/**
 * One option inside SEGMENT_TRACK — the board/list switch, the approvals status
 * strip, the dashboards' My work / Team toggles.
 *
 * Deliberately NOT pillClass: the track already draws a border, so an unselected
 * option that drew its own would double the hairline and box every option
 * separately. Same gold-when-selected rule, no border of its own.
 */
export function segmentClass(selected: boolean): string {
  return [
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    selected
      ? 'bg-brand-gold text-white'
      : 'text-text-muted hover:bg-surface-bg hover:text-brand-slate',
  ].join(' ')
}

/**
 * An underline-style tab, for strips that sit directly on a card edge (CEO
 * Analytics) where a pill or a track would fight the border already there.
 *
 * `-mb-px` pulls the active underline over the container's hairline instead of
 * stacking a gold line on top of a grey one.
 */
export function tabClass(selected: boolean): string {
  return [
    '-mb-px border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors',
    selected
      ? 'border-brand-gold text-brand-gold'
      : 'border-transparent text-text-muted hover:text-brand-slate',
  ].join(' ')
}
