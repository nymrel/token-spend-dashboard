# Contributing

This repository is the reviewable source for Token Ledger. Usage-export parsing and aggregation must stay deterministic, browser-local, and truthful about their evidence boundary.

## Development

1. Use Node 24.20.0 and npm 11.19.1. The quality gate also runs on Node 22.12.0.
2. Run `npm ci --ignore-scripts`.
3. Install the test browser once with `npx playwright install chromium`.
4. Run `npm run check` before opening a pull request.

The product itself remains dependency-free static HTML, CSS, JavaScript, and fonts. npm dependencies exist only for repeatable verification.

## Change boundaries

- Do not transmit imported CSV content, model names, usage values, or derived spend.
- Do not change parsing, aggregation, price defaults, checkout, or paid-tier behavior without focused tests and plain-language documentation.
- Do not embed live payment links, secrets, fabricated outcomes, or current-provider-price claims.
- Keep estimated costs visibly distinct from costs present in an imported file.
- Treat hosted CI, deployment, adoption, customer use, purchases, and revenue as separate evidence gates.
