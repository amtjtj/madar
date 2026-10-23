# 0025 — The AI assistant: a stateless service, a model gateway and a hard data boundary

- Status: Accepted
- Date: 2026-10-23

## Context
Phase 3, step 16a (`docs/plans/phase-3-step-16a.md`). The brief's AI layer (priority 1: automatic reports; priority 2: a manager's assistant, including «a sentence into split tasks») and `CLAUDE.md`'s AI rules: open-source models on our own servers, no tenant data to an external API, never ranking people. The pilot starts without a GPU (answer 1 of the plan: CPU first). Step 16 is split: 16a (this record) builds the foundation and two features whose output a person reads or confirms; 16b adds RAG search (pgvector per tenant), minutes summaries, letter reply drafts and a chat page.

## Decision
- **A stateless Python service, `apps/ai`** (FastAPI, Pydantic), with no database, cache or memory in 16a.
  - It sees only what the API sends in one request, after the API has applied the asking person's permissions. So company isolation is the API's isolation; data from two companies never meets in the AI service.
  - It is reached only by the API, over an internal Docker network (`ai`, `internal: true`: no way to the internet), with a shared bearer token (`AI_SERVICE_TOKEN`, compared in constant time).
  - Neither side logs prompts or answers: only the kind of call, duration, token count and which call failed. A validation error never echoes the input.
- **A model gateway, not a model.** The service talks to any OpenAI-compatible server (`LLM_BASE_URL`, `LLM_MODEL`): llama.cpp's server on CPU (profile `llm-cpu`, a GGUF file in `./models`) or vLLM on a GPU (profile `llm-gpu`). Changing engine or model is configuration. A deterministic `fake` provider answers in tests, CI and the e2e suite.
  - Default model: `Qwen2.5-7B-Instruct` (Q4 on CPU), the best Persian among open models of that size. Weights are downloaded once by the administrator; nothing is fetched at run time.
- **Two features, both drafts.**
  - *Weekly report summary.* The worker, on its own queue every ten minutes (not the 15-minute scheduler: model calls are slow), finds stored reports from the last 21 days without a summary (at most five per company per run) and asks for one. Input is `reportFacts()`: counts, department rows, goals, projects at risk and highlight *titles*. Highlight assignees are dropped, so no name reaches the model. The model is called outside any transaction. A draft that contains a member's full name anyway is dropped (`namesSomeone`) and tried again later. `report_summaries` is append-only (unique per report, forced RLS, composite FK to the report). Readers are the report's readers (`readsReport`); the endpoint is `GET /api/reports/weekly/summary`, separate from the report so the snapshot contract stays untouched. The page labels it «پیش‌نویس دستیار». A summary is made for company reports too (answer 3).
  - *«جمله به کار».* `POST /api/ai/task-breakdown` sends only the sentence, the department's name and today's date: no people, no company data. The answer is validated (JSON, at most ten tasks, titles up to 200 characters, one retry on malformed output). `dueInDays` becomes a working day with `workingDayAfter`. The person edits titles, dates and assignees and confirms; the tasks are made one by one through the ordinary `POST /api/tasks`, so permissions, sources and activity are unchanged. The assistant never writes anything itself.
- **The company decides.** `tenants.settings.ai.enabled`, off by default (answer 2), changed only with `tenant.manage` and audited (`ai_settings.updated`). `GET /api/ai/status` tells the web whether the server has the service and whether the company turned it on; the buttons and the summary card exist only when both are true.
- **Limits.** The breakdown is limited per person (10 a minute) and per company (60 a minute) in memory, plus the per-IP route limit. Calls time out (`AI_TIMEOUT_MS`, 90 s by default); closing the dialog cancels the request.
- **Errors** are codes only: `ai_disabled` (403), `ai_unavailable` (503: not installed, down or timed out), `ai_failed` (502: the model's answer was unusable).
- **Deployment.** `ai` and the model servers are compose profiles; servers that do not enable them run exactly as before. `deploy.sh` builds `madar-ai` when `COMPOSE_PROFILES` contains `ai`; `status.sh` reports whether the model answers. CI runs the production stack with the `ai` profile and the fake model.

## Consequences
- New capabilities that read company data must build their input in the API, through the existing visibility conditions, and keep people out of it unless a person explicitly asked about their own work. The AI service stays a pure function of its request until 16b adds per-tenant indexes, which must then filter by tenant on every query (`CLAUDE.md`).
- Quality is not measured by CI (the fake model is deterministic); it has to be checked by hand on a real model before the pilot, and recorded here.
- The in-memory limiter, like `RateLimitGuard`, moves to Redis when the API runs on more than one instance.
- A 7B model on CPU answers a breakdown in roughly 30–60 seconds on a 4–8 core server; a GPU brings it to a few seconds.
