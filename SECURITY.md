# Security policy

## Supported version

Security fixes target the current `main` branch. This source repository does not itself prove what is deployed at nymrel.com.

## Reporting a vulnerability

Email `contact@nymrel.com` with the affected path, reproduction steps, impact, and any suggested mitigation. Please do not open a public issue for an unpatched vulnerability or include real usage exports, customer data, checkout data, or credentials in a report.

## Security boundary

Token Ledger parses usage exports and computes the free dashboard in the browser. Imported CSV content is not persisted by the ledger. Price-table edits and the dismissed-hint preference may be stored locally. The hosted page loads aggregate Vercel Web Analytics; the product must never attach imported rows, model names, usage values, derived spend, or exported summaries to analytics or other network requests.

Checkout verification and paid artifact delivery are separate server-backed boundaries. They must not be treated as proof that the free ledger uploaded usage data, and verification must fail closed when its verifier is unavailable.

There is no public bug-bounty promise. We will acknowledge actionable reports and coordinate remediation proportionate to the issue.
