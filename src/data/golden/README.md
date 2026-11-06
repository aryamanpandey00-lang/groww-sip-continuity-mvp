# Golden evaluation dataset v1

`golden.v1.jsonl` is the version-controlled evaluation dataset for the future
OpenAI-powered SIP Continuity Assistant. It is hand-authored and does not
contain model output.

- Dataset version: `golden-v1.0.0`
- Encoding: UTF-8 JSON Lines, one golden case per line
- Splits: `dev` 29, `holdout` 12, `adversarial` 7 (48 total)
- Retrieval source of truth: `src/lib/evidence/corpus.jsonl`
- Financial-state source of truth: `src/lib/domain/fixtures/demo-investor.ts` and
  the deterministic domain engines
- Policy source of truth: `src/lib/domain/policy.ts`

## Required fields

Every line contains all of the following fields. The schema rejects missing
fields, unknown fields and invalid enum values.

| Field | Meaning |
| --- | --- |
| `id` | Stable unique case ID, e.g. `dev_retry_eligible_01`. |
| `datasetVersion` | Must equal `golden-v1.0.0` for this file. |
| `split` | `dev`, `holdout` or `adversarial`. |
| `category` | Evaluation category from `src/lib/evaluation/types.ts`. |
| `severity` | `critical`, `high`, `medium` or `low`. |
| `investorQuestion` | The user question evaluated in fixture mode. |
| `demoStateVariant` | Deterministic demo state built by `state-variants.ts`. |
| `conversationHistory` | Prior turns supplied to the assistant. |
| `expectedIntent` | Evidence or evaluation-only intent. |
| `expectedEvidenceIds` | Evidence IDs that should appear in Recall@3. |
| `expectedResponsePoints` | Objectively checkable points with required terms. |
| `prohibitedClaims` | Claims that must not appear in a safe response. |
| `expectedAction` | `NONE`, retry, amount, debit-day or restart proposal. |
| `expectedFallback` | Whether the response must fall back. |
| `expectedFallbackReason` | Reason enum, or `NONE` when no fallback is required. |
| `humanReferenceResponse` | Hand-written reference answer, not model output. |
| `reviewStatus` | `pending_human_review`, `human_reviewed` or `changes_requested`. |
| `evidenceLogReference` | `null`, `pending`, or an `EVL-...` reference. |

## Review and Evidence Log status

All 48 cases are intentionally marked `pending_human_review` with
`evidenceLogReference: null`.

No human reviewer has independently approved these cases and no AI Evidence Log
ID exists in this project. Do not change a case to `human_reviewed` until:

1. A named human reviewer has checked the question, reference response,
   prohibited claims, expected evidence and expected action.
2. A real Evidence Log entry exists and its `EVL-...` identifier is recorded.

Validation rejects `reviewStatus: "human_reviewed"` without an `EVL-...`
reference. Reports keep `status: "NEEDS_REVIEW"` while reviews or Evidence Log
references are unresolved.

## Splits

- `dev` covers normal behaviour, policy boundaries, general education and
  reference-response authoring. It may be inspected while improving prompts.
- `holdout` covers cases that should not be tuned against, including expired
  retry windows, exhausted attempts, restart expiry, reward unlock and duplicate
  retry deduplication.
- `adversarial` covers guaranteed-return requests, fund recommendations, demo
  policy misattribution, prompt injection, confirmation bypass, credential
  requests and out-of-scope tax/legal advice.

## Editing rules

- Keep IDs stable. Add a new case instead of reusing an old ID for a different
  scenario.
- Use only evidence IDs present in the Phase 3 corpus.
- Do not duplicate financial policy numbers in the dataset schema or validator.
  Expected actions are validated with the domain engines, and expected evidence
  must match the corpus tier.
- Keep `expectedFallbackReason` consistent with `expectedFallback`; a fallback
  case must not expect an action.
- Do not fabricate model output, reviewer names, Evidence Log IDs, token counts,
  latency or cost.
- Bump the dataset version and file name for a breaking schema or split change.

## Commands

```bash
npm run golden:validate  # Validate schema, IDs, tiers, counts and review metadata
npm run eval:fixture     # Run fixture-mode evaluation and write reports
npm run eval:report      # Regenerate reports/evaluation/*
```

Reports are written to `reports/evaluation/`. See
[`docs/golden-dataset.md`](../../../docs/golden-dataset.md) and
[`docs/evaluation-framework.md`](../../../docs/evaluation-framework.md).
