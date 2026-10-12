# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic
Versioning once tagged releases begin.

## [Unreleased]

### Changed

- Unify the project identity on `ai-saas-template` across package metadata, the README
  title, the PWA manifest and the `NEXT_PUBLIC_PROJECT_NAME` / `siteConfig.projectName`
  default (the interim name `my-ai-saas-template` in this same unreleased cycle is
  superseded). Deliberately unchanged: upstream provenance
  (`CharlieLZ/flux-kontext-template`), the `LICENSE` copyright line, third-party
  dependency names, and the Flux Kontext example product's own identifiers
- Upgrade the application from Next.js 15.5 / React 18 to Next.js 16.3 / React 19
- Move request middleware to the Next.js 16 `proxy` convention
- Raise Sharp to the 0.35 security line and pin patched PostCSS / brace-expansion versions
- Re-enable GitHub Actions so CodeQL can rescan the default branch after the Next 16 merge

### Fixed

- Replace insecure `Math.random()` IDs in debug and order-generation paths
- Complete HTML tag stripping in the architecture diagram

### Added

- Governance and community health files

## [0.1.0] - 2026-03-08

### Added

- Initial public template release snapshot
