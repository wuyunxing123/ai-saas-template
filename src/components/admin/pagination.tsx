import Link from 'next/link'

/**
 * 简单分页控件（Server Component）。
 *
 * 通过 `basePath` + `searchParams` 生成链接，保留现有过滤条件。
 */
export function AdminPagination({
  basePath,
  page,
  totalPages,
  searchParams,
}: {
  basePath: string
  page: number
  totalPages: number
  searchParams: Record<string, string | undefined>
}) {
  if (totalPages <= 1) return null

  const buildHref = (targetPage: number) => {
    const params = new URLSearchParams()

    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== '' && key !== 'page') {
        params.set(key, value)
      }
    }

    if (targetPage > 1) params.set('page', String(targetPage))

    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  const hasPrev = page > 1
  const hasNext = page < totalPages

  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        Page {page} / {totalPages}
      </span>
      <div className="flex gap-2">
        {hasPrev ? (
          <Link
            href={buildHref(page - 1)}
            className="hover:bg-muted rounded-md border px-3 py-1.5"
          >
            Previous
          </Link>
        ) : (
          <span className="text-muted-foreground rounded-md border px-3 py-1.5 opacity-50">
            Previous
          </span>
        )}
        {hasNext ? (
          <Link
            href={buildHref(page + 1)}
            className="hover:bg-muted rounded-md border px-3 py-1.5"
          >
            Next
          </Link>
        ) : (
          <span className="text-muted-foreground rounded-md border px-3 py-1.5 opacity-50">
            Next
          </span>
        )}
      </div>
    </div>
  )
}
