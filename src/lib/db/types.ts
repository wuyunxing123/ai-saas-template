/**
 * Database Row Types
 *
 * 手写的数据库行类型，与 `supabase/migrations/*.sql` 一一对应。
 *
 * 为什么是手写而不是生成：
 *   项目没有 Supabase CLI，也没有 ORM（用户约束：不要引入）。
 *   原先的 `src/types/supabase.ts` 号称是「Supabase数据库类型定义」，
 *   但审计发现它 ①与 schema 三处不一致（users 用 avatar 而非 image、
 *   声明了不存在的 orders 表、缺少 signin_* 字段）②全项目 0 引用（死代码）。
 *   因此本文件取代它，并在文件末尾给出「schema 变更时的同步清单」。
 *
 * 约定：
 *   · 列名保持 snake_case，与数据库完全一致，不做驼峰映射
 *     （映射属于 Repository 的职责，不是类型层的）
 *   · 可空列显式标 `| null`，避免误以为一定有值
 */

/**
 * 与 `users` 表对应。
 *
 * 关于 `signin_*` 字段（F-2 审计结论，2026-09-25）
 * ------------------------------------------------
 * 这组字段来自早期模板，**不要新增对它们的依赖**：
 *
 *   · `signin_provider` / `last_signin_at` —— **在用**（Admin 用户列表与详情展示）
 *   · `signin_count`                       —— 有维护（登录时 +1），当前无展示
 *   · `signin_type` / `signin_openid`      —— 有写入（signIn 回调），**无任何读取**
 *   · `signin_ip`                          —— **已停止写入**：历史上恒为 `'unknown'`，
 *                                             从未记录过真实 IP。列保留（可空）以便回滚。
 *
 * 结论：暂不删列（删列需迁移 + 改 4 处建号逻辑，收益低）；但**不要**把它们
 * 当作可靠的审计数据使用。真实登录信息应查 Supabase Auth。
 */
export interface UserRow {
  id: string
  email: string
  name: string | null
  image: string | null
  credits: number | null
  location: string | null
  last_signin_at: string | null
  signin_count: number | null
  signin_type: string | null
  signin_provider: string | null
  signin_openid: string | null
  /** @deprecated 恒为 'unknown'，已停止写入。见上方说明。 */
  signin_ip: string | null
  preferred_currency: string | null
  preferred_payment_provider: string | null
  role: string | null
  created_at: string
  updated_at: string
}

/**
 * 与 `credit_transactions` 表对应。
 *
 * `type` 同时包含旧词表（deprecated）与目标词表：
 *   旧：purchase | usage | refund | bonus | gift
 *   目标：grant | purchase | consume | refund | expire | adjustment
 * 收敛计划见 supabase/migrations/0001_credit_model.sql 的注释。
 */
export type CreditTransactionType =
  | 'purchase'
  | 'usage'
  | 'refund'
  | 'bonus'
  | 'gift'
  | 'grant'
  | 'consume'
  | 'expire'
  | 'adjustment'

export type CreditTransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED'

