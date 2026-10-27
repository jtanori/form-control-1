# Changelog

All notable changes to this project are documented here. The format loosely
follows Keep a Changelog; the project is pre-1.0 and ships from `main`.

## Unreleased

### Added

- **Monorepo foundation (P0-1):** pnpm workspaces + Turborepo, shared
  TypeScript/Vitest/ESLint/Prettier configuration, `mockLayout()` test helper,
  CI (lint, format, typecheck, build, unit + browser tests).
- **Frozen protocol 1.0.0 (P0-2):** `@vfe/protocol` with zod schemas and
  inferred types for page state, actions, brain responses, request/response
  envelopes, agent status and action results; golden fixtures; typed
  `ProtocolError` parsing helpers.
