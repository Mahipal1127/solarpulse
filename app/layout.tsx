import type { Metadata } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import './globals.css'

/**
 * Inter for everything the user reads. The brand guidelines name no typeface, and
 * leaving the Next.js default (Geist) in place was a non-decision rather than a
 * choice. Inter is picked for legibility at 11–13px across long tables, which is
 * most of this app — not for character. No display face: a data-dense internal
 * tool has nothing to gain from one.
 *
 * Geist Mono stays for the one place a monospace belongs — tender reference
 * numbers, where digits need to align and 0/O must not be confused.
 */
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Solar Pulse OS',
  description: 'Executive command centre for Solar Pulse',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full bg-surface-bg text-text-muted">{children}</body>
    </html>
  )
}
