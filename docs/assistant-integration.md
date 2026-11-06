# Assistant Integration

## Scope

Phases 5 and 6B provide a **server-only, deterministic-first** assistant
pipeline and secure API route for the fictional SIP Continuity demo. Phase 6C
adds a responsive assistant UI with browser-session-only transcript state. The
project still has no database, real SIP/payment integration or live-model
evaluation report.

The pipeline can call the OpenAI Responses API only when all required
configuration is present. Tests, fixture evaluation and the current dashboard
run offline and never require a live key. **No live OpenAI call was made while
implementing Phase 5.**

## Configuration and fail-closed behaviour

| Variable | Required | Behaviour |
| --- | --- | --- |
| `ASSISTANT_ENABLED` | Yes, for the model path | Must be exactly `true`. Any other value disables the assistant. |
| `OPENAI_API_KEY` | Yes, for the model path | Server-only. Never exposed through `NEXT_PUBLIC_*`, browser bundles, client requests, logs or prompts. |
| `OPENAI_MODEL` | Yes, for the model path | Used exactly as configured. There is no hardcoded default or silent substitution. |
| `MAX_OUTPUT_TOKENS` | No | Optional output limit, bounded to `64..2000`; defaults to `700`. |

Additional server-side limits:

- request timeout: 15 seconds;
- maximum user question length: 2,000 characters;
- SDK retries: disabled;
- `store: false` on the Responses API request.

Missing or invalid configuration returns `Assistant unavailable` without
constructing a client or making a model call. `ASSISTANT_ENABLED=false` is the
default safe state.

`.env.example` contains placeholders only:

```bash
ASSISTANT_ENABLED=false
OPENAI_API_KEY=
OPENAI_MODEL=
MAX_OUTPUT_TOKENS=700
```

The API route also has a bounded in-memory, per-instance rate limiter for demo
use. It does **not** provide distributed/global rate limiting. A public
deployment needs a trusted shared or edge rate limiter before paid model access
is enabled. The application has no authentication in v1.

## Modules

All modules live under `src/lib/ai/`.

| Module | Responsibility |
| --- | --- |
| `types.ts` | Intents, actions, statuses, quality labels, fallback reasons, context packet and result contracts. |
| `config.ts` | Explicit environment resolution with fail-closed defaults and bounded output tokens. |
| `intent.ts` | Deterministic classification of all 14 intents, safety overrides and evidence-intent mapping. |
| `missing-info.ts` | Pre-model clarification checks for missing modification/restart details. |
| `context.ts` | Read-only context packet built from verified facts, retrieval results and requested values. |
| `prompts.ts` | Fixed system rules, authoritative facts/evidence prompt and bounded repair prompt. |
| `schemas.ts` | Strict JSON Schema for Structured Outputs plus a defensive parser and length checks. |
| `client.ts` | Child-safe `server-only` OpenAI Responses API adapter. Loaded lazily only on the model path. |
| `gate.ts` | Mandatory runtime safety gate; any critical failure blocks approval and display. |
| `fallbacks.ts` | Deterministic safe responses, server-derived quality labels and the Phase 4 fallback mapping. |
| `logger.ts` | Allowlisted structured request logging. |
| `pipeline.ts` | Orchestration, one repair attempt, fallback selection and final result construction. |
| `index.ts` | Public server-side exports. |

The OpenAI SDK is imported only by `client.ts`, which starts with
`import "server-only";`. App and component layers do not import `src/lib/ai`.

## Deterministic intents

The supported intents are:

1. `INSUFFICIENT_FUNDS`
2. `PAYMENT_FAILED`
3. `MARKET_UNCERTAINTY`
4. `MODIFY_SIP`
5. `RESTART_SIP`
6. `REWARD_MILESTONE`
7. `GENERAL_SIP_EDUCATION`
8. `OFFICIAL_GROWW_POLICY`
9. `ACCOUNT_SPECIFIC`
10. `GUARANTEED_RETURN_REQUEST`
11. `FUND_RECOMMENDATION_REQUEST`
12. `OUT_OF_SCOPE`
13. `PROMPT_INJECTION`
14. `INSUFFICIENT_EVIDENCE`

The selected problem category is initial context only. Safety-critical
classification such as guaranteed returns, fund recommendations, credential
requests, prompt injection, account-specific requests or official-policy
questions overrides the selected category. The model cannot override the
deterministic intent: a mismatch is a gate failure.

## Request sequence

