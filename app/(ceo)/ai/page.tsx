import 'server-only'

import { redirect } from 'next/navigation'

/**
 * The assistant used to live here as its own page. It is now docked on the
 * dashboard, where the numbers it talks about are on screen and a confirmed action
 * repaints them in place.
 *
 * A redirect rather than a deleted file: this URL has been in the nav for the whole
 * life of the app, so it is in browser history and quite possibly in an open tab.
 * Deleting the route would 404 those; sending them to the assistant's new home costs
 * one file and no confusion.
 *
 * `/ai/settings` is unaffected — it is a sibling route with its own page, still
 * reachable from the sidebar footer and from the dashboard panel's Settings link.
 */
export default function AIAssistantPage() {
  redirect('/dashboard')
}
