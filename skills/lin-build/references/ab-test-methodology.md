# lin-build Model A/B Test Methodology

## Context
lin-build is the only frontier-model stage in the Lin pipeline. Cost reduction requires replacing gpt-5.5 (openai-codex, $20/mo flat or ~$5/$30 per 1M PAYG) with a cheaper model that passes the same objective quality gate.

## Key finding: provider_models_cache.json is authoritative
`~/.hermes/provider_models_cache.json` contains the live model list fetched from each provider. This is the source of truth — not config.yaml (only lists configured models) and not pricing.json (seeds lag). Always check the cache before declaring a model "doesn't exist".

Example: opencode-go cache revealed `mimo-v2.5-pro`, `qwen3.7-plus`, `qwen3.7-max` that were absent from both config.yaml and pricing.json.

## What the model actually has to do
1. Read master resume.md + experience.md + job.md (long-context faithfulness)
2. Generate FORGE markdown (buildable, md-format-spec compliant) + PATHFINDER HTML
3. Drive a render → gate → trim → re-render loop via bash tool calls
4. Never fabricate metrics or experience (cardinal rule)
5. Adhere to a 432-line FORGE spec (instruction-following under long context)

## Scoring axes (priority order)
1. **Faithfulness** (hard gate, pass/fail) — zero invented metrics/roles allowed. Automated diff + blind LLM judge check. Any violation = disqualified regardless of other scores.
2. **Gate-pass rate** — `lin-verify-resumes.py` pass within retry budget (default: 1 retry).
3. **Iteration cost** — render→gate cycles to converge. A cheap model needing 5 loops can erase token savings.
4. **Quality (blind judge)** — ATS keyword coverage + bullet quality vs gpt-5.5 baseline, judge anonymized.
5. **Cost & latency** — measured tokens × PAYG rate.

## Test setup
- **Benchmark**: gpt-5.5 / openai-codex run fresh on same frozen inputs (don't reuse old cron outputs — master resume may have changed)
- **Blind judge**: use a frontier model NOT in the candidate set (e.g. claude-opus-4-8 / hone)
- **Frozen sample** (4 folders stress-testing distinct failure modes):
  - Dense JD + forge winner (e.g. ebay/sr-product-manager-seller-experience, 724 words)
  - Medium JD + finance sector (e.g. rbc/senior-product-manager-mobile, 631 words)
  - AI/SaaS + pathfinder winner (e.g. maintainx/senior-product-manager-work-planning)
  - Sparse JD + pathfinder winner (e.g. ebay/product-manager-marketplace-science, 98 words)
- Per arm: copy frozen job.md + job.yml (reset status→staged, clear ats_winner), wipe resumes/

## Harness command (non-interactive)
```bash
hermes --profile lin chat \
  -m MODEL --provider PROVIDER \
  -t file,web,terminal \
  -s lin-build \
  -q 'Run the lin-build skill, verb "CO/SLUG", per its SKILL.md. ...'
```
- `-q` is the non-interactive single-query flag (not `--no-stream`, not positional arg)
- `-t file,web,terminal` matches the cron job's enabled_toolsets
- `-s lin-build` preloads the skill
- timeout: 900s per build (render loops take 3-15 min depending on model speed)

## Ground-truth result collection (override model self-report)
1. `resumes/gate-pass.json` exists → gate PASS (read for page counts)
2. `job.yml` contains `status: built` → gate PASS
3. Neither forge.pdf nor pathfinder.pdf exists → gate FAIL
4. Model JSON self-report is a fallback only (used for token counts)

## Cost calculation
```
cost_usd = (input_tokens * in_rate / 1_000_000) + (output_tokens * out_rate / 1_000_000)
```
Token counts from model self-report are proxies. Actual subscription billing is flat.
Design cost comparison assuming PAYG (subscriptions will migrate to token pricing).

## Decision rule
A candidate qualifies only if:
- Zero faithfulness violations across all 4 folders (non-negotiable)
- Gate-pass rate ≥ gpt-5.5 baseline
- Blind quality score within acceptable band of baseline

Among qualifying candidates: rank by cost_usd per role, then latency.

## Cutover
```bash
hermes cron update lin-build --model NEW_MODEL --provider NEW_PROVIDER
```
Rollback is the same command. No pipeline state is touched by a model swap.

## 2026-06-16 test roster
- gpt-5.5 / openai-codex (benchmark)
- deepseek-v4-pro / opencode-go
- glm-5.1 / opencode-go
- qwen3.7-plus / opencode-go
- mimo-v2.5-pro / opencode-go

PAYG proxy rates (qwen3.7-plus and mimo-v2.5-pro not confirmed):
| Model | In $/1M | Out $/1M |
|---|---|---|
| gpt-5.5 | 5.00 | 30.00 |
| glm-5.1 | 0.98 | 3.08 |
| deepseek-v4-pro | 0.435 | 0.87 |
| qwen3.7-plus | 0.50* | 1.50* |
| mimo-v2.5-pro | 0.14* | 0.28* |
* proxy rate
