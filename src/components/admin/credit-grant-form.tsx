'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Admin 积分发放表单（Client Component）。
 *
 * 调用 `POST /api/admin/users/[id]/credits`（服务端统一鉴权 + 原子发放 + 审计）。
 * 不直接访问数据库。
 */
export function CreditGrantForm({ userId }: { userId: string }) {
  const router = useRouter()

  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(
    null
  )

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setMessage(null)

    const numericAmount = Number(amount)

    if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
      setMessage({ type: 'error', text: 'Amount must be a positive integer.' })
      return
    }

    if (!reason.trim()) {
      setMessage({ type: 'error', text: 'Reason is required.' })
      return
    }

    setPending(true)

    try {
      const response = await fetch(`/api/admin/users/${userId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: numericAmount, reason: reason.trim() }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setMessage({
          type: 'error',
          text: data.error || `Request failed (${response.status})`,
        })
        return
      }

      setMessage({
        type: 'ok',
        text: `Granted ${numericAmount} credits. New balance: ${data.balance}.`,
      })
      setAmount('')
      setReason('')
      router.refresh()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Network error',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="grant-amount" className="text-muted-foreground text-xs">
            Amount
          </label>
          <input
            id="grant-amount"
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="100"
            className="h-9 w-32 rounded-md border bg-transparent px-3 text-sm"
            required
          />
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="grant-reason" className="text-muted-foreground text-xs">
            Reason
          </label>
          <input
            id="grant-reason"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Customer support compensation"
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            required
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-md border px-4 text-sm disabled:opacity-50"
        >
          {pending ? 'Granting…' : 'Grant credits'}
        </button>
      </div>

      {message && (
        <p
          className={
            message.type === 'ok'
              ? 'text-sm text-green-600'
              : 'text-sm text-destructive'
          }
        >
          {message.text}
        </p>
      )}
    </form>
  )
}
