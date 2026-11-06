# Retrieval Design

Phase 3 provides a deterministic, explainable lexical retrieval layer for verified evidence. It does not use OpenAI, prompts, embeddings, a vector database, a relational database, or an external search service.

## Public entry point

The main function is `retrieveEvidence` in `src/lib/evidence/retrieval.ts`.

```ts
retrieveEvidence(
  {
    question: string,
    intent: EvidenceIntent,
    requestedSourceTier?: EvidenceSourceTier | null,
  },
  {
    corpus?: EvidenceRecord[],
    minScore?: number,
    topK?: number,
    includeUnverified?: boolean,
  } = {},
): RetrievalResult
```

Defaults:

- Corpus: `defaultEvidenceCorpus`, loaded from `src/lib/evidence/corpus.jsonl`.
- `minScore`: `DEFAULT_MIN_RELEVANCE_SCORE`, currently `0.2`.
- `topK`: `3`.
- `includeUnverified`: `false`.

## Pipeline

1. **Normalize the question.** Lowercase, Unicode-normalize, replace punctuation with spaces, and collapse whitespace.
2. **Tokenize.** Remove stop words and apply light deterministic suffix normalization for plurals and common verb endings.
3. **Apply safety routing.** Detect official-policy and account-specific requests before any ranking.
4. **Exclude unverified records.** A record is normally retrievable only when its status is `verified` or `fictional_demo`. `includeUnverified` is an explicit test/debug option and is not used by normal callers.
5. **Apply the source-tier constraint.** If a tier is requested, only records from that tier remain. An official-policy request forcibly sets the tier to `official_groww`.
6. **Filter by intent.** A record must list the requested intent in its `intents` array.
7. **Score.** Calculate BM25-style scores over the record title, text, and keywords.
8. **Rank.** Sort by score descending and then evidence ID ascending for stable tie-breaking.
9. **Apply `topK` and the relevance threshold.** Zero-score matches and scores below `minScore` are discarded.
10. **Return `NO_EVIDENCE` if nothing remains.** Otherwise return citation packet items with an explicit retrieval reason.

## Safety routing

### Official-policy questions

The request is treated as an official-policy query when any of these is true:

- The caller passes `intent: "official_groww_policy"`.
- The normalized question mentions Groww and policy/policies, and also asks whether it is actual, official, real, genuine, or "is this".

For these requests, the effective tier is forced to `official_groww` even if the caller requested `demo_policy` or `general_education`. If no official record matches, the result is:

```text
status: "NO_EVIDENCE"
noEvidenceReason: "OFFICIAL_EVIDENCE_UNAVAILABLE"
message: "I don't have verified official Groww documentation for this question."
```

Demo-policy records are never substituted.

### Account-specific questions

An explicit `intent: "account_specific"` always returns:

```text
status: "NO_EVIDENCE"
noEvidenceReason: "ACCOUNT_SPECIFIC_UNAVAILABLE"
message: "I don't have verified account-specific evidence for this question."
```

When the effective tier is `general_education`, the same refusal is applied to questions containing personal account wording such as "my account", "my folio", "my SIP", "my payment", "my instalment", "my bank", or "my transaction". General education is not allowed to assert account facts.

### Unverified records

`verificationStatus: "unverified"` records are excluded from normal retrieval. If a corpus contains only unverified records, the result is `NO_EVIDENCE` with reason `UNVERIFIED_ONLY`. Citation packets retain the `unverified` label if such a record is rendered directly in a test or diagnostic flow.

## Scoring

The scoring implementation is in `src/lib/evidence/scoring.ts`.

For a query term `t` in document `D`:

```text
score(D, Q) = Σ_t IDF(t) × (tf × (k1 + 1)) / (tf + k1 × (1 - b + b × |D| / avgdl))
IDF(t) = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
```

Parameters:

- `k1 = 1.2`
- `b = 0.75`
- `N` = number of intent-and-tier-filtered records
- `df(t)` = number of filtered records containing `t`
- `tf` = term frequency in the record
- `|D|` = record token count
- `avgdl` = average record token count

The indexed document text is the record title, text, and keywords. Scores are rounded to six decimal places for stable comparison.

Why the default threshold is low: the corpus is small and records are short. A threshold of `0.2` still rejects zero-overlap or extremely weak matches while allowing a one-term question such as "What is a SIP?" to retrieve the relevant education record. Tests can pass a higher `minScore` to verify threshold behavior.

