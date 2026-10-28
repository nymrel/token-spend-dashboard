# Token Ledger

For feedback or implementation, see [Getting help and contributing](#getting-help-and-contributing).

Paste your Anthropic or OpenAI usage export and get a spend dashboard — by day, by
model, with cost estimates. Imported rows are processed locally in your browser.

**Use it:** https://nymrel.com/tools/token-spend-dashboard

## What it does

Provider usage exports are long CSVs that are hard to read. This tool parses one in
the browser and turns it into the view you actually wanted: what you spent, which day
you spent it, and which model took the money.

No account, no API key, no email gate.

## Run it locally

No build step and no dependencies. It is a static page.

```
git clone https://github.com/nymrel/token-spend-dashboard.git
cd token-spend-dashboard
python3 -m http.server 8000
```

Then open http://localhost:8000/tools/token-spend-dashboard/

The page loads its stylesheet, script, and fonts from absolute paths (`/assets/...`),
so it needs a server rooted at the repo folder. Opening the HTML file straight from
disk will render unstyled.

## What is in here

| Path | What it is |
| --- | --- |
| `tools/token-spend-dashboard/index.html` | The whole tool — markup, copy, and logic |
| `assets/site.css`, `assets/site.js` | Shared styles and behavior across the Nymrel tools |
| `assets/pro/` | The paid-tier module, as shipped |
| `assets/checkout-config.js` | The checkout registry template |
| `assets/fonts/` | The three fonts the page uses |

`tools/token-spend-dashboard/index.html` is the reviewable source for the hosted tool; deployment and live-byte identity require separate evidence.

## A note on the paid tier

The page offers a paid dashboard. `assets/checkout-config.js` here is the committed
template with no payment links set, so in a local copy the upgrade button falls back
to email. The free view reads your export on its own.

## Privacy

Your usage file is read in the browser. The ledger does not upload or persist its
rows, model names, usage values, or derived spend. Price-table edits and the dismissed
hint preference may be stored locally in your browser.

The hosted nymrel.com page loads aggregate Vercel Web Analytics. Token Ledger does not
attach imported or derived ledger values to analytics requests. Paid-tier checkout
verification and artifact delivery are separate server-backed boundaries.

## Quality gates

The product stays dependency-free static HTML, CSS, and JavaScript. Node dependencies
exist only for repeatable verification. With Node 24.20.0 and npm 11.19.1:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run check
```

## Credits

Instrument Serif, Instrument Sans, and IBM Plex Mono are used under the SIL Open
Font License.

## Who built it

[Nymrel](https://nymrel.com) — a software studio that builds and runs its own products.

## License

MIT. See [LICENSE](LICENSE).

## Getting help and contributing

Describe what you tried, what happened and the result you wanted. Plain-language feedback is enough; implementation details can be reconstructed from the source.

For implementation, start with [AGENTS.md](AGENTS.md), then [CONTRIBUTING.md](CONTRIBUTING.md).

These commands are declared in the linked manifests. Use the listed working directory and the maintainer's setup instructions. Inspect prerequisites before running an aggregate check.

| Working directory | Declared command | Manifest |
| --- | --- | --- |
| `.` | `npm run check` | [package.json](package.json) |

## Token Ledger: missing model prices

If a model has no matching price, Token Ledger shows **No price set** and labels spend as a partial estimate. Charts and subtotals include priced models only. Add a matching row under Model pricing to complete the estimate.

Summary CSV exports append a `cost_status` column: `observed`, `estimated`, `missing_price` or `partial`. An unpriced model's cost is blank; an incomplete TOTAL cost is also blank. Valid, known zero costs remain numeric zero. Consumers should use the status field when distinguishing unknown from free usage.

## Token Ledger import and automation

Choose a usage CSV or paste its contents. Ordinary imports show the summary first; Adjust columns is available when you need it. An unreadable or invalid import keeps the previous valid ledger and labels its export. Correct the input and retry; you do not need to clear your work.

Browser agents can use the [versioned analysis contract](docs/token-ledger-automation.md) with explicit inputs, structured errors and unknown costs, without changing the person’s current ledger. This is a prepared source candidate; hosted adoption is unverified.
