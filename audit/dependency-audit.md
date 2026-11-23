# Dependency and code-quality audit

| Check | Result |
|---|---|
| `npm audit` | 0 vulnerabilities (the earlier `@tailwindcss/typography` finding was fixed by removing the unused package) |
| `tsc --noEmit` | Clean |
| `eslint` | Clean (0 errors, 0 warnings) |
| `next build` | Succeeds (Next 16 / Turbopack, 34 static pages generated, about 25 s) |
| Unused runtime deps | None found (every dependency is imported somewhere in `src`/`scripts`) |
| Dead files | None never-imported |
| Secret scan | No provider-key, private-key or credentialed-URI pattern in tracked source/docs |
| Bundle | Client JS 887 KB raw, about 281 KB gz; CSS 96 KB. No bundle analyzer run yet |
| Package versions | Current stable; no blanket upgrades recommended |

Gaps: no automated test runner or CI, no dependency-update bot, no secret-scanning in CI (recommend gitleaks pre-commit + CI).
