"use client"

/**
 * 用户任务中心 —— 详情（规格 §24 + §13）
 *
 * 任务在后台异步推进。本页在状态仍为 pending / processing 时，
 * **客户端**每隔几秒重新拉取 GET /api/ai/tasks/:id（规格 §13 的「查询状态」）。
 * 服务端该接口会 lazy 触发一次 Provider 轮询（route.ts），
 * 所以异步 Provider 的结果最终会自动出现，无需手动刷新。
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useParams, useRouter } from "next/navigation"
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
  prompt?: string | null
}

const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  processing: { label: "Running", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  completed: { label: "Completed", className: "bg-green-500/15 text-green-600 border-green-500/30" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-600 border-red-500/30" },
  cancelled: { label: "Cancelled", className: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30" },
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>()
  const { status: sessionStatus } = useSession()
  const router = useRouter()
  const id = params.id

  const [task, setTask] = useState<PublicTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/tasks/${id}`, { cache: "no-store" })

      if (res.status === 401) {
        router.replace("/auth/signin?callbackUrl=/tasks")
        return
      }
      if (res.status === 404) {
        setNotFound(true)
        setLoading(false)
        return
      }
      if (!res.ok) {
        setError("Failed to load task")
        setLoading(false)
        return
      }

      const data = await res.json()
      setTask(data.task)
      setLoading(false)
    } catch {
      setError("Network error")
      setLoading(false)
    }
  }, [id, router])

  useEffect(() => {
    if (sessionStatus !== "authenticated") return
    load()

    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [sessionStatus, load])

  // 活跃态轮询
  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (!task) return

    const active = task.status === "pending" || task.status === "processing"
    if (!active) return

    timer.current = setInterval(() => {
      load()
    }, 4000)

    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [task, load])

  if (loading) {
    return (
      <main className="container mx-auto min-h-screen px-4 py-10">
        <p className="text-center text-muted-foreground">Loading…</p>
      </main>
    )
  }

  if (notFound) {
    return (
      <main className="container mx-auto min-h-screen px-4 py-10">
        <div className="app-floating-panel rounded-xl py-16 text-center">
          <p className="text-muted-foreground">Task not found.</p>
          <Link href="/tasks" className="mt-3 inline-block">
            <Button variant="outline" size="sm">
              Back to tasks
            </Button>
          </Link>
        </div>
      </main>
    )
  }

  if (error || !task) {
    return (
      <main className="container mx-auto min-h-screen px-4 py-10">
        <p className="text-center text-destructive">{error ?? "Something went wrong"}</p>
      </main>
    )
  }

  const meta = STATUS_META[task.status]
  const active = task.status === "pending" || task.status === "processing"

  return (
    <main className="container mx-auto min-h-screen px-4 py-10">
      <Link href="/tasks" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to tasks
      </Link>

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Task</h1>
        <Badge className={cn("border", meta.className)}>{meta.label}</Badge>
        {active && (
          <span className="text-xs text-muted-foreground">Auto-refreshing…</span>
        )}
      </div>

      <dl className="app-floating-panel mt-6 grid grid-cols-2 gap-4 rounded-xl p-5 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Model</dt>
          <dd className="mt-1 font-mono text-xs">{task.model}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Provider</dt>
          <dd className="mt-1">{task.provider}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Credits</dt>
          <dd className="mt-1">
            {task.creditsUsed ?? "—"}
            {task.creditsRefunded > 0 && (
              <span className="ml-1 text-xs text-green-600">+{task.creditsRefunded} refunded</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Created</dt>
          <dd className="mt-1">{new Date(task.createdAt).toLocaleString()}</dd>
        </div>
      </dl>

      {task.prompt && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Prompt</h2>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-accent/40 p-3 text-sm">{task.prompt}</p>
        </div>
      )}

      {task.error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
          Generation failed{active ? " (retrying…)" : ""}.
          {task.error.retryable && task.retryCount > 0 && (
            <span className="ml-1">Retry {task.retryCount}.</span>
          )}
        </div>
      )}

      {task.assets && task.assets.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Result</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {task.assets.map((asset, i) => (
              <a
                key={i}
                href={asset.url}
                target="_blank"
                rel="noopener noreferrer"
                className="app-floating-panel block overflow-hidden rounded-lg"
              >
                {/* 业务层只依赖统一 result，不感知 provider raw response */}
                <img
                  src={asset.url}
                  alt={`result ${i + 1}`}
                  className="h-48 w-full object-cover"
                />
              </a>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
