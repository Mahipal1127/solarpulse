'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { formatCompactCurrency } from '@/lib/format'

export interface CashFlowPoint {
  date: string
  inflow: number
  outflow: number
}

/**
 * Daily inflow vs outflow over the period. Inflow uses the success token, outflow the danger
 * token — the same money-direction colour language as the cash-flow badges. Colours are CSS
 * vars so the chart tracks the theme, mirroring the CEO KPI chart. Data is aggregated
 * server-side (getCashFlowSeries, which logs the access); this component only draws it.
 */
export function CashFlowChart({ data }: { data: CashFlowPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-bg">
        <p className="max-w-xs px-4 text-center text-xs text-text-muted">
          No cash movement in this window yet. Receipts and payments will populate the chart.
        </p>
      </div>
    )
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
            tickFormatter={(v) => formatCompactCurrency(Number(v))}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--chart-tooltip-bg)',
              borderRadius: '12px',
              border: 'none',
              color: 'var(--chart-tooltip-text)',
              fontSize: '12px',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
            }}
            formatter={(val, name) => [formatCompactCurrency(Number(val ?? 0)), name]}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar dataKey="inflow" name="Inflow" fill="var(--status-success)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="outflow" name="Outflow" fill="var(--status-danger)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
