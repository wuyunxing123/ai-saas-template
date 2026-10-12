# Contributing

Thanks for contributing.

## Read This First

This repo is a **mother template**: reusable Core infrastructure plus a Product layer
(`src/lib/products/flux-kontext/`). Core must not depend on Product — that rule is
enforced by scripts, not convention.

| If you are… | Read |
|---|---|
| New to the project | [`docs/MOTHER_TEMPLATE.md`](docs/MOTHER_TEMPLATE.md) — architecture, boundaries, verification |
| A coding agent (Codex / Claude Code / Qoder…) | [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) — hard constraints before and after editing |
| Building your own product on top | [`docs/PRODUCT_GUIDE.md`](docs/PRODUCT_GUIDE.md) |
| Looking for a specific topic | [`docs/README.md`](docs/README.md) — index of all docs |

> ⚠️ `docs/archive/ARCHITECTURE.md` (moved there on 2026-09-30) and the plan body of
> `docs/REFACTOR_PLAN.md` are
> **Phase 1 historical snapshots**. Their file paths are mostly obsolete.
> Do not read them as current state.

## Ground Rules

- Keep each pull request focused on one problem.
- Prefer fixes that reduce complexity instead of adding more configuration.
- Do not commit secrets, production data, or copied `.env` files.
- Update docs when behavior, setup, or public APIs change.
- **Do not modify Core to fit one Product.** See `docs/AGENT_GUIDE.md` §2.4.
- Found an unrelated problem? Record it in the current phase's
  `docs/PHASE_*_FOLLOWUPS.md` instead of fixing it in the same PR.

## Local Setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local` (or run `npm run setup:env`).
3. Fill in the required environment variables for Supabase, auth, and the AI provider you use.
4. Start the app with `npm run dev`.

## Before Opening A Pull Request

CI runs **locally** for this project — there is no `push`/`pull_request` GitHub Actions gate,
by explicit repo policy (see `.github/workflows/*.yml`). So the gate is yours to run:

```bash
npm run verify          # full gate: lint, guards, verify scripts, migrations, build
npm run verify:fast     # skip build + migrations (quick iteration)
```

`npm run verify` runs, in order: `eslint` + `tsc`, four static guards
(dead files, architecture boundary, env consistency, product boundary),
every `scripts/verify-*.ts`, both migration validations, and a production build.
Any failure exits non-zero. Skipped steps (missing toolchain, e.g. `sqlglot`)
are reported separately and **do not count as passing** — use `npm run verify -- --strict`
to also fail on skips.

If a change cannot be fully validated locally, call that out in the PR.

## Pull Request Expectations

- Explain the problem, not just the code diff.
- Include screenshots for UI changes.
- Mention any new environment variables.
- Call out migrations, destructive actions, or rollout concerns.

## Commit Style

Conventional commits are preferred:

- `fix: ...`
- `feat: ...`
- `chore: ...`
- `docs: ...`

## Reporting Security Issues

Do not open public issues for vulnerabilities. Follow the process in
[`SECURITY.md`](SECURITY.md).