1. Validate the user input length and basic shape.
2. Classify the intent deterministically and retrieve Phase 3 evidence.
3. Run deterministic missing-information checks. If a required modification or
   restart value is missing, ask exactly one clarification question and **do not
   call the model**.
4. Build a read-only context packet from Phase 2 verified facts and the Phase 3
   retrieval packet, including allowed amounts, dates, evidence IDs and preview
   action types.
5. Resolve configuration. Missing/disabled configuration returns
   `Assistant unavailable` without a model call.
6. Call the model only when the path is approved. The request uses the configured
   model, strict JSON Schema, bounded output tokens, timeout and `store: false`.
7. Run the runtime gate.
8. On repairable failure, make **one** repair request with failure codes and a
   bounded rejected-output snippet, then run the gate again.
9. If the second gate fails, or the model is unavailable/timed out, return a
   deterministic safe fallback. There are no unbounded retries.
10. Emit one structured log event with allowlisted fields only.

## Structured output

The model must return exactly one JSON object with these properties:

| Field | Contract |
| --- | --- |
| `intent` | One of the 14 deterministic intents; must equal the packet intent. |
| `directAnswer` | Bounded answer text. |
| `keyPoints` | Bounded list of short points. |
| `citedEvidenceIds` | Only IDs retrieved into the packet. |
| `proposedAction` | One of the predefined preview action variants. |
| `followUpQuestion` | Empty when no clarification is needed. |
| `refusal` | Boolean; a refusal must use `NONE` and make no action proposal. |

Allowed preview actions are:

- `{ "type": "NONE" }`
- `{ "type": "RETRY_PAYMENT", "cycleId": "..." }`
- `{ "type": "MODIFY_AMOUNT", "amount": 6000 }`
- `{ "type": "MODIFY_DEBIT_DAY", "debitDay": 15 }`
- `{ "type": "RESTART_SIP" }`

Extra properties, unknown actions, duplicate citations and non-predefined values
are rejected. The parser also enforces length limits that are not expressed with
unsupported JSON Schema keywords.

## Facts, evidence and citations

- Facts come from Phase 2 domain engines through the verified-facts builder.
  They are supplied to the model as authoritative context and are not
  recalculated by the model.
- Evidence comes from the Phase 3 retrieval engine. Official-policy questions
  require `official_groww` evidence; that tier is intentionally empty in the
  current corpus, so the deterministic fallback is returned.
- Demo-policy intents require `demo_policy` evidence and must label it as
  fictional/demo policy. The gate blocks attributing it to Groww.
- General-education intents require `general_education` evidence. General
  education cannot support account-specific financial claims.
- Account-specific requests without verified account evidence are refused
  deterministically.
- Factual guidance must cite at least one retrieved evidence ID.
- The pipeline sanitizes only the retrieval question for general-education and
  safety intents (for example, "my SIP" becomes "a SIP") so Phase 3's
  account-specific guard does not incorrectly suppress general evidence. The
  original question remains in the context packet.

## Runtime safety gate

The gate runs after every model response, including a repair response. It checks:

| Area | Critical failures |
| --- | --- |
| Schema | Malformed JSON, missing/extra fields, invalid action shape, unsafe values |
| Intent | Model intent differs from deterministic intent |
| Citations | Citation outside packet, duplicate citation, missing citations, missing required evidence tier |
| Demo attribution | Demo policy not labelled fictional/demo, or attributed to Groww |
| Account separation | Unsupported account-specific answer, general education used for account claims |
| Amounts and dates | Invented amounts/dates, action amount/day not explicitly requested, false current monthly amount |
| Payment/SIP state | Status contradiction, false retry/restart eligibility, denied failed payment, false reward unlock |
| Actions | Action not allowed for intent, action absent from allowed list, illegal parameters, wrong retry cycle, refusal with action, domain preview not `PREVIEWED` |
| Financial advice | Guaranteed returns, specific fund recommendation, unsupported tax/legal/regulatory advice |
| Execution | Claims that a payment, retry, modification, restart or reward was executed/applied |
| Credentials | Requests for OTP, PAN, password, PIN, CVV, card/bank credentials |
| Prompt safety | Prompt-injection override, system-prompt disclosure, chain-of-thought/hidden-reasoning disclosure |

A single critical failure sets `passed: false` and `qualityLabel: null`. The
pipeline never displays that response. Execution remains impossible because the
gate calls only the deterministic preview function, never an apply function.

## Repair and fallbacks

