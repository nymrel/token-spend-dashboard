# Token Ledger automation contract (candidate v1)

People use the page's file chooser, paste box and optional column settings. Browser agents can call `window.JBTokens.analyzeCSV(request)` directly after the page initializes. This is a synchronous browser-local method; it is not an HTTP API or a standalone Node CLI. Check `window.JBTokens.analysisSchemaVersion === 1` before using it. Hosting and adoption require separate verification.

```js
const result = window.JBTokens.analyzeCSV({
  csv: "model,input_tokens,output_tokens\nexample-model,1000000,1000000",
  prices: [{match: "example-model", in: 2, out: 10}]
});
// result.status === "complete"; result.result.total_cost_usd === 12
```

| Input | Contract |
| --- | --- |
| `csv` | Required string, comma-separated header plus usage records. Quoted commas/newlines and a leading UTF-8 BOM are supported. |
| `columns` | Optional object overriding detected `date`, `model`, `in`, `out`, `cost` roles. Indexes are zero-based integers, distinct and in range; `-1` explicitly means absent. Unspecified roles retain detection. A model and at least one token/cost column are required. |
| `prices` | Optional array of `{match, in, out}`. Rates are finite nonnegative numbers in USD per million tokens. Match is a nonempty, case-insensitive substring; the first matching row wins. `[]` explicitly means no rates. |

Omitted prices use the source's editable **estimates**, never the person's current local edits. They are not a promise of current provider rates. Supply explicit verified rates and record the exact source revision alongside the result for reproducible costing. A cost column takes precedence over token estimates. Supplied mapped numeric cells must be valid; a blank observed cost is an error rather than zero. Token counts must be nonnegative safe integers. Absent token columns contribute zero; a blank model is grouped as `(unlabeled)`, matching the existing ledger.

The output always contains `schema_version: 1`, `status`, `errors`, `warnings`, and `result`:

- `complete`: the cost total is known, whether observed or estimated. An estimated total is not invoice verification.
- `partial`: one or more models lack prices. `result.total_cost_usd` is `null`, `cost_complete` is false, and `known_cost_usd` contains only the known subtotal. Unknown model costs are `null` with `cost_status: "missing_price"`; real zero remains numeric zero.
- `error`: `result` is `null`. Each error has a stable `code` and recovery message. Data errors supply a one-based `record` ordinal, excluding the header, and zero-based `column` index (or null for row width). A quoted multiline record is still one record.

Result fields: `currency` (USD), `cost_basis` (`observed` or `estimated`), `cost_complete`, `total_cost_usd`, `known_cost_usd`, `input_tokens`, `output_tokens`, `used_records`, resolved `columns`, and `models`. Each model has `model`, `records`, `input_tokens`, `output_tokens`, `cost_usd`, and `cost_status` (`observed`, `estimated`, or `missing_price`). This contract returns model summaries; daily chart interpretation remains outside it.

| Error code | Recovery |
| --- | --- |
| `INVALID_REQUEST` | Provide csv text and supported optional fields only. |
| `EMPTY_INPUT`, `INVALID_HEADER`, `NO_DATA_RECORDS` | Supply a usage export with a header and data. |
| `UNCLOSED_QUOTE`, `ROW_WIDTH` | Correct the incomplete quote or record structure. |
| `COLUMNS_REQUIRED`, `INVALID_COLUMNS` | Supply explicit valid column indexes. |
| `INVALID_NUMBER` | Correct the identified numeric cell; do not guess missing cost. |
| `INVALID_PRICES` | Supply valid nonnegative numeric rates and nonempty matches. |
| `ROW_LIMIT_EXCEEDED` | Split into batches of at most 100,000 data records. Unlike the interactive page's visibly capped view, this method rejects oversized input instead of returning a misleading complete result. |
| `NUMERIC_OVERFLOW` | Correct extreme values or split the input. |

`MISSING_PRICES` warnings list the affected models and explain an explicit-rates retry. `NO_DATE_COLUMN` reports the absence of a date mapping. Warnings do not turn estimates into provider-verified costs.

Calls neither change the current ledger/price editor nor persist or transmit input. Repeating identical explicit inputs against identical source yields identical JSON. Retry an error after correcting its input; retry a partial result with explicit rates. This read-only method needs no idempotency key and performs no checkout, paid-tier or account action. The existing `parseCSV`, `detectAll`, `aggregate` and Pro aggregate shape remain available; the new structured contract is opt-in.
