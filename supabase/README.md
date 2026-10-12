# supabase/migrations — 迁移体系说明

本目录在 Phase 3 建立。此前项目只有一个 `scripts/setup-database.sql`，
既不幂等（重复执行会在 `CREATE TRIGGER` / `CREATE POLICY` 处报错），也没有版本概念。

## 为什么是「编号 SQL 文件」而不是 Supabase CLI / ORM

- 项目当前技术栈就是**裸 SQL + Supabase 控制台**，没有安装 Supabase CLI，也没有任何 ORM。
- 用户约束明确：**不要为了 Phase 3 引入 Prisma / Drizzle / ORM**。
- 因此沿用「编号 SQL 文件 + 手工执行」这一最轻量的方案，不新增工具链依赖。

## 执行方式

在 Supabase 控制台的 SQL Editor 中，**按文件名数字顺序**依次执行：

```
0000_baseline.sql                  ← 当前 schema 快照（新环境从这里开始）
0001_credit_model.sql              ← 积分流水模型
0002_orders.sql                    ← 订单统一（orders 取代 payment_orders）
0003_subscriptions.sql             ← 订阅 provider 引用通用化 + payment_configs 废弃
0004_ai_tasks.sql                  ← AI 任务表（取代 generations）
0005_atomic_credit_operations.sql  ← 积分原子扣减 RPC（consume_credits）
```

**已上线的库**：如果它已经跑过 `scripts/setup-database.sql`，
那么 `0000_baseline.sql` 也应执行一次（它是幂等的），以保证后续迁移的前提一致。

每个文件都设计为**可重复执行**：

- 建表用 `CREATE TABLE IF NOT EXISTS`
- 加列用 `ADD COLUMN IF NOT EXISTS`
- 索引用 `CREATE INDEX IF NOT EXISTS`
- 约束先 `DROP CONSTRAINT IF EXISTS` 再 `ADD CONSTRAINT`
- 触发器先 `DROP TRIGGER IF EXISTS` 再 `CREATE TRIGGER`
- 策略先 `DROP POLICY IF EXISTS` 再 `CREATE POLICY`
- 回填用 `ON CONFLICT DO NOTHING`

## 迁移安全约定

1. **只增不删**。旧表（`payment_orders` / `generations` / `payment_configs`）保留并标记
   `DEPRECATED`，不 `DROP`，以便回滚与历史数据查阅。
2. **字段含义变更必须先回填**。例如 `provider_session_id` 是由
   `stripe_session_id` / `creem_checkout_id` 回填而来，旧列保留并标注废弃。
3. **禁止在没有迁移的情况下直接改线上 schema**。
4. 新增迁移文件时，编号递增，且**不修改已执行过的文件**。

## 静态校验

本机没有可用的 Supabase / PostgreSQL 实例时，用脚本做静态校验：

```bash
python supabase/scripts/validate_migrations.py
```

它基于 sqlglot（PostgreSQL 方言）检查：

| 检查项 | 说明 |
|---|---|
| syntax | 每个语句能否被解析 |
| dependency order | `ALTER` / `INDEX` / `TRIGGER` 的目标表是否已在本文件或更早的文件中创建 |
| foreign key | 所有 `REFERENCES` 指向的表是否存在 |
| unique constraint | `CREATE UNIQUE INDEX` 引用的列是否存在 |
| index | `CREATE INDEX` 引用的表与列是否存在 |
| idempotency | 统计 `IF NOT EXISTS` / 先 `DROP ... IF EXISTS` 的覆盖情况 |

**已知局限**（脚本结尾也会打印）：

- `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` 被 sqlglot 回退为通用 Command，
  未做依赖顺序与幂等性校验 —— 这几处需要人工确认（本仓库已统一写成
  `DROP POLICY IF EXISTS` + `CREATE POLICY`）。
- 只做静态存在性检查，**不校验类型兼容、数据是否满足约束、回填结果是否正确**。
- 无法验证 `auth.uid()` 等平台函数是否存在。

需要在真实数据库上完成的验证（有 Supabase 环境时执行）：

```sql
-- 1. 按顺序执行 0000 ~ 0005，确认无报错
-- 2. 再执行一遍，确认全部幂等（这是 setup-database.sql 曾经做不到的）
-- 3. 校验回填结果
SELECT count(*) FROM public.orders;              -- 应 >= payment_orders 行数
SELECT count(*) FROM public.ai_tasks;            -- 应 >= generations 行数
SELECT count(*) FROM public.credit_transactions WHERE reference_type IS NULL;  -- 应为 0
-- 4. 校验幂等约束生效
SELECT indexname FROM pg_indexes
WHERE tablename IN ('credit_transactions','ai_tasks') AND indexdef LIKE '%UNIQUE%';
```

## 真实执行校验（推荐，不需要 Supabase 实例）

静态校验证明不了「迁移真的能跑」。本仓库提供了一个在**真实 PostgreSQL** 上执行的脚本 ——
用 PGlite（PostgreSQL 编译成 WASM），不需要 Docker 或 Supabase：

```bash
node supabase/scripts/verify_migrations.mjs
```

它会：

1. 按顺序执行 `0000` ~ `0005`（真实语法 / 依赖顺序 / 外键 / 约束）
2. **再执行一遍**，验证全部迁移幂等
3. 断言 schema：表 / 列 / 唯一索引 / `consume_credits` 函数
4. 跑 8 组积分原子性测试（共 86 项检查）：正常扣减、余额不足、重复请求、
   不同幂等键、并发场景、原子谓词直证、非法 amount、用户不存在

依赖 `@electric-sql/pglite`，**刻意不加入 package.json**（避免为验证引入运行时依赖）。
脚本会依次尝试：项目 `node_modules` → `PGLITE_MODULES` 环境变量 → 本机隔离工作区。

```bash
npm i --no-save @electric-sql/pglite
# 或
PGLITE_MODULES=/path/to/node_modules node supabase/scripts/verify_migrations.mjs
```

**PGlite 与 Supabase 的差异**（脚本会自动适配并在输出中说明）：

| 差异 | 适配方式 | 影响 |
|---|---|---|
| PGlite 未内置 `uuid-ossp` 扩展 | 执行前剥离该语句 | 无 —— 本 schema 全部使用内置 `gen_random_uuid()` |
| `auth.uid()` 由 Supabase 提供 | 脚本先建一个返回 NULL 的桩函数 | 仅让 `CREATE POLICY` 能成功；RLS 行为不在验证范围 |
| PGlite 单后端单连接 | 并发测试改为「同时发起 + 原子谓词直证」 | **真正的并行执行无法复现**，需在有 Supabase 实例时补做 |

**真实 Supabase 上仍需补做的一项**（PGlite 做不到）：开两个 `psql` 会话，
各自执行 `consume_credits`，确认余额 100 时两个「扣 80」只有一个返回 `ok`。

## 新增迁移的规范

1. 文件名：`<4 位序号>_<snake_case_主题>.sql`，例如 `0005_add_api_keys.sql`
2. 文件头注释必须写明：**解决什么问题**、**关联的审计编号（如 A-5）**、**是否可回滚**
3. 表名一律带 `public.` 前缀
4. 新表必须补：`updated_at` 触发器、必要索引、RLS 策略
5. 新表必须在 `src/lib/db/types.ts` 里补对应的行类型（保持 schema 与 TS 类型一致）
6. 提交前跑一次 `python supabase/scripts/validate_migrations.py`
