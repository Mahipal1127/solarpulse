'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/primitives'
import { AllocationForm } from './AllocationForm'

/**
 * Collapsed-by-default wrapper around AllocationForm, matching the inline-form
 * pattern the Sales lead detail sections use: the board is the point of the page,
 * so the form stays out of the way until someone asks for it.
 */
export function AllocationFormPanel({ projects }: { projects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange"
      >
        <Plus className="h-4 w-4" />
        Allocate material
      </button>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Allocate material to a project"
        subtitle="Distribution's plan record — not a warehouse stock reservation"
      />
      <div className="px-5 py-5">
        <AllocationForm projects={projects} onDone={() => setOpen(false)} />
      </div>
    </Card>
  )
}
