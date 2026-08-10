'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import type { Department, AppUser } from '@/lib/types'

// Mirrors createTaskSchema but takes browser-native form values (datetime-local
// string, '' for empty selects) and converts them at submit time.
const formSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().trim().max(5000).optional(),
  assigned_department_id: z.string().uuid('Select a department'),
  assigned_user_id: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  due_date: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-slate'

export function CreateTaskForm({
  departments,
  users,
}: {
  departments: Department[]
  users: Pick<AppUser, 'id' | 'full_name' | 'department_id'>[]
}) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [serverError, setServerError] = useState<string | null>(null)
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { priority: 'medium' },
  })

  const selectedDepartment = watch('assigned_department_id')
  const eligibleAssignees = users.filter((u) => u.department_id === selectedDepartment)

  async function onSubmit(values: FormValues) {
    setServerError(null)
    setUploadNote(null)

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: values.title,
        description: values.description || null,
        assigned_department_id: values.assigned_department_id,
        assigned_user_id: values.assigned_user_id || null,
        priority: values.priority,
        due_date: values.due_date ? new Date(values.due_date).toISOString() : null,
      }),
    })

    const body = await res.json()
    if (!res.ok) {
      setServerError(body.error ?? 'Could not create the task.')
      return
    }

    if (files.length > 0) {
      const failed = await uploadAttachments(body.task.id, files)
      if (failed.length > 0) {
        // The task exists; surface the partial failure instead of silently
        // dropping the files.
        setUploadNote(`Task created, but these files failed to upload: ${failed.join(', ')}`)
        return
      }
    }

    router.push(`/tasks/${body.task.id}`)
    router.refresh()
  }

  async function uploadAttachments(taskId: string, selected: File[]): Promise<string[]> {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return selected.map((f) => f.name)

    const failed: string[] = []

    for (const file of selected) {
      const path = `${taskId}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('task-attachments')
        .upload(path, file)

      if (uploadError) {
        failed.push(file.name)
        continue
      }

      const { error: rowError } = await supabase.from('task_attachments').insert({
        task_id: taskId,
        file_path: path,
        file_name: file.name,
        uploaded_by: user.id,
      })
      if (rowError) failed.push(file.name)
    }

    return failed
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-text-muted">
          Title
        </label>
        <input id="title" {...register('title')} className={inputClass} />
        {errors.title && <p className="mt-1 text-xs text-status-danger">{errors.title.message}</p>}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-text-muted">
          Description
        </label>
        <textarea id="description" rows={4} {...register('description')} className={inputClass} />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor="assigned_department_id"
            className="block text-sm font-medium text-text-muted"
          >
            Department <span className="text-status-danger">*</span>
          </label>
          <select
            id="assigned_department_id"
            {...register('assigned_department_id')}
            className={inputClass}
            defaultValue=""
          >
            <option value="" disabled>
              Select a department
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {errors.assigned_department_id && (
            <p className="mt-1 text-xs text-status-danger">{errors.assigned_department_id.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="assigned_user_id" className="block text-sm font-medium text-text-muted">
            Assignee
          </label>
          <select
            id="assigned_user_id"
            {...register('assigned_user_id')}
            className={inputClass}
            disabled={!selectedDepartment}
          >
            <option value="">Unassigned</option>
            {eligibleAssignees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
          {selectedDepartment && eligibleAssignees.length === 0 && (
            <p className="mt-1 text-xs text-text-muted">No users in this department yet.</p>
          )}
        </div>

        <div>
          <label htmlFor="priority" className="block text-sm font-medium text-text-muted">
            Priority
          </label>
          <select id="priority" {...register('priority')} className={inputClass}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <div>
          <label htmlFor="due_date" className="block text-sm font-medium text-text-muted">
            Due date
          </label>
          <input
            id="due_date"
            type="datetime-local"
            {...register('due_date')}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="attachments" className="block text-sm font-medium text-text-muted">
          Attachments
        </label>
        <input
          id="attachments"
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="mt-1 block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-bg file:px-3 file:py-2 file:text-sm file:font-medium"
        />
        {files.length > 0 && (
          <p className="mt-1 text-xs text-text-muted">{files.length} file(s) selected</p>
        )}
      </div>

      {serverError && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">{serverError}</p>
      )}
      {uploadNote && (
        <p className="rounded-lg bg-status-warning/5 px-3 py-2 text-sm text-status-warning">{uploadNote}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange disabled:opacity-60"
      >
        {isSubmitting ? 'Creating…' : 'Create task'}
      </button>
    </form>
  )
}
