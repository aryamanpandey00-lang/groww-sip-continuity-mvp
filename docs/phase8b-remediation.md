# Phase 8B targeted remediation

AI remains disabled by default. No live API request, paid service, deployment,
or new infrastructure was used for this remediation.

## Applied safeguards

- Token usage from the initial and repair Responses API calls is summed. Usage
  from incomplete, invalid, and provider-error responses is retained when
  supplied. Logs identify the model-call count and whether the accumulated
  usage is complete.
- Each model attempt reserves a conservative input and output token bound
  before the call. Incomplete usage consumes the full reservation. Local
  development uses a process-local hourly budget. Production refuses to call a
  model unless an injected deployment-shared atomic budget coordinator is
  available.
- Responses are accepted only with a completed status. The parser bounds raw
  output size, checks safe integers, and matches action parameter ranges in the
  JSON Schema. The existing runtime safety gate still owns citation and
  refusal/action semantic checks.
- Evaluation reports require complete and unique dataset, fixture, and result
  coverage. Each split must pass its own thresholds. Review state is read from
  the versioned dataset rather than evaluator-result flags. Fixture-mode
  reports remain `NEEDS_REVIEW` and can never approve a live model release.
- The local action guard remembers the current signed-cookie version and rejects
  stale versions, revokes sessions on reset or scenario replacement, and keeps
  consumed preview IDs through their expiry.
- Production action preview, confirmation, and reset endpoints return HTTP 503
  until an atomic shared session store is wired in. This prevents stateless
  cookies from being used as production session state.

## Shared infrastructure still required

This repository has no shared atomic store or Evidence Log registry. Therefore
the following deployment protections remain unavailable and production paths
fail closed:

- A deployment-wide token budget coordinator with atomic reserve and settle
  operations. The repository contains only a local-development implementation
  and the production adapter contract.
- Durable action session state with atomic version checks and preview
  consumption shared across instances and process restarts. The repository
  contains the local guard and disables production action endpoints until a
  shared adapter is connected.
- Evidence Log lookup to verify that a syntactically valid EVL ID refers to an
  actual external review record.

Until those adapters and records are available, do not treat local process
guards or fixture evaluation as deployment approval.
