# ci/: a deterministic gate

Ported from labit's. A PR is measured against its own base commit, by the base commit's judge, so a PR can't change how it's judged. CI has no secrets; forks run it too.

## The gate (`.github/workflows/gates.yml`)

| Metric | Rule | Why |
|---|---|---|
| `pageScriptGzipBytes` | may grow 2 KB per PR, never past 48 KB | `dist/census.js` goes into every page a capture reads |
| `npmPackBytes` | may grow 4 KB per PR, never past 140 KB | what `npm i` and `npx` download |
| `oxlintProblems` | never more | pinned `oxlint@1.93.0` over `src` and `cli` |
| `typeErrors` | never more | pinned TypeScript 5.9.3 over `src` (strict) and over `cli`'s JavaScript (`tsconfig.cli.json`) |
| `runtimeDependencies` | never more (it's 0) | the README promises none |

- Over a size budget on purpose? Add the `size-approved` label. Hard caps still apply; raising one means editing `ci/metrics.mjs`.
- Both sides use the **PR's** `tsconfig.json`, `tsconfig.cli.json` and `.oxlintrc.json`, so adding a rule doesn't fail the PR that adds it.
- Lint and types are also hard checks in `ci.yml` (`npm run lint`, `npm run check`), since both are at zero. The ratchets here are the backstop if a rule is ever added that the code doesn't meet yet.

## Locally

```bash
ci/measure.sh . /tmp/now.json                 # measure this tree (installs and builds it first)
node ci/metrics.mjs compare /tmp/now.json /tmp/main.json
node ci/metrics.mjs types                     # list type errors with the pinned TypeScript
```

## Why `cli/` is JavaScript checked by TypeScript, not TypeScript

`cli/census.mjs` is the `census` command and `cli/playwright.mjs` is what `@leonidstern/census/playwright` imports. Renaming them to `.ts` would mean building them and moving those published paths, for no more checking than `checkJs` gives: TypeScript reads their JSDoc, `window.census` is typed from `src/browser.ts` (`cli/globals.d.ts`), and what they import from `dist/` is typed by the `src/` it was built from (`dist/census.d.mts`).
