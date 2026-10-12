#!/usr/bin/env node
/**
 * 用 jiti 运行 `scripts/` 下的 TypeScript 脚本，并解析 `@/` 路径别名。
 *
 * 用法：
 *   node scripts/run-ts.mjs scripts/verify-ai-core.ts
 *
 * 为什么需要它：项目里的 TS 文件用 `@/lib/...` 引用，Node 原生无法解析，
 * 而 `scripts/**` 不在 tsconfig 的 include 里，也没有安装 tsx。
 * jiti 已经在依赖树里（Next.js 的间接依赖），复用它即可。
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const entry = process.argv[2]

if (!entry) {
  console.error('用法：node scripts/run-ts.mjs <file.ts>')
  process.exit(1)
}

const createJiti = require('jiti')
const jiti = createJiti(path.resolve(root, entry), {
  alias: {
    '@': path.join(root, 'src'),
  },
  interopDefault: true,
  esmResolve: true,
  sourceMaps: true,
})

jiti(path.resolve(root, entry))
