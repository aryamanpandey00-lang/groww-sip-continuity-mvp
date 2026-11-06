# Groww SIP Continuity MVP

A Groww-inspired graduation project demo with a mobile-first SIP Continuity Assistant. Phase 6E.2 completes the UI and browser verification. The app includes a deterministic domain engine, evidence retrieval, a server-side optional AI pipeline, six assistant journeys and four simulated SIP actions. No database or real Groww, payment or transaction integration is connected; AI is disabled by default.

> This is an independent educational project. It is not affiliated with, endorsed by, or connected to Groww. All investors, funds, policies and values are fictional.

## Phase 1 scope (complete)

- Next.js 16 App Router application shell
- React 19 + TypeScript strict mode
- Tailwind CSS 4 Groww-inspired styling
- Responsive mobile-first dashboard
- Header branding, demo profile and desktop navigation
- Portfolio summary with fictional values
- Quick actions: Mutual Funds, Stocks, Add Money, My SIPs
- SIP status card with a simulated failed payment
- SIP Continuity Assistant dashboard entry card and interactive assistant page
- 12-month milestone progress card using a fictional demo rule
- Bottom navigation: Home, Explore, Investments, Profile
- Placeholder pages for explore, investments, SIPs, add money and profile
- Vitest fixture and formatter tests

## Phase 2 scope

Deterministic domain modules under `src/lib/domain/`:

- `types.ts` — shared dashboard and domain types
- `policy.ts` — fictional demo policy v1.1 constants
- `clock.ts` — injectable fixed clock; business rules never read the live clock
- `date-utils.ts` — timezone-safe UTC date-only arithmetic
- `sip-engine.ts` — schedule, retry deadline, retry eligibility, attempt limits, payment state
- `modification-engine.ts` — amount and debit-day validation, next-cycle preview
- `restart-engine.ts` — 90-day restart eligibility and progress preservation
- `reward-engine.ts` — eligible instalment counting, deduplication and voucher unlock state
- `action-engine.ts` — deterministic preview, confirmation and simulated application state machine
- `fixtures/demo-investor.ts` — deterministic domain state source of truth
- `fixtures/demo-dashboard.ts` — presentation values derived from the domain state and engines

## Phase 3 scope

Deterministic evidence and retrieval modules under `src/lib/evidence/`:

- `types.ts` — evidence tiers, intents, records, queries, retrieval results and citation packets
- `schema.ts` — dependency-free strict validation, cross-field safety rules and duplicate-ID checks
- `loader.ts` — JSONL parsing, line-numbered errors, demo-policy template hydration and default corpus loading
- `scoring.ts` — normalization, tokenization and deterministic BM25-style lexical scoring
- `retrieval.ts` — intent/tier filtering, official-policy routing, account-specific safety and `NO_EVIDENCE`
- `citation.ts` — source labels, verification labels, excerpts, citation packets and citation-ID scope checks
- `index.ts` — public evidence exports and corpus version
- `corpus.jsonl` — human-readable version-controlled evidence corpus

Current corpus population:

- 11 `demo_policy` records: retry window, insufficient funds, attempt limits, amount and debit-day modification, restart, reward progress, missed cycles, successful retry rewards, action confirmation and the simulated-action disclaimer.
- 8 `general_education` records: SIP basics, market volatility, investment risk, no guaranteed returns, long-term investing, SIP discipline, investor support and SIP vs lump-sum investing.
- 0 `official_groww` records. The tier is intentionally empty because no official Groww document was verified for this corpus version. Official-policy questions therefore return an explicit insufficient-evidence result.

Demo-policy values are hydrated from `src/lib/domain/policy.ts` through placeholders in `corpus.jsonl`, so the policy constants remain the single source of truth. Unverified records are excluded from normal retrieval, and citation labels preserve tier and verification status.

See [`docs/evidence-policy.md`](docs/evidence-policy.md) and [`docs/retrieval-design.md`](docs/retrieval-design.md) for the full source verification, scoring, citation and safety rules.

## Phase 4 scope