No random sampling, model call, embedding, or external ranking is involved.

## Intent filtering

Retrieval uses exact intent membership. A record is eligible only if `record.intents.includes(query.intent)`. This keeps the corpus explainable and avoids relying on a model to infer topic boundaries.

Available intents cover:

- Demo-policy flows: retries, insufficient funds, retry limits, amount/debit-day modification, restart, reward progress, missed cycles, successful retry rewards, action confirmation, and simulated-action disclaimers.
- General education: SIP basics, market volatility, investment risk, guaranteed returns, long-term investing, SIP discipline, investor support, and SIP vs lump sum.
- Safety/routing: official Groww policy and account-specific questions. These have no records in the current corpus by design.

## Source-tier labels

Citation packets use the following human-readable labels:

| Tier | Label |
| --- | --- |
| `demo_policy` | `Demo policy — not Groww policy` |
| `general_education` | `General investor education` |
| `official_groww` | `Official Groww documentation` |

For non-demo sources, the source name is appended, for example `General investor education — SEBI Investor Education`. Demo citations always retain the fictional warning and never include a claim of external verification.

## Citation packet

`createCitationPacket` in `src/lib/evidence/citation.ts` produces one item per match:

```ts
{
  evidenceId: string;
  title: string;
  sourceTier: EvidenceSourceTier;
  sourceLabel: string;
  sourceName: string;
  excerpt: string;
  score: number;
  matchedTerms: string[];
  verificationStatus: EvidenceVerificationStatus;
  verificationLabel: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  applicableDemoPolicyVersion: string | null;
}
```

The packet also exposes `evidenceIds`. A future model may cite only those IDs. `validateCitationIds` reports invented IDs, and `assertCitationIdsInPacket` throws `CitationScopeError` for IDs outside the packet.

Excerpts are deterministic:

- Records at or below 320 characters are returned in full. This preserves demo-policy disclaimers.
- Longer records select the sentence with the largest overlap with the question terms, with the first sentence as the tie-breaker.
- Long excerpts are truncated with an ellipsis.

## NO_EVIDENCE reasons

| Reason | Meaning |
| --- | --- |
| `EMPTY_QUERY` | The question is empty. |
| `ACCOUNT_SPECIFIC_UNAVAILABLE` | The request asks for account-specific evidence, which is not available. |
| `OFFICIAL_EVIDENCE_UNAVAILABLE` | Official-policy evidence is unavailable. |
| `NO_MATCHING_INTENT` | The tier has records, but none list the requested intent. |
| `NO_TIER_MATCH` | The requested tier has no retrievable records. |
| `UNVERIFIED_ONLY` | The available records are all unverified. |
| `BELOW_THRESHOLD` | Records matched the intent/tier, but none met the relevance threshold. |

## Tests

`test/evidence.test.ts` covers the 18 required Phase 3 cases:

1. Complete corpus schema validation.
2. Duplicate ID rejection.
3. Malformed record rejection.
4. Intent filtering.
5. Source-tier filtering.
6. Retry evidence retrieval.
7. Market-volatility evidence retrieval.
8. Reward evidence retrieval.
9. Official query with an empty official corpus.
10. Demo policy cannot satisfy an official query.
11. General education cannot satisfy an account-specific question.
12. Unverified records are excluded and labelled correctly.
13. Citation IDs must exist in the retrieved packet.
14. Deterministic ranking across calls and corpus order.
15. Stable ID tie-breaking.
16. Minimum relevance threshold.
17. No relevant evidence returns `NO_EVIDENCE`.
18. Excerpts, source labels, and verification labels.

## Known limitations

- Lexical retrieval can miss paraphrases and synonyms that do not share tokens. Keywords partially mitigate this, but there is no semantic embedding layer.
- The general-education corpus is small and broad. It is not tailored to a product, tax situation, or investor.
- The official Groww tier is empty in this corpus version.
- The threshold is calibrated for this small corpus, not for a production-sized evidence set.
- Intent selection is supplied by the caller in this phase; there is no model-based intent classifier yet.
- There is no UI, prompt, assistant integration, persistence layer, or evaluation dataset yet.
- Retrieval results are evidence candidates, not financial advice. A future assistant layer must still apply its own instruction and safety constraints.
