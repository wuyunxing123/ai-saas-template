import Link from 'next/link'

/**
 * Admin 列表过滤栏（Server Component，原生 GET 表单，无需客户端 JS）。
 *
 * `fields` 描述每个输入框；提交后以 query string 形式回到同一路径。
 */
export interface FilterField {
  name: string
  placeholder: string
  value?: string
  type?: 'text' | 'select'
  options?: { value: string; label: string }[]
}

export function AdminFilterBar({
  action,
  fields,
}: {
  action: string
  fields: FilterField[]
}) {
  return (
    <form
      action={action}
      method="get"
      className="mb-4 flex flex-wrap items-end gap-3"
    >
      {fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-1">
          <label
            htmlFor={`filter-${field.name}`}
            className="text-muted-foreground text-xs"
          >
            {field.placeholder}
          </label>
          {field.type === 'select' ? (
            <select
              id={`filter-${field.name}`}
              name={field.name}
              defaultValue={field.value ?? ''}
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="">All</option>
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`filter-${field.name}`}
              name={field.name}
              type="text"
              placeholder={field.placeholder}
              defaultValue={field.value ?? ''}
              className="h-9 w-56 rounded-md border bg-transparent px-3 text-sm"
            />
          )}
        </div>
      ))}

      <button
        type="submit"
        className="hover:bg-muted h-9 rounded-md border px-4 text-sm"
      >
        Filter
      </button>

      <Link
        href={action}
        className="text-muted-foreground h-9 px-2 text-sm leading-9 underline underline-offset-4"
      >
        Reset
      </Link>
    </form>
  )
}