Versioned golden dataset and deterministic offline evaluation under
`src/data/golden/` and `src/lib/evaluation/`:

- `src/data/golden/golden.v1.jsonl` — 48 hand-authored cases: 29 `dev`, 12 `holdout` and 7 `adversarial`.
- `src/data/golden/README.md` — authoring contract, review status and Evidence Log rules.
- `src/data/evaluation/fixture-responses.v1.jsonl` — handcrafted candidate responses used only for fixture-mode evaluation.
- `src/lib/evaluation/types.ts` — dataset enums, case/fixture types, metrics and report schema.
- `src/lib/evaluation/schema.ts` — strict required-field, enum, duplicate-ID, evidence-ID, tier, action, fallback, review and Evidence Log validation.
- `src/lib/evaluation/loader.ts` — JSONL loading, line-numbered errors, SHA-256 hashing and typed validation errors.
- `src/lib/evaluation/state-variants.ts` — deterministic demo states derived from the Phase 2 fixture and policy.
- `src/lib/evaluation/facts.ts` — domain-derived financial facts, action previews and fact comparison.
- `src/lib/evaluation/runner.ts` — per-case retrieval, citation, fact, action, safety and fallback evaluation.
- `src/lib/evaluation/metrics.ts` — overall/split metrics, configurable thresholds and status gates.
- `src/lib/evaluation/report.ts` — machine-readable JSON and Markdown reports under `reports/evaluation/`.
- `src/lib/evaluation/pipeline.ts` and `cli.ts` — fixture-mode pipeline and command-line entry points.

Phase 4 evaluates handcrafted reference fixtures, not live model output. It does
not call OpenAI, read `OPENAI_API_KEY`, create AI routes, add a database, use
embeddings, or execute transactions. The report always records
`liveModelOutputs: false` and `modelCallsMade: 0`.

All 48 cases remain `pending_human_review` with unresolved Evidence Log
references. Fixture success therefore yields `NEEDS_REVIEW`, not approval. The
report includes a human-review rubric and does not treat unassessed subjective
criteria as passed.

See [`docs/golden-dataset.md`](docs/golden-dataset.md) and
[`docs/evaluation-framework.md`](docs/evaluation-framework.md) for dataset
design, metrics, thresholds, Evidence Log traceability and deployment gates.

## Phase 5 scope

Server-only, deterministic-first assistant orchestration under `src/lib/ai/`.
Phase 5 is exposed through the secure Phase 6B API route and Phase 6C browser UI.
The UI keeps messages in React state and sends only the latest question,
selected category and server-allowlisted demo scenario. No database or real
SIP/payment integration is present.

- `types.ts` — assistant intents, actions, statuses, quality labels, fallback
  reasons, context packet and result contracts.
- `config.ts` — fail-closed environment configuration for
  `ASSISTANT_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL` and
  `MAX_OUTPUT_TOKENS`.
- `intent.ts` — deterministic classification of all 14 supported intents, with
  safety-critical overrides taking precedence over the selected category.
- `missing-info.ts` — deterministic clarification checks that run before any
  model call.
- `context.ts` — read-only context packet built from Phase 2 verified facts and
  the Phase 3 retrieval packet.
- `prompts.ts` — fixed system rules and a user prompt that treats the question
  as untrusted data.
- `schemas.ts` — strict JSON Schema for Structured Outputs and a defensive
  parser that rejects extra properties, invalid actions and unsafe values.
- `client.ts` — lazy, `server-only` OpenAI Responses API adapter using the
  configured model, `text.format`, `max_output_tokens`, timeout, no SDK retries
  and `store: false`.
- `gate.ts` — mandatory runtime safety gate covering schema, intent, citations,
  evidence tiers, demo-policy attribution, account-specific separation,
  amounts, dates, payment/SIP state, action allowlist and domain previews,
  guarantee/fund/tax-legal claims, execution claims, credential requests,
  prompt injection and chain-of-thought disclosure.
- `fallbacks.ts` — deterministic safe responses and the mapping to the Phase 4
  fallback contract.
