'use client'

import { useSyncExternalStore } from 'react'

/**
 * The kiosk header clock. A door screen that shows the time proves it is
 * awake — a live kiosk and a hung one look identical otherwise.
 *
 * The clock is an external store, read through useSyncExternalStore: the
 * static build (and the hydration pass) reads the server snapshot — null, so
 * the header renders a quiet placeholder and never mismatches — and the live
 * page re-reads a minute-bucketed value every second, so the displayed minute
 * rolls over within a second of the real one while re-rendering only once a
 * minute.
 */
function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, 1_000)
  return () => window.clearInterval(id)
}

let cachedNow: Date | null = null
let cachedMinute = -1

function getSnapshot(): Date | null {
  const minute = Math.floor(Date.now() / 60_000)
  if (cachedNow === null || minute !== cachedMinute) {
    cachedMinute = minute
    cachedNow = new Date()
  }
  return cachedNow
}

function getServerSnapshot(): Date | null {
  return null
}

export function KioskClock() {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (!now) {
    return (
      <div aria-hidden className="hidden text-right sm:block">
        <p className="text-sm font-semibold tabular-nums text-brand-slate/30">--:--</p>
        <p className="text-[11px] text-text-muted/40">—</p>
      </div>
    )
  }

  return (
    <div className="hidden text-right sm:block">
      <p className="text-sm font-semibold tabular-nums text-brand-slate">
        {new Intl.DateTimeFormat('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(now)}
      </p>
      <p className="text-[11px] text-text-muted">
        {new Intl.DateTimeFormat('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(now)}
      </p>
    </div>
  )
}