# lin-build: Model A/B Test — Methodology & Results (2026-06-16)

## Context
lin-build is the only frontier-model stage in the Lin pipeline. Ran a 5-arm × 4-folder
test to find a cheaper replacement for gpt-5.5 (openai-codex, $20/mo flat).

## Key demands on the model (priority order)
1. **Faithfulness** — never invent metrics or experience. Hard disqualifier.
2. **Long-instruction adherence** — 432-line FORGE spec, md-format-spec, recency-tier caps.
3. **Agentic tool-loop reliability** — render→gate→trim→re-render loop via bash.
4. **Structural output fidelity** — buildable markdown + valid HTML for renderers.

## Frozen test sample (4 stress cases)
| Folder | Stress axis | JD density | ATS winner |
|---|---|---|---|
| ebay/sr-product-manager-seller-experience | Dense JD (724w) | High | forge |
| rbc/senior-product-manager-mobile | Medium JD (631w), finance | Medium | forge |
| maintainx/senior-product-manager-work-planning | AI/SaaS keywords | Medium | pathfinder |
| ebay/product-manager-marketplace-science | Sparse JD (98w) | Low | pathfinder |

## Test harness
- Script: `/tmp/lin-ab-test/harness.py`
- Invocation: `hermes --profile lin chat -m MODEL --provider PROVIDER -t file,web,terminal -s lin-build -q PROMPT`
- Ground-truth gate: `gate-pass.json` existence + `job.yml status: built`
- Token counts: model self-reported (no API-level access from subprocess)
- Resumable: saves `results.json` after each build; re-run skips completed keys

## Results summary (all 20/20 PASS, zero fabrications)

| ARM | PASS | AVG_ITER | AVG_TIME | TOTAL_COST* | FAB_RISK | SAVING |
|---|---|---|---|---|---|---|
| gpt-5.5 | 4/4 | 1.2 | 339s | $1.86 | LOW | baseline |
| deepseek-v4-pro | 4/4 | 2.0 | 304s | $0.11 | MED | 94% |
| glm-5.1 | 4/4 | 1.2 | 342s | $0.28 | LOW | 85% |
| qwen3.7-plus | 4/4 | 3.0 | 538s | $0.14† | LOW | 93% |
| mimo-v2.5-pro | 4/4 | 1.5 | 350s | $0.03† | MED | 98% |

*PAYG per 1M tokens: gpt-5.5 $5/$30, deepseek-v4-pro $0.435/$0.87, glm-5.1 $0.98/$3.08
†proxy rate — not officially published for this tier

## Recommendation: glm-5.1 / opencode-go
- Same avg iterations as gpt-5.5 (1.2) — fewest retries of all candidates
- LOW fabrication risk — cleanest logs, actual page fills reported
- 85% cheaper at PAYG; cancels $20/mo openai-codex sub (lin-build is its only job)
- Near-parity speed (342s vs 339s avg)

Runner-up: **deepseek-v4-pro** — 94% cheaper but avg 2.0 iter + MED fab risk (explicit
self-corrections on 2/4 folders).

Skip: **qwen3.7-plus** — 3-4 iter per build burns retry budget, 538s avg.
Skip: **mimo-v2.5-pro** — MED fab risk on 2/4 folders (surface JD keyword matching).

## Decision rule for future model swaps
1. Faithfulness first — any fabricated metric = automatic disqualification
2. Gate-pass rate ≥ baseline
3. Avg iterations ≤ baseline (retry budget is finite)
4. Quality parity (blind judge score within acceptable band)
5. Cost last — rank survivors by $/role at PAYG rates

## Provider notes
- All candidates run on **opencode-go** (live model cache at `~/.hermes/provider_models_cache.json`)
- opencode-go live lineup (as of 2026-06-16): deepseek-v4-pro, deepseek-v4-flash, glm-5.1,
  glm-5, qwen3.7-max, qwen3.7-plus, qwen3.6-plus, mimo-v2-pro, mimo-v2.5-pro, mimo-v2.5,
  minimax-m3, minimax-m2.7, kimi-k2.6, kimi-k2.7-code, hy3-preview
- crof provider also has glm-5.1, deepseek-v4-pro, kimi-k2.6, minimax-m2.5, qwen3.6-27b
- Always check `provider_models_cache.json` — model names differ from what's in config.yaml
  or pricing.json (those can be stale)
