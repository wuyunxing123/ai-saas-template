/**
 * verify 脚本的源码读取助手。
 *
 * 为什么需要它
 * ------------
 * 早期版本用 `execSync('cat ...')` / `execSync('grep -rn ...')` 读源码，依赖
 * `cat` / `grep` 这两个 **Unix 工具**。两个问题：
 *
 *   1. **可移植性**：纯 Windows（PATH 里没有 Git Bash）上这两个命令不存在，
 *      验证脚本会直接失败 —— 对一个「母模板」来说这不可接受。
 *   2. **健壮性**：同步 spawn（`execSync` / `spawnSync`）在部分受限环境里会
 *      直接抛 `EBUSY`，连 `echo` 都起不来（异步 spawn 正常）。
 *
 * 换成纯 Node 实现后，验证脚本**零外部命令依赖**，跨平台、更快，也不会被
 * 同步 spawn 的环境问题影响。
 *
 * 用法：
 *   readSource('src/lib/auth.ts')                    // 单个文件
 *   readSource('a.ts', 'b.ts')                       // 多个文件（拼接）
 *   grepSource(/S3Client/, { exclude: /r2\.ts/ })    // 递归 grep，返回 `file:line:content`
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 读取仓库内一个或多个文件（路径相对仓库根），返回拼接后的内容。 */
export function readSource(...files: string[]): string {
  return files.map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
}

/** 仓库内文件是否存在（相对仓库根）。 */
export function sourceExists(file: string): boolean {
  try {
    return statSync(path.join(ROOT, file)).isFile()
  } catch {
    return false
  }
}

const DEFAULT_EXTS = ['.ts', '.tsx', '.mjs']

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue

    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, exts, out)
    else if (exts.some((e) => entry.endsWith(e))) out.push(full)
  }
  return out
}

export interface GrepOptions {
  /** 扫描目录（相对仓库根），默认 `['src']`。 */
  dirs?: string[]
  /** 文件扩展名，默认 `['.ts', '.tsx', '.mjs']`。 */
  exts?: string[]
  /** 命中路径时跳过（相对仓库根，用 `/` 分隔），等价于 `grep -v`。 */
  exclude?: RegExp
}

/**
 * 递归 grep 源码，返回 `相对路径:行号:内容` 形式的行（用 `\n` 拼接），
 * 与 `grep -rn` 的输出格式一致，便于调用方沿用原有的解析逻辑。
 */
export function grepSource(pattern: RegExp, options: GrepOptions = {}): string {
  const { dirs = ['src'], exts = DEFAULT_EXTS, exclude } = options
  const hits: string[] = []

  for (const dir of dirs) {
    for (const file of walk(path.join(ROOT, dir), exts)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (exclude?.test(rel)) continue

      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        // 用 match 而不是 test，避免带 /g 的正则在多次调用间保留 lastIndex
        if (pattern.exec(lines[i])) hits.push(`${rel}:${i + 1}:${lines[i]}`)
      }
    }
  }

  return hits.join('\n')
}
