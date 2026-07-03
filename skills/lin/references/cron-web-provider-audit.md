# Lin cron web-provider and config audit

Use when Lin cron web/search behavior looks wrong (for example Tavily/429s, ddgs not used, web_extract failing, or a cron appears to ignore the desired search provider).

## Key lesson

Cron jobs usually do **not** pin the web backend in `cron/jobs.json`. Lin cron sessions load the **owning profile config** (`~/.hermes/profiles/lin/config.yaml`), so a profile-level `web.backend: tavily` affects every Lin cron job with the `web` toolset even when the job prompt contains no Tavily text.

## Audit ladder

1. Check active cron definitions across profiles, excluding historical output first:
   - default: `~/.hermes/cron/jobs.json`
   - named: `~/.hermes/profiles/*/cron/jobs.json`
   - also inspect scripts referenced by `script` fields.
   - Search for `tavily`, `web.backend`, `search_backend`, `extract_backend`, `TAVILY`.
2. Parse `jobs.json`, do not rely only on grep:
   - list `id`, `model`, `provider`, `script`, `skills`, `enabled_toolsets`, and prompt text.
   - For Lin, `lin-scan`, `lin-score`, `lin-stage`, `lin-build`, `lin-finalize`, and `lin-deep-prep` typically use the `web` toolset and inherit `web.*` from the Lin profile config.
3. Check active profile configs separately:
   - default: `~/.hermes/config.yaml`
   - Lin: `~/.hermes/profiles/lin/config.yaml`
   - Other profiles may intentionally differ; do not change them unless asked.
4. Distinguish active definitions from historical cron outputs:
   - `/cron/output/...` matches show past failures or skill text, not current configuration.
   - Report them as history only unless a current prompt/script still includes the same setting.
5. Runtime-check the backend selection under the Lin profile after any config change:
   ```bash
   HERMES_HOME=~/.hermes/profiles/lin \
     ~/.hermes/hermes-agent/venv/bin/python - <<'PY'
   import sys
   sys.path.insert(0, '~/.hermes/hermes-agent')
   from tools import web_tools
   print('search_backend=' + web_tools._get_search_backend())
   print('extract_backend=' + web_tools._get_extract_backend())
   PY
   ```
6. Verify a real search call if changing to ddgs:
   - `ddgs` must be installed in the Hermes venv.
   - Setup fix if missing:
     ```bash
     uv pip install --python ~/.hermes/hermes-agent/venv/bin/python ddgs
     ```

## Important behavior

- `ddgs` is search-capable but not a robust extract backend in Hermes. If `web.backend: ddgs`, `web_search` should use ddgs; `web_extract` may fail fast as search-only, so Lin skills must use their browser/curl fallback paths for JD extraction.
- If a user says “remove Tavily from cron,” first determine whether the pin lives in cron definitions, profile config, `.env`/proxy settings, or skill text. Do not edit cron prompts if the profile config is the real source.
- Config files are guarded; use Hermes config CLI rather than direct patching:
  ```bash
  ~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main -p lin config set web.backend ddgs
  ```

## Reporting format

Be concise:
- “Cron definitions: clear / matches.”
- “Lin profile config: changed from X to Y.”
- “Runtime selection: search_backend=Y, extract_backend=Y.”
- “Historical outputs: N matches, not active config.”
- “Other profiles: untouched unless requested.”
