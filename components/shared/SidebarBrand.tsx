import Image from 'next/image'
import { SIDEBAR_BRAND_ROW, SIDEBAR_BRAND_SUBTEXT } from '@/components/shared/chrome'
import logo from '@/public/logo.png'

/**
 * The Solar Pulse lockup at the top of every sidebar.
 *
 * Extracted because this exact markup was repeated in all five module layouts,
 * differing only in the text under it — and the logo is the one element that
 * absolutely must not vary between modules.
 *
 * No 'use client': this renders inside server layouts and has no interactivity.
 *
 * ABOUT THE ARTWORK
 * `logo.png` is the full lockup — sunburst, "SolarPulse" wordmark and the pulse
 * underline in one image — which is why there is no separate icon tile or text
 * wordmark here any more. Printing the name beside artwork that already contains it
 * showed the brand twice.
 *
 * The file is a derivative of `Logos/logo.png`, not that file itself: the original is
 * 1536x1024 and 955KB, of which about 61% is empty transparent margin, and nothing
 * under `Logos/` is served by Next in the first place — only `public/` is. It was
 * cropped to the visible artwork and resized to 480px wide, which is 2x the widest
 * this ever renders, and came out at 17KB. Regenerate from the original if the brand
 * changes rather than editing the derived file.
 *
 * The artwork is fully transparent outside the glyphs (no baked-in background), so it
 * sits correctly on the white sidebar. Its darkest ink measures 20:1 against white.
 *
 * Static import rather than src="/logo.png": Next reads the intrinsic dimensions from
 * the file, so the aspect ratio cannot drift out of sync with the asset and there is
 * no layout shift while it loads.
 *
 * @param subtitle Department and role line, e.g. "Sales · Manager". Omitted in the
 *   CEO module, which has no department to name.
 */
export function SidebarBrand({ subtitle }: { subtitle?: string }) {
  return (
    <div className={SIDEBAR_BRAND_ROW}>
      {/*
        `priority` because this is above the fold on every single page: left to lazy
        load, the logo visibly pops in after the rest of the sidebar has painted.
        h-auto keeps the ratio while the width class drives the size.
      */}
      <Image
        src={logo}
        alt="SolarPulse"
        priority
        className="h-auto w-40"
      />

      {subtitle && <p className={SIDEBAR_BRAND_SUBTEXT}>{subtitle}</p>}
    </div>
  )
}
