# Golden Dataset

## Purpose

The golden dataset is a versioned, hand-authored set of investor questions and
expected behaviour for the future OpenAI-powered SIP Continuity Assistant. It
lets Phase 4 measure intent classification, evidence retrieval, citation scope,
deterministic financial facts, action eligibility, safety and fallback
behaviour **before** any model is connected.

The dataset is not model output. It is not evidence that a live model passes.
All reference responses were written by hand for the graduation project.

## Files

| File | Purpose |
| --- | --- |
| `src/data/golden/golden.v1.jsonl` | 48 golden cases, one JSON object per line. |
| `src/data/golden/README.md` | Authoring contract and review status. |
| `src/data/evaluation/fixture-responses.v1.jsonl` | Handcrafted candidate responses used only for fixture-mode evaluation. |
| `src/lib/evaluation/types.ts` | Dataset enums, case schema and report types. |
| `src/lib/evaluation/schema.ts` | Strict parsing, cross-field validation and fixtures validation. |
| `src/lib/evaluation/loader.ts` | JSONL loading, hashing and typed validation errors. |
| `src/lib/evaluation/state-variants.ts` | Deterministic demo-state variants. |

The dataset version is `golden-v1.0.0`. Its SHA-256 hash is recorded in every
report so a result can be tied to exact bytes.

## Splits

| Split | Count | Purpose |
| --- | ---: | --- |
| `dev` | 29 | Normal behaviour, policy boundaries, general education and reference authoring. Safe to inspect while improving prompts. |
| `holdout` | 12 | Cases kept out of prompt tuning: expired windows, exhausted attempts, restart expiry, reward unlock, duplicate retry, fabricated citations and replay. |
| `adversarial` | 7 | Guaranteed returns, fund recommendations, demo misattribution, prompt injection, confirmation bypass, credential requests and tax/legal scope. |
| **Total** | **48** | |

Split counts are enforced by validation. A dataset with 47 or 49 cases fails.

## Coverage

The cases collectively cover:

1. Insufficient money this month.
2. SIP payment failure.
3. Retry inside the seven-day window.
4. Retry outside the seven-day window.
5. Maximum retry attempts reached.
6. Market volatility concerns.
7. Guaranteed-return requests.
8. Specific mutual-fund recommendations.
9. SIP amount modification.
10. Amount below ₹500.
11. Amount above ₹25,000.
12. Debit-day modification.
13. Invalid debit day.
14. Restart inside 90 days.
15. Restart after 90 days.
16. Reward progress at 11/12.
17. Reward unlock at 12/12.
18. Missed-cycle reward preservation.
19. Duplicate retry prevention.
20. Questions about actual Groww policy.
21. Account-specific information without verified account data.
22. Missing evidence.
23. Fabricated citations.
24. Fictional demo policy misrepresented as official Groww policy.
25. Prompt injection.
26. Requests to bypass confirmation.
27. Requests for OTPs or banking credentials.
28. Out-of-scope tax or legal advice.
29. Model timeout or unavailability.
30. Action-token replay limitations.

Boundary cases target the exact policy edges: the ₹500/₹25,000 amount limits,
the day-1–28 debit-day range, the inclusive seven-day retry window and the
inclusive 90-day restart window. Expected evidence IDs are checked against the
Phase 3 corpus, and expected actions are checked with the domain engines rather
than duplicated constants.

## Case contract

Every case contains the required fields described in
`src/data/golden/README.md`. Important invariants:

- IDs are unique and stable.
- `datasetVersion` equals `golden-v1.0.0`.
- `split`, `category`, `severity`, `expectedIntent`, `demoStateVariant`,
  `expectedAction.type`, `expectedFallbackReason` and `reviewStatus` are valid
  enums.
- Every `expectedEvidenceIds` value exists in the evidence corpus.
- Every expected evidence record supports `expectedIntent` and belongs to the
  tier implied by that intent:
  - demo intents → `demo_policy`
  - general-education intents → `general_education`
  - official Groww questions → `official_groww`
  - account-specific questions carry no evidence.
- `expectedFallback: false` requires `expectedFallbackReason: "NONE"`.
- `expectedFallback: true` requires a non-`NONE` reason and `expectedAction` must
  be `NONE`.
- Fallback reasons that mean “evidence cannot answer” require an empty evidence
  list.
- Every required term in `expectedResponsePoints` appears in the human reference
  response.
- No `prohibitedClaims` string appears in the human reference response.
- Response-point IDs are unique per case.

Validation rejects unknown fields as well as missing fields. It does not accept
extra metadata that the runner cannot evaluate.

## Financial-state variants

Cases reference a deterministic `demoStateVariant`:

- `base` — 11/12 instalments, current November debit failed, retry available.
- `retry_window_expired` — demo date moved beyond the inclusive window.
- `retry_attempts_exhausted` — the failed cycle has used every retry.
- `restart_eligible` — paused 30 days before the demo date.
- `restart_expired` — paused beyond the 90-day window.
- `reward_unlocked` — the current cycle is paid, reaching 12/12.
- `missed_cycle` — one earlier cycle is missed, progress is preserved at 10/12.
- `duplicate_retry` — a duplicate retry record exists but the cycle counts once.

State variants are built from `cloneDemoInvestorState()` and policy constants.
The dataset never stores a second copy of monthly amount, retry window, amount
limits, debit-day limits, restart window or reward target.

## Review status and Evidence Log traceability

All 48 cases are `pending_human_review` and `evidenceLogReference: null`.
No human has approved them and no AI Evidence Log exists in this project.

`evidenceLogReference` may be:

- `null` — unresolved; the default.
- `"pending"` — an explicit unresolved placeholder.
- `EVL-...` — a real identifier that must exist in the graduation project's AI
  Evidence Log.

A case cannot be marked `human_reviewed` without an `EVL-...` reference.
Validation does not verify that an external Evidence Log entry exists because
this repository has no Evidence Log store. The report therefore lists every
unresolved reference for manual follow-up.

## Validation commands

```bash
npm run golden:validate
```

The command loads `golden.v1.jsonl`, parses every line, validates schema and
cross-field rules, counts splits and categories, and exits non-zero on failure.
It prints the dataset hash, corpus version, pending human reviews and unresolved
Evidence Log references.

## Known limitations

- The dataset is small and hand-authored; it cannot cover every phrasing.
- `expectedResponsePoints` use exact required terms for objective checks. Passing
  them does not prove semantic groundedness.
- The dataset does not contain live-model completions.
- Review status reflects the absence of a real human review workflow.
- Evidence Log traceability is structurally enforced but not externally
  verified.
- English-only questions.
