#!/usr/bin/env node
/**
 * 未使用导出扫描（**信息性工具，不作为 CI 守卫**）
 *
 * 与 `audit-dead-files.mjs` 的区别：
 *   · 那个判断**整个文件**是否被 import —— 发现即退出码 1，可当守卫
 *   · 这个判断**文件内每个导出**是否被用到 —— 噪声较大，只做参考
 *
 * 实测结论（2026-09-25，全项目 209 个未使用导出）：
 *   绝大多数**不是死代码**，而是：
 *     · 刻意导出的类型（定义模块的公开 API，即使当前无人命名引用）
 *     · 成对的辅助函数（如 `formatAmountForProvider` / `parseAmountFromProvider`）
 *     · 过度导出的内部函数（文件内自用，只是多写了 `export`）
 *   因此**不要**照单删除。
 *
 * 真正有价值的用法：看**某个文件**的未使用导出占比。
 * 若一个文件 >70% 导出无人用，往往说明它整体已边缘化。
 *
 * 历史案例（均已于 Phase 9.1 / 9.2 删除）：
 *   `src/lib/utils/response.ts`、`src/lib/payment-security.ts`、
 *   `src/lib/services/payment-database.ts` —— 全部属遗留 Payment 簇。
 *
 * 运行：
 *   node scripts/audit-unused-exports.mjs
 *   node scripts/audit-unused-exports.mjs --file=src/lib/payment/stripe.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.resolve(ROOT, 'src')

const targetArg = process.argv.find((a) => a.startsWith('--file='))
const onlyFile = targetArg ? targetArg.slice('--file='.length) : null

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(SRC).filter((f) => !/\.d\.ts$/.test(f))

/** 抓取 export 的符号名 */
function extractExports(source) {
  const names = new Set()

  const patterns = [
    // export function foo / export async function foo
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    // export const foo / let / var
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    // export class Foo / interface Foo / type Foo / enum Foo
    /export\s+(?:abstract\s+)?(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    // export { a, b as c }
    /export\s*\{([^}]*)\}/g,
  ]

  for (const re of patterns) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(source))) {
      if (m[1].includes(',')) {
        for (const part of m[1].split(',')) {
          const name = part.split(/\s+as\s+/).pop()?.trim()
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
        }
      } else if (/^[A-Za-z_$][\w$]*$/.test(m[1])) {
        names.add(m[1])
      }
    }
  }

  return [...names]
}

const allSources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))

const report = []

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  if (onlyFile && rel !== onlyFile) continue

  const source = allSources.get(file)
  const names = extractExports(source)
  if (names.length === 0) continue

  const unused = []

  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g')
    let hits = 0

    for (const [otherFile, otherSource] of allSources) {
      if (otherFile === file) continue
      const matches = otherSource.match(re)
      if (matches) hits += matches.length
    }

    if (hits === 0) unused.push(name)
  }

  if (unused.length) report.push({ rel, total: names.length, unused })
}

report.sort((a, b) => b.unused.length - a.unused.length)

if (report.length === 0) {
  console.log('✅ 未发现未使用的导出')
  process.exit(0)
}

console.log('⚠️  存在未使用导出的文件：\n')

let totalUnused = 0
for (const { rel, total, unused } of report) {
  totalUnused += unused.length
  console.log(`${rel}  (${unused.length}/${total} 个导出无人引用)`)
  for (const n of unused) console.log(`    · ${n}`)
  console.log()
}

console.log(`共 ${totalUnused} 个未使用导出。`)
console.log(
  '提示：本脚本按「符号名出现次数」判断，类型仅作 import type 时也可能命中。'
)
console.log('删除前请人工确认，并注意 export * 转发的情况。')
