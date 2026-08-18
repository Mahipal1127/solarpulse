'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, EXPENSE_CATEGORY_LABELS } from '@/lib/format'
import { EXPENSE_CATEGORIES, EXPENSE_APPROVAL_THRESHOLD } from '@/lib/finance/constants'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Records an expense. POSTs to /api/expenses, which runs record_expense() — expense row +
 * matching cash-flow outflow, one transaction.
 *
 * Two domain rules surface in the UI:
 *  - salary_disbursement expenses may carry a linked_salary_record_id. It is an OPTIONAL
 *    reference (a bare audit FK back to HR's record); the amount is Finance's own figure,
 *    entered here — Finance never reads HR's protected salary rows to fill it in.
 *  - at or above the (client-confirmed PLACEHOLDER) approval threshold, an approval_id is
 *    required. The threshold flow is wired; the number is a one-line constant change.
 */
export function ExpenseForm() {
  const router = useRouter()
  const [category, setCategory] = useState('office_supplies')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState('')
  const [approvalId, setApprovalId] = useState('')
  const [salaryRecordId, setSalaryRecordId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountNum = Number(amount) || 0
  const needsApproval = amountNum >= EXPENSE_APPROVAL_THRESHOLD
  const isSalary = category === 'salary_disbursement'

  async function save() {
    if (amountNum <= 0) return setError('Enter an amount greater than zero.')
    if (needsApproval && !approvalId.trim()) {
      return setError(
        `Expenses of ${formatCurrency(EXPENSE_APPROVAL_THRESHOLD)} or more need a linked CEO approval.`
      )
    }

    setPending(true)
    setError(null)

    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category,
        description: description.trim() || null,
        amount: amountNum,
        expense_date: expenseDate || null,
        approval_id: approvalId.trim() || null,
        linked_salary_record_id: isSalary && salaryRecordId.trim() ? salaryRecordId.trim() : null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not record the expense.')
      return
    }
    router.push('/finance/expenses')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="exp-category" className={labelClass}>
            Category
          </label>
          <select
            id="exp-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="exp-amount" className={labelClass}>
            Amount
          </label>
          <input
            id="exp-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="exp-date" className={labelClass}>
            Expense date
          </label>
          <input
            id="exp-date"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="exp-desc" className={labelClass}>
            Description
          </label>
          <input
            id="exp-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional note"
            className={inputClass}
          />
        </div>
      </div>

      {isSalary && (
        <div>
          <label htmlFor="exp-salary" className={labelClass}>
            Linked salary record ID
          </label>
          <input
            id="exp-salary"
            value={salaryRecordId}
            onChange={(e) => setSalaryRecordId(e.target.value)}
            placeholder="Optional — HR salary record UUID"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-text-muted">
            Links this disbursement back to HR&apos;s salary record for audit. The amount above is
            Finance&apos;s own figure — salary details are not read from here.
          </p>
        </div>
      )}

      {needsApproval && (
        <div className="notice-warning rounded-lg px-4 py-3">
          <p className="text-xs font-medium">
            This expense is at or above {formatCurrency(EXPENSE_APPROVAL_THRESHOLD)} and needs a CEO
            approval linked before it can be recorded.
          </p>
          <label htmlFor="exp-approval" className={`${labelClass} mt-2`}>
            Approval ID
          </label>
          <input
            id="exp-approval"
            value={approvalId}
            onChange={(e) => setApprovalId(e.target.value)}
            placeholder="Approval UUID"
            className={inputClass}
          />
        </div>
      )}

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Recording…' : 'Record expense'}
      </button>
    </div>
  )
}
