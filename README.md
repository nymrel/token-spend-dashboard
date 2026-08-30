# Token Ledger

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

`tools/token-spend-dashboard/index.html` is byte-for-byte the file nymrel.com serves.

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