- `logger.ts` — allowlisted structured logging with no keys, prompts,
  credentials or personal data.
- `pipeline.ts` — sequence: deterministic checks → retrieval → model → gate →
  one repair → gate again → deterministic fallback.

The model path is: `model → runtime gate → one bounded repair → gate again →
deterministic fallback`. A critical gate failure always blocks approval and
display. The model never receives the API key, never executes an action, and
never controls the quality label or final safety decision.

OpenAI is optional and disabled by default. Tests and fixture evaluation run
offline with mocked model clients and do not require a live key. `OPENAI_MODEL`
must be supplied explicitly; there is no hardcoded or silently substituted
model. `.env.example` contains placeholders only. Any live call requires an
explicitly configured key and separate authorization.

See [`docs/assistant-integration.md`](docs/assistant-integration.md) for the
request sequence, schema, gate checks, repair/fallback behaviour, logging
allowlist, limits and test strategy.

## Demo policy v1.1

This policy exists only for the graduation demonstration and must never be presented as actual Groww policy.

- Retry window: 7 calendar days after a failed debit, inclusive.
- Maximum retry attempts: 3 per scheduled cycle.
- A successful retry inside the window counts as exactly one eligible instalment.
- A scheduled cycle can count only once, even if duplicate retry records exist.
- Monthly SIP amount range: ₹500–₹25,000.
- Debit day range: 1–28, chosen to avoid month-end and leap-day ambiguity.
- Amount and debit-day changes take effect from the next monthly cycle.
- Restart is allowed within 90 calendar days of pausing or stopping, inclusive.
- Restart requires explicit confirmation and preserves reward progress.
- Reward target: 12 eligible instalments. Missed cycles delay but do not reset progress.
- The ₹500 voucher unlocks at 12 eligible instalments and is always labelled simulated and non-redeemable.

## Demo data

`src/lib/domain/fixtures/demo-investor.ts` is the single typed source of truth for the deterministic domain state. `src/lib/domain/fixtures/demo-dashboard.ts` derives the dashboard's SIP, retry and reward values from it.

The fixed scenario is:

- Demo date: 12 November 2026
- Demo Investor 001
- Fictional Flexi Cap Fund — Demo Only
- ₹5,000 monthly SIP, debit day 10
- 11 successful eligible instalments from Dec 2025 to Oct 2026
- 10 November 2026 payment failed due to simulated insufficient balance
- Retry deadline: 17 November 2026
- Reward progress: 11 / 12, locked

A successful simulated retry on or before 17 November 2026 moves progress to 12 / 12 and unlocks the simulated voucher.

## Phase 6 assistant experience

The assistant offers six journeys: insufficient funds, failed SIP payment,
market uncertainty, SIP amount or debit-day changes, restarting a paused SIP,
and 12-month reward progress.

Deterministic practice mode works without AI. It supports four simulated
actions: retry a failed payment, modify the monthly amount, modify the debit
day, and restart a paused SIP. Each action requires a server-created preview
and explicit confirmation. The state is fictional, browser-session-only, and
resettable; the dashboard remains an independent static snapshot.

## Known limitations and out of scope

- Streaming responses or persistent conversation history
- Database, persistent server-side action state or user accounts
- Live-model evaluation results mixed with fixture results
- Embeddings, vector search or a relational database
- Real Groww integration, real payment, SIP, reward or transaction functionality
- Authentication, KYC or real investor data
- Shared durable action state is not configured. Production action routes return
  HTTP 503 until an atomic shared session store is wired in; local session guards
  cannot survive a process restart or coordinate multiple instances.
- Deployment-wide AI token budgeting is not configured. Production model calls
  fail closed without an injected atomic shared budget coordinator; AI remains
  disabled by default and process-local request limits are only local safeguards.
- Human review of the 48 golden cases and resolution of their 48 Evidence Log references
- Live-model quality evaluation
- An Evidence Log registry to verify that referenced EVL records actually exist

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

