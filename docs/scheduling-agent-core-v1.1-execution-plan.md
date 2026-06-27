# Scheduling Agent Core v1.1 Execution Plan

## Goal

Complete the real-agent loop for atomic playlist commands:

- Real LLM intent interpretation can be evaluated against scheduler utterances.
- Each LLM interpretation turn receives structured current evidence plus pending conversation context.
- Every write operation still goes through deterministic preview, constraints, confirmation, and commit guards.
- The scope stays limited to atomic command combinations, not drafts, full-day scheduling, or multi-user collaboration.
- The out-of-scope boundary is repeated in the LLM system prompt and evidence guardrails so the interpreter does not expand atomic commands into draft generation, full-day planning, or collaboration workflows.

## LLM Context Contract

The LLM receives:

- current user utterance
- channel, date, playlist id, conversation id
- pending task context when present
- compact evidence package with current schedule, candidate library, readiness/history/constraints/policy sources
- explicit guardrails describing what the LLM must not decide

For TV sequence interpretation, the compact evidence package exposes today's scheduled items, the latest history sample, and candidate summaries with stable programme identifiers, instance names, programme codes, and `issueNo` when available. For rotation playlists, the same package preserves programme-code-less short clips through `candidateId`, title, duration, type, and content tags so they can be found by title or keyword without being treated as TV episodes.

The LLM returns only:

- `intent`
- `pendingAction`
- `queryKind`
- `slots`
- `confidence`
- `reasoning`

The LLM must not approve writes, choose final safety outcomes, shift occupied destinations, replace occupied content, or reorder the playlist.

The runtime performs one intent-interpretation LLM call per natural-language turn. A two-turn conversation therefore expects two LLM calls: the first creates or resolves the structured task, and the second receives the previous structured pending task plus the new user utterance and refreshed evidence package. Preview, constraint validation, confirmation gating, and commit decisions remain local deterministic steps and do not add extra LLM calls in v1.1.

## Runtime Decision Contract

Local runtime remains responsible for:

- destination occupation and overlap blocking
- locked item blocking
- layout bounds blocking
- blocked time range blocking
- material readiness blocking
- rights readiness blocking
- TV sequence enforcement
- rotation confirmation gates
- pending context fingerprint checks
- commit fingerprint checks

When a move or insert target destination already has content, v1.1 blocks with `time_overlap`. It does not auto-shift, auto-replace, or auto-reorder.

## Evaluation

Foreground acceptance checklist:

- `docs/scheduling-agent-v1-foreground-acceptance.md`

Default offline validation:

```bash
npm run agent:check:tests
npm run build
```

Optional real LLM validation:

```bash
$env:RUN_AGENT_REAL_LLM_EVAL='1'
$env:VITE_CODE_PLAN_LLM_API_KEY='<your key>'
npm run agent:eval:llm
```

Strict acceptance validation:

```bash
$env:VITE_CODE_PLAN_LLM_API_KEY='<your key>'
npm run agent:eval:llm:strict
```

The real LLM evaluation is intentionally separate from default checks because it consumes quota and depends on network/model availability. The test loader reads `process.env` plus Vite env files such as `.env.development`; empty or placeholder API keys are treated as unavailable and keep the suite skipped.

Use strict mode for final acceptance. In strict mode, missing or placeholder API keys fail the run and write a `failed` evaluation report instead of producing a green skipped result. The report still includes the skip reason for diagnosis.

Each run writes a machine-readable report to `test-results/agent-real-llm-evaluation.json` by default. Override it with `AGENT_LLM_EVAL_REPORT_PATH` when a different handoff path is needed. The report records whether the suite ran or skipped, the skip reason, model/base URL metadata, per-suite pass rates, acceptance tag coverage, LLM call counts for runtime sections, and failure summaries without writing the API key.

The report also includes top-level `acceptanceCoverage` for the required v1.1 acceptance tags: `tv_sequence`, `rotation_short_clip`, `missing_param`, `target_occupied`, `professional_refusal`, and `pending_context`. A real non-skipped run is considered failed if any required tag is missing or failing, even when the raw pass-rate threshold is met.

The real LLM evaluation suite currently contains 23 scheduler utterances. It covers:

- move, insert, replace, delete, batch move, batch delete, query, and validate
- TV sequence continuation
- rotation short clips without programme codes
- missing-parameter pending continuation
- confirmation, cancellation, and starting a new query while a write is pending
- occupied destinations that must remain blocked by runtime constraints
- material, rights, and layout-bound professional refusal scenarios

Default `agent:check:tests` validates that this real-model suite keeps covering those acceptance boundaries even when the real model test is skipped.

The optional real LLM command also runs an end-to-end runtime suite. That suite uses real model interpretation as runtime input and checks:

- direct execution for safe move and TV sequence insert
- confirmation gates for delete and rotation short-clip insert
- read-only query and validation outcomes
- deterministic blocking for occupied destinations, material not ready, rights blocked, and layout bounds
- pending missing-parameter continuation with structured context
- operation preview summaries before commit or blocking

It also runs a real multi-turn conversation suite:

- turn 1 creates a pending task from an underspecified natural-language command
- turn 2 sends a new natural-language reply with the pending task and evidence package
- the same runtime instance carries schedule state across turns
- the final turn must execute or confirm through the normal runtime path, not through injected final parameters

Runtime and conversation evaluation reports include LLM call counts from the agent audit trail so regressions that add hidden model calls are visible in `test-results/agent-real-llm-evaluation.json`.
