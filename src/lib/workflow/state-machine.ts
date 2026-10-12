/**
 * Workflow 领域模型 —— Task 状态机
 *
 * 为什么状态机要独立成文件
 * ------------------------
 * 规格 §6 的要求很明确：
 *
 *   「状态转换必须集中管理。不要让 API / Provider / Repository
 *     到处直接 update status = ...」
 *
 * 之前 `aiTaskRepository.updateStatus()` 只是无条件 UPDATE —— 任何人都可以
 * 把 `completed` 改成 `processing`。有了异步任务和 webhook 之后，
 * 这种自由写入会直接导致重复扣费 / 重复退款 / 结果被覆盖。
 *
 * 关于状态词表
 * ------------
 * 规格 §6 建议 `CREATED / RUNNING / COMPLETED / FAILED`；
 * 数据库（迁移 0004）的 CHECK 约束是
 * `pending / processing / completed / failed / cancelled`。
 *
 * **本实现直接采用数据库词表**，不另建第二套大写枚举。
 * 理由：项目约定「Repository 输入参数镜像列名」，另建一套会引入
 * 一层恒等映射（CREATED↔pending），属于无收益抽象。
 * 对应关系（写在这里以免误解）：
 *
 *   规格 CREATED   ≡ pending
 *   规格 RUNNING   ≡ processing
 *   规格 COMPLETED ≡ completed
 *   规格 FAILED    ≡ failed
 *   规格 CANCELLED ≡ cancelled
 */

/** Task 状态。取值与 `ai_tasks.status` 的 CHECK 约束完全一致。 */
export type TaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 终态：进入后不允许任何再转换。 */
export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  'completed',
  'failed',
  'cancelled',
]

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/** 活跃态：需要被轮询 / 可能被 webhook 推进。 */
export function isActive(status: TaskStatus): boolean {
  return status === 'pending' || status === 'processing'
}

/**
 * 合法状态转换表。
 *
 * 刻意**不包含**这些（规格 §6 明确禁止）：
 *   completed → processing
 *   failed    → processing
 *   cancelled → completed
 *
 * 注意 `processing → processing`：这不是笔误。
 * 它表示「重试」—— 任务仍在活跃态，只是 retry_count +1 后重新提交。
 * 这样 FAILED 保持终态语义（重试耗尽后才落 failed），
 * 符合规格「FAILED → RUNNING 必须避免」。
 */
const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['processing', 'failed', 'cancelled'],
  processing: ['processing', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

export class InvalidTaskTransitionError extends Error {
  readonly code = 'INVALID_TASK_TRANSITION' as const

  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus
  ) {
    super(
      `Invalid task transition: ${from} → ${to}. ` +
        `Allowed from "${from}": ${ALLOWED_TRANSITIONS[from].join(', ') || '(none — terminal state)'}`
    )
    this.name = 'InvalidTaskTransitionError'
  }
}

/**
 * 校验一次状态转换是否合法，不合法则抛 `InvalidTaskTransitionError`。
 *
 * 所有状态推进都必须先过这里 —— 由 `WorkflowService` 统一调用，
 * Repository 不得被直接用于改状态。
 */
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to && to === 'processing') {
    // 重试：显式允许
    return
  }

  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTaskTransitionError(from, to)
  }
}

/** 判断转换是否合法（不抛错版本，供测试与日志分支使用）。 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** 列出某状态下所有合法的目标状态。 */
export function allowedNext(from: TaskStatus): readonly TaskStatus[] {
  return ALLOWED_TRANSITIONS[from]
}