The pipeline permits exactly one repair attempt for repairable gate failures and
invalid model output. Timeouts, unavailable models and missing configuration do
not trigger repair.

Server-derived quality labels are:

- `Evidence-backed`
- `Limited evidence`
- `Safety guidance`
- `Need more information`
- `Safe fallback`
- `Assistant unavailable`

The model cannot supply or override a label. The UI displays the label and
status supplied by the server rather than guessing from response text.

Fallbacks are deterministic and include:

- missing/disabled configuration;
- invalid input;
- missing information;
- official evidence unavailable;
- account-specific evidence unavailable;
- insufficient evidence;
- model timeout/unavailability;
- safety refusal;
- gate/repair failure.

## Concurrency and state safety

The pipeline clones the demo state before previewing actions. It never mutates
the caller's state, never applies an action and always reports
`executionPerformed: false`. A proposed action is only a preview and requires
separate explicit confirmation before the Phase 6D domain application flow.

## Structured logging

Each request emits one JSON event through an injectable logger. The allowlist is:

- request ID;
- deterministic intent;
- retrieved evidence IDs;
- gate pass/failure codes;
- fallback reason;
- server-derived quality label;
- model ID when the API provides it;
- total latency in milliseconds;
- API-provided token usage only;
- model-call count and a flag showing whether usage is complete across attempts;
- repair attempt flags;
- timestamp.

The logger does not include the API key, prompts, system instructions, user
questions, answer text, credentials or personal data. The current implementation
adds usage from the initial and repair calls, including invalid or incomplete
Responses API results. Missing or inconsistent usage is marked incomplete. A
budget reservation is charged at its reserved maximum when actual usage cannot
be trusted.

Each attempt reserves a conservative input-plus-output token bound before the
model call. Local development uses a process-local hourly budget. Production
requires an injected coordinator whose reservations and settlements are atomic
across the deployment; without one, the model path returns unavailable before
calling the provider. No shared coordinator is included in this repository.

## OpenAI SDK approach

Phase 5 uses `openai@6.49.0` and the Responses API:

- `client.responses.create(...)`;
- `instructions` for the fixed system rules;
- `input` for the authoritative facts/evidence packet and untrusted question;
- `text.format` with `type: "json_schema"`, `strict: true` and the versioned
  schema name `groww_sip_assistant_response_v1`;
- `max_output_tokens` from configuration;
- `timeout` and `maxRetries: 0` at both the client and request level;
- `store: false`;
- usage read only from the API response;
- SDK errors mapped to safe timeout/unavailable codes without exposing error
  text.

The client is constructed lazily on the model path so offline deterministic
paths do not instantiate the SDK.

## Phase 6B API route

`POST /api/assistant` accepts only the latest question, an optional supported
problem category, and an optional server-allowlisted fictional demo scenario.
The route rejects unknown fields, bounds the body to 8 KiB and the question to
the existing 2,000-character limit, and requires an exact same-origin `Origin`
header. The browser cannot submit account state, evidence, policy values,
permissions or model instructions. The response is an allowlisted public DTO;
it does not serialize the internal `AssistantResult`, gate diagnostics, model
telemetry or provider errors. Action previews remain `null` in this phase.

The route uses a bounded per-process request limiter (10 requests per minute per
key, at most two concurrent requests per key and 20 total concurrent requests).
The application cannot prove that incoming forwarded-IP headers were normalized
by a trusted proxy, so it deliberately ignores `X-Real-IP` and
`X-Forwarded-For`; requests share one in-process demo identity. This prevents
clients from rotating spoofed headers to bypass the local quota, but it is a
coarse shared limit and may throttle unrelated demo users. A public deployment
must put a trusted shared or edge rate limiter in front of the route before
enabling paid model access. The assistant kill switch remains off by default.

Each OpenAI call has the existing 15-second timeout and the pipeline permits at
most one repair call, so a model request can take about 30 seconds plus route
overhead. Deployment execution limits must allow for that path; this project
does not specify or configure a hosting provider timeout.

## Offline tests and evaluation

Phase 5 uses mocked model clients for unit/integration tests. Tests cover:

- every config failure mode and the exact `true` kill switch;
- strict schema rejection and extra properties;
- pre-model clarification;
- no-evidence official and account-specific fallbacks;
- safety refusals;
- all gate critical failure classes, including action parameter checks and
  requested-value consistency;
