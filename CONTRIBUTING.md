# Contributing

This repository is the reviewable source for Token Ledger. Usage-export parsing and aggregation must stay deterministic, browser-local, and truthful about their evidence boundary.

## Development

1. Use Node 24.20.0 and npm 11.19.1. The quality gate also runs on Node 22.12.0.
2. Run `npm ci --ignore-scripts`.
3. Install the test browser once with `npx playwright install chromium`.
4. Run `npm run check` before opening a pull request.

The product itself remains dependency-free static HTML, CSS, JavaScript, and fonts. npm dependencies exist only for repeatable verification.

The test server binds only `127.0.0.1:4173` and serves this repository. It does not
enumerate the host's network interfaces. Its HTTP regressions check content types,
HEAD requests, missing files, unsupported methods and path confinement.

Playwright uses its installed Chromium by default. If a restricted test host
already has an independently installed compatible Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its absolute executable path when running
`npm run check`. This changes only the launched browser; the same desktop and
phone assertions, screenshots, failure videos and traces remain enabled. Record
the actual browser version with the result. An alternate-browser pass does not
establish a pass on the default pinned browser or the hosted CI matrix.

## Change boundaries

- Do not transmit imported CSV content, model names, usage values, or derived spend.
- Do not change parsing, aggregation, price defaults, checkout, or paid-tier behavior without focused tests and plain-language documentation.
- Do not embed live payment links, secrets, fabricated outcomes, or current-provider-price claims.
- Keep estimated costs visibly distinct from costs present in an imported file.
- Treat hosted CI, deployment, adoption, customer use, purchases, and revenue as separate evidence gates.

## Static asset verification

`npm run verify:static` checks HTML script/link references and CSS `url()`/`@import` references against regular files inside this repository, including quoted and relative paths. External URLs are not fetched. The hosted analytics script has one explicit path exception. A `<base href>` is rejected because it changes relative URL resolution. Fixture tests remove referenced files and rerun the actual source verifier in temporary copies to ensure missing assets cannot receive a passing result.

The test-server dependency graph uses a scoped `serve` override for `compression@1.8.2` because `serve@14.2.6` pins the vulnerable `1.8.1` release. Keep the override until the upstream pin is patched, and run `npm audit --audit-level=high` when refreshing the lockfile.