No environment variables are required for the dashboard, tests or fixture
evaluation. Deterministic practice actions require a stable
`ACTION_SESSION_SIGNING_SECRET`. For local practice, copy `.env.example` to the
ignored `.env.local` file and set this secret to a cryptographically random
value of at least 32 UTF-8 bytes. Do not commit it; do not rotate it between
requests. If it is missing or invalid, simulated-action endpoints are
unavailable.

AI remains disabled by default. For this demo, leave `OPENAI_API_KEY` and
`OPENAI_MODEL` unset. Both are server-only; never expose a key through a
`NEXT_PUBLIC_` variable. The model name is not defaulted or substituted, and
missing required AI configuration fails closed without a model request.
Evaluation commands do not make live model calls. Fixture evaluation is not
live-model validation.

## Commands

```bash
npm run dev            # Start the local development server
npm run build          # Production build
npm run start          # Start the production build
npm run lint           # ESLint
npm run typecheck      # TypeScript strict check
npm run test           # Vitest
npm run test:watch     # Vitest watch mode
npm run golden:validate # Validate the versioned golden dataset
npm run eval:fixture   # Run fixture-mode evaluation and write reports
npm run eval:report    # Regenerate the machine-readable evaluation reports
```

## Structure

```text
src/
  app/
    layout.tsx
    page.tsx
    globals.css
    assistant/page.tsx
    explore/page.tsx
    investments/page.tsx
    sips/page.tsx
    add-money/page.tsx
    profile/page.tsx
  components/
    layout/
    dashboard/
    ui/
  lib/
    domain/
      types.ts
      policy.ts
      clock.ts
      date-utils.ts
      sip-engine.ts
      modification-engine.ts
      restart-engine.ts
      reward-engine.ts
      action-engine.ts
      fixtures/demo-investor.ts
      fixtures/demo-dashboard.ts
    evidence/
      types.ts
      schema.ts
      loader.ts
      scoring.ts
      retrieval.ts
      citation.ts
      index.ts
      corpus.jsonl
    ai/
      types.ts
      config.ts
      schemas.ts
      intent.ts
      missing-info.ts
      context.ts
      prompts.ts
      client.ts
      gate.ts
      fallbacks.ts
      logger.ts
      pipeline.ts
      index.ts
    evaluation/
      types.ts
      schema.ts
      loader.ts
      state-variants.ts
      facts.ts
      runner.ts
      metrics.ts
      report.ts
      pipeline.ts
      cli.ts
      index.ts
    utils/format.ts
  data/
    golden/
      golden.v1.jsonl
      README.md
    evaluation/
      fixture-responses.v1.jsonl
docs/
  evidence-policy.md
  retrieval-design.md
  golden-dataset.md
  evaluation-framework.md
  assistant-integration.md
  phase8b-remediation.md
reports/
  evaluation/
    fixture-report.v1.1.json
    fixture-report.v1.1.md
test/
  dashboard-fixture.test.ts
  date-utils.test.ts
  sip-engine.test.ts
  modification-engine.test.ts
  restart-engine.test.ts
  reward-engine.test.ts
  action-engine.test.ts
  evidence.test.ts
  golden-dataset.test.ts
  evaluation-framework.test.ts
  helpers/domain-state.ts
  helpers/server-only.ts
  ai/
    config.test.ts
    schemas.test.ts
    intent-missing-info.test.ts
    gate.test.ts
    pipeline.test.ts
    client.test.ts
    isolation.test.ts
    fixtures.ts
```

## Visual direction

White backgrounds, green `#00D09C` accents, dark neutral typography, rounded cards, soft borders and clean spacing. The layout is mobile-first and uses a fixed bottom navigation on small screens, with desktop navigation in the header. The assistant page uses the existing shell and navigation.

## Project status

Phase 6E.2 UI implementation and manual browser verification are complete.
Phase 7A audited deployment readiness, and Phase 7B prepares source control.
No Vercel deployment or live OpenAI evaluation has been performed. The fixture
report remains `NEEDS_REVIEW` until its human reviews and Evidence Log
references are resolved.