- one successful repair, one failed repair, invalid output and timeout;
- no action execution and no caller-state mutation;
- log allowlisting and key/prompt absence;
- server-only isolation and `.env.example` placeholders;
- Phase 4 fallback mapping, fixture mode and human-review preservation.

## Phase 6C assistant UI

The `/assistant` page sends only the current question, selected problem
category and server-allowlisted scenario. It does not send prior messages,
account state, evidence or action permissions. Conversation text is kept only
in React state and is cleared by a page refresh or the Clear conversation
control. SIP-change clarification can retain only explicitly parsed amount and
debit-day values in component state to build a standalone next question.

The client renders plain text from the public API DTO, server-provided status
and quality labels, and only API citations. Source links are limited to HTTP or
HTTPS. Assistant-disabled API responses are shown as unavailable and do not
create an AI-authorized preview. No live model behavior has been validated.

## Phase 6D simulated actions

The four actions already implemented by the Phase 2 domain engine are supported:

- retry a fictional failed SIP payment (`RETRY_PAYMENT`);
- modify the fictional monthly amount (`MODIFY_AMOUNT`);
- modify the fictional debit day (`MODIFY_DEBIT_DAY`); and
- restart a fictional paused SIP (`RESTART_SIP`).

There is no deterministic reward-claim action, so the reward remains informational
and cannot be claimed through the action API. The default `BASE` fixture remains
unchanged; `PAUSED_RESTART` is a separate server-owned scenario.

### API contracts

All action endpoints are Node.js route handlers under `/api/assistant/actions`.
They require same-origin JSON requests, enforce an 8 KiB streamed body limit,
reject unknown fields, share the bounded in-process assistant limiter and return
`Cache-Control: no-store` responses. Each response contains a request ID.

`POST /api/assistant/actions/preview` accepts:

```json
{
  "scenario": "BASE",
  "action": { "type": "RETRY_PAYMENT" }
}
```

The fixed allowlist is the four domain actions above. Only the new amount or
debit day is accepted as a parameter; a retry cycle ID is selected from trusted
server state. The route calls `previewSimulatedAction()` and never applies an
action. It returns a public preview with deterministic effects, eligibility,
fictional SIP context, a short-lived opaque preview ID when eligible, and a
source label. Ineligible previews have no confirmation ID.

The preview response is the `ActionPreviewResponse` contract in
`src/lib/assistant/action-contracts.ts`: `requestId`, a `PREVIEWED`,
`NOT_ELIGIBLE` or `INVALID_PARAMS` status, and a `PublicActionPreview`. Invalid
JSON/request, origin, media type, size, rate limit and missing signing-secret
failures use the allowlisted `ActionApiErrorResponse` with HTTP 400, 403, 415,
413, 429 or 503 respectively; unexpected failures are generic HTTP 500 errors.

`POST /api/assistant/actions/confirm` accepts only:

```json
{ "previewId": "<opaque-preview-id>", "confirmed": true }
```

`confirmed: false` cancels and consumes the pending preview without changing
the fictional state. A true confirmation rebuilds and revalidates the preview
from the signed server-owned state, then invokes `confirmSimulatedAction()` and
`applyConfirmedAction()`. Expired, stale, ineligible, unknown or reused preview
IDs are rejected. Confirmation time for domain semantics is the existing fixed
demo clock; real wall-clock expiry is enforced separately.

`POST /api/assistant/actions/reset` accepts `{}` or
`{ "scenario": "BASE" }` / `{ "scenario": "PAUSED_RESTART" }` and returns the
selected original fixture with no pending preview.

Confirmation and reset use the `ActionOperationResponse` contract in the same
file. The body carries a status, safe user-facing message, minimal current SIP
and reward-progress summary, and a result or `null`; it never includes the
signed session, full investor state or domain fingerprint. Missing/invalid or
expired sessions return HTTP 401, unknown/stale/consumed previews return HTTP
409, and only successful application or reset returns HTTP 200.

The assistant API request contract is unchanged. When and only when the server
pipeline returns a gate-passed `APPROVED` result with an allowed proposal, the
route independently validates the proposal with the deterministic engine and
may include the same public preview DTO in its response. Unavailable, fallback,
refusal, or unapproved responses can never authorize an AI-proposed preview.

### Session signing and state integrity

Set `ACTION_SESSION_SIGNING_SECRET` to a stable secret of at least 32 UTF-8
bytes. It is server-only, must not use a `NEXT_PUBLIC_*` name, and must not be
generated afresh per request. Missing or invalid configuration fails action
requests closed. `.env.example` contains an empty placeholder only.