export interface CreditTransactionRow {
  id: string
  user_id: string
  /** 正数=入账，负数=出账。 */
  amount: number
  type: CreditTransactionType
  status: CreditTransactionStatus
  description: string | null
  /** 变动前余额。历史数据为 null。 */
  balance_before: number | null
  /** 变动后余额。历史数据为 null。 */
  balance_after: number | null
  /** 业务引用类型，例如 ai_generation / order / registration。 */
  reference_type: string | null
  /** 业务引用 id，例如 AI 任务的 taskId、订单号。 */
  reference_id: string | null
  /**
   * 请求级幂等键。同一用户 + 同一键只允许一条流水。
   * 由 `consume_credits()` 使用；`UNIQUE(user_id, idempotency_key) WHERE 非空`。
   */
  idempotency_key: string | null
  /** 关联订单（取代 payment_order_id）。 */
  order_id: string | null
  /** @deprecated 改用 order_id。 */
  payment_order_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/**
 * 与 `orders` 表对应。
 *
 * 状态词表（Phase 4 统一后）：
 *   pending → paid → refunded，异常分支 failed / cancelled / expired
 * 兼容保留 `created`（≈pending）与 `completed`（≈paid），仅供历史数据读取。
 */
export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'expired'
  /** @deprecated 语义等同 pending，仅历史数据 */
  | 'created'
  /** @deprecated 语义等同 paid，仅历史数据 */
  | 'completed'

export interface OrderRow {
  id: string
  user_id: string | null
  order_number: string
  /** 展示用金额（DECIMAL，美元）。旧代码读它。 */
  amount: number
  /** 精确金额（整数最小单位，美分）。**新代码的权威金额字段**。 */
  amount_minor: number | null
  currency: string | null
  status: OrderStatus
  payment_provider: string
  product_type: string
  product_id: string
  product_name: string
  customer_email: string
  /** 支付渠道会话 id。原 stripe_session_id / creem_checkout_id。 */
  provider_session_id: string | null
  /** 支付渠道流水 id。原 stripe_payment_intent_id / creem_payment_id。 */
  provider_payment_id: string | null
  /** 渠道专属原始字段。 */
  provider_refs: Record<string, unknown> | null
  paid_at: string | null
  /** 订单失效时间。 */
  expired_at: string | null
  /** 交付完成时间。paid 但 fulfilled_at 为空 = 已付款未交付。 */
  fulfilled_at: string | null
  /** 下单使用的 billing package id，用于价格溯源。 */
  package_id: string | null
  /** checkout 幂等键。同一用户 + 同一键只允许一张订单。 */
  idempotency_key: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/** 与 `subscriptions` 表对应。 */
export type SubscriptionStatus = 'active' | 'inactive' | 'cancelled'
export type BillingCycle = 'monthly' | 'yearly'

export interface SubscriptionRow {
  id: string
  user_id: string | null
  plan_id: string
  status: SubscriptionStatus
  billing_cycle: BillingCycle
  current_period_start: string
  current_period_end: string
  payment_provider: string
  /** 支付渠道订阅 id。 */
  provider_subscription_id: string | null
  provider_refs: Record<string, unknown> | null
  /** @deprecated 改用 provider_subscription_id。 */
  stripe_subscription_id: string | null
  /** @deprecated 改用 provider_subscription_id。 */
  creem_subscription_id: string | null
  created_at: string
  updated_at: string
}

/** 与 `ai_tasks` 表对应。状态与 AI Core 的 `AITaskState` 对齐。 */
export type AiTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AiTaskRow {
  id: string
  user_id: string | null
  model: string
  provider: string
  status: AiTaskStatus
  prompt: string | null
  input_metadata: Record<string, unknown> | null
  output_metadata: Record<string, unknown> | null
  provider_task_id: string | null
  idempotency_key: string | null
  credit_transaction_id: string | null
  credits_used: number | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  /** 迁移 0009 新增：重试与结算追溯。 */
  retry_count: number
  max_retries: number
  next_retry_at: string | null
  credits_refunded: number
  refund_transaction_id: string | null
}

/**
 * 与 `webhook_events` 表对应。
 *
 * 唯一约束 `(provider, event_id)` 是 Webhook 幂等的**依据**：
 * 先 INSERT 抢占，抢不到的那个请求即认定为重复事件。
 */
export interface WebhookEventRow {
  id: string
  provider: string
  event_id: string
  event_type: string | null
  order_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

/** 与 `admin_audit_logs` 表对应。Admin 敏感操作审计。 */
export interface AdminAuditLogRow {
  id: string
  admin_user_id: string | null
  action: string
  target_user_id: string | null
  target_type: string | null
  target_id: string | null
  amount: number | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

/**
 * schema 变更时的同步清单
 * -------------------------
 * 每次新增 migration，必须同步更新：
 *
 *   1. 本文件的对应 Row 类型
 *   2. 若新增表，在 `src/lib/db/client.ts` 的 TABLES 常量里加一项
 *   3. 若新增表，新建/更新对应的 Repository
 *   4. 更新 `docs/DATABASE.md` 的表清单
 *
 * 不允许出现「schema 已改但类型没改」的状态 —— 这正是本次审计发现的
 * 原 `src/types/supabase.ts` 的问题。
 */
