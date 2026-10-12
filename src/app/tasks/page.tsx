"use client"

/**
 * 用户任务中心 —— 列表（规格 §24）
 *
 * 最小实现：列表 + 状态 + 结果入口。不做复杂 UI、不重写前端。
 *
 * 数据来源：GET /api/ai/tasks（服务端强制按 `session.user.id` 收窄，
 * 普通用户无法枚举他人任务，见 route.ts）。
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type TaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled"

interface PublicTask {
  id: string
  status: TaskStatus
  model: string
  provider: string
  modality: string
  createdAt: string
  completedAt: string | null
  creditsUsed: number | null
  creditsRefunded: number
  retryCount: number
  assets?: { type: string; url: string; mimeType: string }[]
  error?: { code: string; retryable: boolean }
}

const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  processing: { label: "Running", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  completed: { label: "Completed", className: "bg-green-500/15 text-green-600 border-green-500/30" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-600 border-red-500/30" },
  cancelled: { label: "Cancelled", className: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30" },
}

const FILTERS: Array<{ value: "" | TaskStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "pending", label: "Queued" },
  { value: "processing", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
]

export default function TasksPage() {
  const { status: sessionStatus } = useSession()
  const router = useRouter()

  const [tasks, setTasks] = useState<PublicTask[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [status, setStatus] = useState<"" | TaskStatus>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (status) params.set("status", status)

      const res = await fetch(`/api/ai/tasks?${params.toString()}`, { cache: "no-store" })

      if (res.status === 401) {
        router.replace("/auth/signin?callbackUrl=/tasks")
        return
      }

      if (!res.ok) {
        setError("Failed to load tasks")
        return
      }

      const data = await res.json()
      setTasks(data.items ?? [])
      setTotal(data.total ?? 0)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, status, router])

  useEffect(() => {
    if (sessionStatus === "authenticated") load()
  }, [sessionStatus, load])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <main className="container mx-auto min-h-screen px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track your AI generations and their status.
          </p>
        </div>
        <Link href="/generate">
          <Button>New generation</Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setPage(1)
              setStatus(f.value)
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              status === f.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <p className="py-10 text-center text-muted-foreground">Loading…</p>}

      {!loading && error && (
        <p className="py-10 text-center text-destructive">{error}</p>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="app-floating-panel rounded-xl py-16 text-center">
          <p className="text-muted-foreground">No tasks yet.</p>
          <Link href="/generate" className="mt-3 inline-block">
            <Button variant="outline" size="sm">
              Start your first generation
            </Button>
          </Link>
        </div>
      )}

      {!loading && !error && tasks.length > 0 && (
        <div className="app-floating-panel overflow-hidden rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Credits</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const meta = STATUS_META[t.status]
                return (
                  <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Badge className={cn("border", meta.className)}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{t.model}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.provider}</td>
                    <td className="px-4 py-3">
                      {t.creditsUsed ?? "—"}
                      {t.creditsRefunded > 0 && (
                        <span className="ml-1 text-xs text-green-600">+{t.creditsRefunded} refunded</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/tasks/${t.id}`}
                        className="text-primary hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </main>
  )
}
