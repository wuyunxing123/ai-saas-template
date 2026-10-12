/**
 * Admin 列表分页参数解析。
 *
 * 统一：默认 20 / page，最大 100，禁止一次查询全部。
 */

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export interface PaginationParams {
  page: number
  pageSize: number
  offset: number
}

export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const rawPage = Number.parseInt(searchParams.get('page') || '1', 10)
  const rawSize = Number.parseInt(searchParams.get('pageSize') || '', 10)

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const pageSize =
    Number.isFinite(rawSize) && rawSize > 0
      ? Math.min(rawSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE

  return { page, pageSize, offset: (page - 1) * pageSize }
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function toPaginated<T>(
  items: T[],
  total: number,
  params: PaginationParams
): Paginated<T> {
  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  }
}
