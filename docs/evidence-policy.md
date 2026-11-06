# Evidence Policy

Phase 3 defines the evidence rules for the Groww SIP Continuity MVP. The corpus is fictional and educational only. It must never be presented as an official Groww statement, a recommendation, or a guarantee of investment outcomes.

## Evidence tiers

The implementation has exactly three tiers, defined in `src/lib/evidence/types.ts`.

| Tier | Purpose | UI/source label | Verification status |
| --- | --- | --- | --- |
| `demo_policy` | Fictional rules written for this graduation demonstration | `Demo policy — not Groww policy` | `fictional_demo` |
| `general_education` | Verified, general investor education | `General investor education` | `verified` or `unverified` |
| `official_groww` | Verified official Groww product documentation only | `Official Groww documentation` | `verified` |

### Tier 1: demo policy

Demo-policy records describe the project's fictional operating rules. They are authored for the demonstration and are not claims about Groww.

- Every demo record uses `verificationStatus: "fictional_demo"`.
- Every demo record explicitly states that it is a fictional demonstration rule and is not Groww policy. The schema enforces both phrases.
- Demo records do not claim an external `verifiedAt` date.
- The authoritative numerical values remain in `src/lib/domain/policy.ts`.
- `corpus.jsonl` uses policy placeholders such as `{{version}}`, `{{retryWindowDays}}`, and `{{maxRetryAttempts}}`. The loader hydrates them from `demoPolicy` before validation, so the corpus does not maintain a conflicting copy of policy numbers.
- A demo-policy source is labelled as fictional even when the retrieval result is otherwise valid.

### Tier 2: general education

General-education records explain widely applicable investing concepts. They must not be used to assert Groww-specific product rules or an investor's account facts.

Current coverage includes:

- SIP basics and the difference from lump-sum investing.
- Market volatility and mutual fund NAV.
- Investment risk and possible loss of principal.
- The absence of guaranteed returns.
- Long-term investing and compounding.
- SIP discipline and market timing.
- General investor support and grievance redressal guidance.

Records avoid invented statistics, return projections, personalised advice, and unsupported regulatory claims. A record is included only when its statement is supported by the cited source.

### Tier 3: official Groww

This tier may contain only verified official Groww documentation. It must not be populated from assumptions, model memory, public summaries, or fictional demo rules.

For corpus version `evidence-corpus-v1.0.0`, the official tier is intentionally empty because no official Groww document was verified for this phase. The application therefore returns:

> I don't have verified official Groww documentation for this question.

A question about whether something is actual Groww policy is routed only to this tier. Demo-policy evidence is never substituted for official evidence.

## Source verification process

The current general-education sources were manually checked on 4 November 2026.

| Source | Used for | URL | Source date |
| --- | --- | --- | --- |
| AMFI — Systematic Investment Plan | SIP basics, SIP discipline, SIP vs lump sum | <https://www.amfiindia.com/investor/become-mf-distributor?zoneName=sip> | Not displayed; stored as `null` |
| AMFI — Risks in Mutual Funds | Investment risk, possible loss of principal | <https://www.amfiindia.com/investor/knowledge-center-info?zoneName=riskInMutualFunds> | Not displayed; stored as `null` |
| SEBI Investor Education — Factors to Consider Before Investing | No guaranteed returns, long-term horizon | <https://investor.sebi.gov.in/investment-thingsbeforeinv.html> | Not displayed; stored as `null` |
| SEBI Investor Education — Mutual Funds' Investments | NAV and market fluctuation | <https://investor.sebi.gov.in/securities-mf-investments.html> | Not displayed; stored as `null` |
| SEBI Investor Education — Grievance Redressal | Investor support and SCORES | <https://investor.sebi.gov.in/securities-resolvedispute.html> | Not displayed; stored as `null` |

The verification procedure is:

1. Prefer a regulator, mutual-fund association, exchange, or official product owner as the source.
2. Open the source and confirm that the proposed statement is actually supported by it.
3. Paraphrase narrowly. Do not add numbers, projections, comparisons, or regulatory claims that the source does not make.
4. Store the source name, URL, publication/update date when shown, and the date checked.
5. Mark the record `verified` only after the source check. If a source cannot be checked, keep the record `unverified` or do not add it.
6. Re-check sources before increasing the corpus version.

The corpus currently contains no unverified records. Unverified records are nevertheless supported by the schema so that future work cannot silently promote an unchecked source.

## Evidence record contract

Every record is validated by `src/lib/evidence/schema.ts` before it can be loaded.

Required fields:

- `id` — stable, lowercase, dot/underscore/hyphen identifier.
- `version` — semantic record version such as `1.0.0`.
- `sourceTier` — one of the three tiers.
- `intents` — non-empty, unique retrieval intents.
- `title` — human-readable record title.
- `text` — the evidence statement and, for demo records, the fictional disclaimer.
- `keywords` — non-empty lexical retrieval terms.
- `sourceName` — human-readable source name.
- `sourceUrl` — valid HTTP(S) URL or `null` when genuinely unavailable.
- `sourceDate` — valid `YYYY-MM-DD` date or `null`.
- `verifiedAt` — date the source was checked, or `null` for fictional or unverified records.
- `verificationStatus` — `verified`, `unverified`, or `fictional_demo`.
- `applicableDemoPolicyVersion` — the demo policy version for fictional records, otherwise `null`.

Cross-field rules include:

- Demo records must use `fictional_demo`, reference the current `demoPolicy.version`, and contain the fictional disclaimers.
- General-education records cannot reference a demo-policy version.
- Official Groww records must be `verified` and include a source URL.
- A `verified` record must include `verifiedAt`.
- An `unverified` record must not include `verifiedAt`.

Malformed records, unknown fields, duplicate IDs, and invalid JSON lines are rejected. The loader reports the corpus line number.

## Safety rules

- Demo policy cannot be labelled or returned as official Groww policy.
- General education cannot satisfy an account-specific question.
- Official-policy questions search only verified `official_groww` records.
- If official evidence is unavailable, retrieval returns `NO_EVIDENCE` with an explicit message.
- Unverified records are excluded from normal retrieval.
- Citation labels preserve the tier and verification status.
- Missing evidence is never filled from model knowledge. This layer only returns records that exist in the corpus.

## Versioning

The current corpus version is `evidence-corpus-v1.0.0`.

Record-level `version` values are independent of the corpus version. A corpus change that alters claims, sources, or retrieval-visible wording should increment the relevant record version and the corpus version. The demo policy version is separate and comes from `src/lib/domain/policy.ts`.

## Known limitations

- The official Groww tier is empty, so official-policy questions cannot be answered from evidence in this phase.
- General-education records are broad education, not advice about a particular investor, scheme, tax position, or product.
- Some source pages do not display publication or update dates, so `sourceDate` is `null` rather than guessed.
- The corpus is small and manually curated.
- The corpus is unaudited by a lawyer, compliance reviewer, or Groww representative.
- The evidence layer does not yet connect to an assistant, prompt, UI, database, or evaluation dataset.