The application stores the fictional session, scenario, monotonically
incremented state version and one pending preview in a versioned compressed
HMAC-SHA256-signed cookie. HMAC provides integrity, not confidentiality, so the
cookie contains fictional demo data only and no real user or sensitive data.
The cookie is HttpOnly, SameSite=Strict, scoped to
`/api/assistant`, and Secure in production. The raw session payload and HMAC are
not returned to the browser as application data; only the cookie token is sent
by the browser to the server. Preview IDs are opaque and bound in the signature
to scenario and state version. The server validates the session schema, token
size, signature, session expiry, preview expiry and current deterministic
eligibility before applying a transition.

This is suitable only for local fictional practice. A process-local registry
tracks the latest cookie version for each session, and consumed preview IDs are
retained until expiry. This rejects same-process stale-cookie rollback and
replay. It cannot coordinate multiple instances or survive a process restart.
Production action preview, confirmation and reset endpoints therefore return
HTTP 503 until an atomic shared session store is wired in. There is no database
or server-side persistent session store in this repository, so production
action persistence remains unimplemented.

The browser keeps the signed cookie for the API scope and the UI keeps only
preview/result display state in React. Confirmed fictional state can be read by
subsequent action previews in that browser session. Reset recreates the original
selected scenario. The dashboard is a static independent snapshot and does not
reflect action changes; the result UI labels this limitation. Clearing the
browser cookie or changing browser/device loses the fictional action state.
These demo endpoints never connect to Groww, make a real payment, or mutate a
real account.

Within one server process, the application also registers each newly issued
session cookie and rejects older versions, including rollback to a previously
valid state. Reset and scenario replacement revoke the prior session. These
controls remain process-local; a shared atomic store is required before action
routes can be enabled in a production deployment.

## Phase 6E.1 security and test coverage

The project uses Vitest 4.1.12 with the default Node environment. The runtime is
Node 24.20.0 with npm 11.19.0; npm is configured for
`https://registry.npmjs.org`, `strict-ssl=true`, and no proxy variables are set.
The configured npm cache path is inaccessible to this process. A minimal DOM
testing dependency install was attempted with a fresh temporary cache, but
`npm ping --fetch-retries=0 --fetch-timeout=10000` failed with OS-level
`EACCES` (“operation was rejected by your operating system”) while requesting
`https://registry.npmjs.org/-/ping`. No dependency was installed and neither
`package.json` nor the lockfile was changed.

The existing UI tests cover static markup, safe text/citations, journey
category/scenario mapping, request-body allowlisting and deterministic state
helpers. They do not mount React components in a DOM and are not claimed as
DOM interaction tests. The new six-journey integration test invokes the actual
API client for every journey and asserts that the request contains only the
current question, category and scenario. The action API tests exercise all
four supported actions through preview, confirmation and follow-up preview,
plus cancellation and reset. The suite has 337 tests across 23 files; no live
OpenAI request is made.

Vitest tests cover deterministic action APIs and signed-session behavior,
including preview/confirm/cancel/reset, stale versions, expiry, invalid
signatures, duplicate/concurrent confirmations, and same-process preview replay
after replacement. Phase 5 mocked-pipeline tests cover gate failures,
citations, fallback, timeout, repair and AI action authorization. No test makes
a live OpenAI call. Accessibility markup and keyboard semantics are checked in
available tests; focus behavior should still receive a separate manual
keyboard/screen-reader review after DOM tooling can be installed.

Two defects were reproduced with regression tests and fixed within this phase.
First, rotating client-supplied `X-Real-IP` / `X-Forwarded-For` values changed
the in-memory rate-limit identity; the application now uses one bounded shared
demo identity because it cannot authenticate proxy-normalized headers itself.
Second, an old valid cookie could replay a pending preview after that preview
was superseded, reset or replaced by another scenario; the process now records
those consumed preview IDs in a bounded in-memory guard. Regression tests cover
header rotation and same-process stale-preview replay, including the assistant
route replacing the scenario. These in-memory controls do not provide
distributed rate limiting or durable replay prevention.

