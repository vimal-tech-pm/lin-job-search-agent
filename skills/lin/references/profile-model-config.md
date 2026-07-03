# Lin profile model configuration

Use this when diagnosing why the Lin profile starts on an unexpected model/provider.

## Key lesson

Hermes profiles are isolated. A named profile does not reliably inherit `model.*` from the default profile when its own `config.yaml` contains a `model:` block. If Lin has an explicit profile-local model, that wins for Lin sessions/gateway runs.

## Paths to compare

- Default profile config: `~/.hermes/config.yaml`
- Lin profile config: `~/.hermes/profiles/lin/config.yaml`
- Finance profile config: `~/.hermes/profiles/finance/config.yaml`
- Ironman profile config: `~/.hermes/profiles/ironman/config.yaml`

Useful checks:

```bash
hermes -p default config path
hermes -p lin config path
hermes profile list
python3 - <<'PY'
from pathlib import Path
import yaml
for name,path in {
  'default': Path('~/.hermes/config.yaml'),
  'lin': Path('~/.hermes/profiles/lin/config.yaml'),
  'finance': Path('~/.hermes/profiles/finance/config.yaml'),
  'ironman': Path('~/.hermes/profiles/ironman/config.yaml'),
}.items():
    data = yaml.safe_load(path.read_text()) or {} if path.exists() else {}
    print(name, data.get('model'))
PY
```

## Session-only vs persisted switches

In the interactive CLI, `/model ...` is session-only by default. The next turn gets a note like `model was just switched ...`, but the profile config is unchanged unless `--global` was used.

To persist Lin to GPT-5.5/OpenAI Codex:

```bash
hermes -p lin config set model.default gpt-5.5
hermes -p lin config set model.provider openai-codex
```

Equivalent interactive command:

```text
/model gpt-5.5 --provider openai-codex --global
```

## Why finance/ironman can look different

Finance/ironman may show `—` in `hermes profile list` because their profile configs currently do not set a top-level `model:` block. That is not proof of active inheritance from default. Their cron jobs often pin models per job, so inspect `cron/jobs.json` before assuming profile default behavior.

## Recommended answer pattern

When the user asks “why is Lin on GLM?”:

1. Compare the actual config files first.
2. State clearly whether Lin has an explicit `model:` override.
3. Explain `/model` without `--global` is session-only.
4. If the user says Lin should behave like finance/ironman, treat that as a request to remove Lin's profile-level `model:` block, not to pin Lin to the current default model. Finance/ironman-style behavior means `model: None` in the profile config and `Model: —` in `hermes profile list`.

## Safe remediation workflow

When removing an unwanted Lin model override:

1. Back up `~/.hermes/profiles/lin/config.yaml` before editing.
2. Remove only the top-level `model:` block from Lin's config. Do not touch API keys or unrelated profile settings.
3. Verify Lin, finance, and ironman all report no profile-local model:
   ```bash
   python3 - <<'PY'
   from pathlib import Path
   import yaml
   for name,path in {
     'lin': Path('~/.hermes/profiles/lin/config.yaml'),
     'finance': Path('~/.hermes/profiles/finance/config.yaml'),
     'ironman': Path('~/.hermes/profiles/ironman/config.yaml'),
   }.items():
       data = yaml.safe_load(path.read_text()) or {}
       print(f"{name}: config model = {data.get('model')}")
   PY
   ```
4. Run `hermes profile list` and confirm Lin shows `Model: —`, matching finance/ironman.
5. Restart the Lin gateway and verify it is running. If `hermes -p lin gateway restart` stalls, use the profile's Python module path with `--profile lin gateway run --replace`, then inspect the gateway log for a successful startup.
