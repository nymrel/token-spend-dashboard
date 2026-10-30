# A usage CSV you can check by hand

These files are synthetic examples, not customer usage or provider prices. Model names are fictional, dates are fixed, and the example rates below are made up to make the arithmetic easy to verify.

[Open Token Ledger](https://nymrel.com/tools/token-spend-dashboard) or run this repository locally. The documented source behavior is separate from whether a particular hosted version has adopted it.

## 1. Read costs already present in a file

Import [observed-usage.csv](../examples/observed-usage.csv). Its headers are `date,model,input_tokens,output_tokens,cost_usd`.

The cost column takes precedence over the editable price table. Expect:

| Result | Value |
|---|---|
| Usage records | 3 |
| Input tokens | 2,500,000 |
| Output tokens | 1,750,000 |
| fixture-model-a | $2.00 across two records |
| fixture-model-z | $0.00 from an explicit zero in the file |
| Total | $2.00 |
| Cost basis | Observed from the supplied file |

“Observed” means the value was supplied in the CSV. Token Ledger has not verified the file against a provider invoice.

Export the summary. Its `cost_usd` column should contain `2.0000` for fixture-model-a, `0.0000` for fixture-model-z and `2.0000` for TOTAL, with `cost_status` equal to `observed`.

## 2. Estimate from tokens with an explicit example price

Import [token-only-usage.csv](../examples/token-only-usage.csv). It has the same usage rows without a cost column.

Open Model pricing. For a reproducible example, remove the default matches and use only this fictional row:

| Match | Input USD / million | Output USD / million |
|---|---:|---:|
| fixture-model-a | 2 | 10 |

For fixture-model-a, the first row costs `1 × 2 + 0.5 × 10 = 7` dollars. The second costs `0.5 × 2 + 0.25 × 10 = 3.5` dollars. The known subtotal is **$10.50**.

No price matches fixture-model-z, so its cost is unknown. The page should show a partial estimate and “No price set” for that model. It must not turn that missing price into a free model.

In the exported summary, the missing model’s cost and TOTAL cost are blank. Their `cost_status` fields are `missing_price` and `partial`. A complete total is unavailable.

## 3. Complete the example

Add another fictional row:

| Match | Input USD / million | Output USD / million |
|---|---:|---:|
| fixture-model-z | 1 | 3 |

Its one million input tokens and one million output tokens estimate to `1 × 1 + 1 × 3 = 4` dollars. The complete estimated total becomes **$14.50**.

This differs from the observed file’s $2.00 because those are different cost inputs. An estimate is not invoice verification. Match rows use a case-insensitive substring, with the first matching row taking precedence. Use the exact fictional matches above; do not substitute a real model name and call these current rates.

## Browser-agent equivalent

After the local page initializes, check `window.JBTokens.analysisSchemaVersion === 1`. See the [versioned analysis contract](token-ledger-automation.md) for error and warning details.

Supply the contents of the token-only CSV and explicit prices:

```js
const partial = window.JBTokens.analyzeCSV({
  csv: tokenOnlyCSV,
  prices: [{match: "fixture-model-a", in: 2, out: 10}]
});
// partial.status === "partial"
// partial.result.known_cost_usd === 10.5
// partial.result.total_cost_usd === null
```

This method does not replace the person’s currently displayed ledger or use their mutable price-editor values. It is a synchronous browser-local contract, not an HTTP API or a standalone CLI. A hosted page should be checked for the same schema/version before relying on it.

## Privacy and attribution

The product source processes imported rows in the browser. Hosted analytics and paid checkout have separate boundaries; do not describe the whole hosted website as having no network activity. Test the current page if a workflow requires independently verified privacy behavior.

When linking this example, identify it as Nymrel Token Ledger’s synthetic usage-CSV walkthrough. A reference is welcome; no reciprocal link is required. The repository’s MIT license applies.