An isolated production-mode localhost smoke run used `ASSISTANT_ENABLED=false`
and an ephemeral demo-only signing secret. The assistant returned
`UNAVAILABLE`; action preview, confirmation, follow-up ineligibility, reset and
cancellation returned `PREVIEWED`, `APPLIED_SIMULATED`, `NOT_ELIGIBLE`, `RESET`
and `CANCELLED`. No model call was enabled. A separate dev server was already
running on port 3000; the attempt to start another dev server was refused by
Next.js, and the existing instance returned generic HTTP 500 responses from
action routes. That shared dev process was left running. The isolated
production-mode run passed, but the dev-server discrepancy still needs a fresh
manual restart and check.

Browser automation could not be run: the available browser-control host
reported itself unavailable and returned no browser tabs. No real browser
click, dialog focus, or screen-reader interaction is claimed. Those checks
remain open alongside genuine DOM-mounted component tests.

Fixture evaluation remains separate from these tests: automated fixture status
can pass while its final status remains `NEEDS_REVIEW` until the 48 human reviews
and 48 Evidence Log references are resolved. No live-model quality result is
claimed.

### UI confirmation flow

The assistant page separates the practice panel from AI answers and labels it
“Deterministic demo practice — no AI used”. Selecting a practice action requests
a deterministic preview. The preview card displays trusted SIP context,
proposed changes, eligibility, effects and validity. Only an eligible preview
offers the distinct keyboard-accessible confirmation dialog. Cancellation
consumes the preview and does not change state. A result explicitly says the
update was simulated and no real payment occurred. The UI has no action
execution button outside this confirmation flow and uses plain text rendering.

The Phase 4 evaluation remains fixture-only: `liveModelOutputs: false`,
`modelCallsMade: 0`, `status: NEEDS_REVIEW` and `approvalBlocked: true`. Live
model results, when they exist, must be reported separately and must not be
merged into fixture results.

## Outstanding human review

The 48 golden cases are still `pending_human_review` with unresolved Evidence
Log references. Automated gate success does not replace human review of
evidence grounding, policy attribution, financial-state accuracy, action safety,
fallback quality, tone or Evidence Log completeness. No Evidence Log ID or human
approval is fabricated.

## Phase 6E.2 visual polish and verification

The assistant message now suppresses a status badge when it repeats the
server-provided quality label (including the synonymous needs-more-information
label). Distinct status information, unavailable/fallback explanations and
safety copy remain visible. Action previews show a proposed change once and
omit only identical copies of that same effect from the effects list; distinct
restart deadlines, reward progress and simulated-only effects remain intact.

Selecting a different journey clears the prior conversation and any displayed
action preview/result/error/confirmation state, so a preview from a previous
scenario is not left on screen. Action preview, confirmation and reset response
tokens are invalidated on journey changes, so an in-flight response cannot
repopulate stale action UI. Long assistant text, citation metadata, action
context and effects use constrained-width and word-wrapping classes. The
dashboard note and simulated-action result both state that the dashboard is an
independent static snapshot that does not synchronize with the signed demo
session.

The native `<dialog>` remains the confirmation mechanism. It is explicitly
labelled, opens with focus on Cancel, returns focus to the previously focused
element when that element remains mounted, and falls back to the practice-panel
heading when confirmation removes the triggering preview control. Escape
cancellation is blocked while a request is pending, and pending/error states
are announced. `showModal()`
provides the browser's modal focus containment and makes the background inert.
Automated tests validate the dialog semantics and visible controls, but browser
keyboard/focus behavior and screen-reader announcements were not manually
verified in this run.

Phase 6E.2 verification added static-render regression coverage for duplicate
status labels, duplicate preview effects, action eligibility and confirmation
controls, reset/result wording, scenario-state clearing, safe citation links,
and responsive layout classes. These tests use React server rendering and do
not mount components in a DOM. The required DOM testing packages remain
unavailable because the npm registry previously returned OS-level `EACCES`;
they were not reinstalled. Browser control was unavailable during this run, so
there are no new browser screenshots or interactive browser results. The
375, 430, 768, 1024 and 1440 px layouts were checked only through responsive
Tailwind class and width-constraint inspection, not through rendered viewport
measurement. Manual viewport, journey, fallback and action-dialog checks remain
recommended.

`npm run golden:validate`, `npm run eval:fixture`, typecheck, tests, lint and
production build passed. The fixture evaluation is still automated-only and
ends in `NEEDS_REVIEW`; all 48 human reviews and 48 Evidence Log references
remain unresolved. No live-model evaluation was performed. Stateless session
replay and process-local rate-limit limitations described above are unchanged;
public paid model access still requires a stable signing secret, shared/edge
rate limiting and hosting timeout review before deployment.
