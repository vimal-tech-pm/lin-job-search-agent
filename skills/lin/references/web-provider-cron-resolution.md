# Lin cron web-provider resolution

Use this when Lin cron jobs report Tavily/DDGS/Firecrawl/search failures, or when changing web providers for Lin.

## Key facts

- Lin cron jobs do not normally pin the web provider in `cron/jobs.json`; they load the owning profile config (`~/.hermes/profiles/lin/config.yaml`) in a fresh process.
- `enabled_toolsets: ["web", ...]` only enables the web tools. It does **not** choose Tavily/DDGS/etc.
- Profile configs are isolated. A named profile with `web.backend: ''` does **not** inherit root/default profile `web.backend`; Hermes falls through to web backend auto-detection.
- Hermes auto-detect order for blank `web.backend` currently prefers credentialed providers before DDGS: `tavily` if `TAVILY_API_KEY` exists, then `exa`, `parallel`, `firecrawl`, gateway Firecrawl, `searxng`, `brave-free`, then `ddgs` if the package imports.
- Therefore, if the user wants Lin to avoid Tavily with blank `web.backend`, remove Tavily env vars from the active profile env as well. Otherwise blank config can still auto-select Tavily.
- In this setup, `lin`, `finance`, and `ironman` profile `.env` files may be symlinks to `~/.hermes/.env`; check symlink status before editing.
- Direct edits to `config.yaml` may be blocked by Hermes' config guard. Use `hermes -p <profile> config set web.backend ''` or another explicit value.
- DDGS requires the `ddgs` Python package in the Hermes runtime. If auto-detect resolves to ddgs but search fails with missing package, install with:
  `uv pip install --python ~/.hermes/hermes-agent/venv/bin/python ddgs`
- Current long-lived Telegram sessions can cache the old web tool config. Verify future cron behavior in a fresh process, not only via the current session's `web_search` tool.

## Audit recipe

1. Inspect cron definitions/scripts across profiles, excluding historical output:
   - `~/.hermes/cron`
   - `~/.hermes/profiles/*/cron`
   - Ignore `/output/` for active config checks; output files only prove historical behavior.
2. Inspect active web blocks in each profile's `config.yaml`.
3. Inspect active `.env` files for Tavily lines without printing secrets; redact values.
4. Verify fresh-process backend resolution with `HERMES_HOME=~/.hermes/profiles/lin` and `tools.web_tools._get_search_backend()` / `_get_extract_backend()`.
5. If needed, verify the fresh-process `web_search_tool()` directly.

## Interpretation

- `cron_definition_script_matches=0` plus `web.backend: tavily` in profile config means the profile config, not cron, is forcing Tavily.
- Blank `web.backend` plus active `TAVILY_API_KEY` still means Tavily may be selected by auto-detect.
- Blank `web.backend` plus no Tavily env and installed `ddgs` means DDGS is selected by auto-detect today, but a future provider can take precedence if its credential/env is configured.