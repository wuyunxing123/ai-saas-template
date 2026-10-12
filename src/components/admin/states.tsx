/**
 * Admin 页面通用状态组件：Loading / Empty / Error。
 */

export function AdminEmpty({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground rounded-md border border-dashed px-6 py-12 text-center text-sm">
      {message}
    </div>
  )
}

export function AdminError({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-6 py-4 text-sm text-destructive">
      {message}
    </div>
  )
}

export function AdminPageHeader({
  title,
  description,
  total,
}: {
  title: string
  description?: string
  total?: number
}) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {typeof total === 'number' && (
          <span className="text-muted-foreground text-sm">{total} total</span>
        )}
      </div>
      {description && (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      )}
    </div>
  )
}

export function AdminTableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  )
}
