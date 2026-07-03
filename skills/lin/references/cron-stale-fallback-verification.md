# Lin cron stale-stream / fallback verification

Use when verifying a Lin cron/provider fix after `Broken pipe`, `Stream stale`, stalled cron runs, or fallback-provider changes.

## What to verify

A config patch can be syntactically correct but operationally incomplete. Verify all three layers:

1. **Config shape is present in the Lin profile**
   - `providers.<primary>.stale_timeout_seconds`
   - `providers.<fallback>.stale_timeout_seconds`
   - top-level `fallback_providers`
   - `cron.script_timeout_seconds` for no-agent/script jobs
2. **Hermes actually loads the fallback chain**
   - Run the profile-scoped fallback command, not the default profile by accident:
     ```bash
     ~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main --profile lin config path
     ~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main --profile lin fallback list
     ```
   - Watch for an unexpected extra `fallback_model` entry: Hermes merges `fallback_providers` first, then legacy `fallback_model`. An extra fallback back to the same primary provider is not necessarily harmful, but can hide that failover is not doing what you expected.
3. **Runtime behavior after the patch**
   - Check latest cron job statuses with `cronjob action=list` or `hermes --profile lin cron list`.
   - Inspect latest output files under:
     - `~/.hermes/profiles/lin/cron/output/<job-id>/`
   - Check the gateway journal after the config mtime:
     ```bash
     journalctl --user -u hermes-lin-gateway.service --since '<timestamp>' --no-pager \
       | grep -Ei 'Broken pipe|ReadError|Stream stale|fallback|provider=opencode-go|provider=deepseek|Max retries'
     ```

## Key pitfall discovered 2026-06-24

Increasing `stale_timeout_seconds` can stop premature 180s kills, but it can also create long stalls. Hermes treats stale-stream `ReadError` / `[Errno 32] Broken pipe` as retryable transport errors. It may retry the same primary provider and only try fallback after max retries, not immediately.

So a Lin cron can still be unhealthy if logs show:

```text
Stream stale for 600s ... provider=deepseek ... Broken pipe
Retrying API call ... provider=deepseek ... Broken pipe
```

Even if:

- `fallback_providers` is configured,
- `hermes --profile lin fallback list` shows the fallback, and
- one manual rerun succeeded.

## Decision rule

- **Config applied + reruns succeeded + no new stale/BrokenPipe logs:** fix likely correct.
- **Config applied + some reruns succeeded + new stale/BrokenPipe logs still show primary retries:** fix is only partial. Recommend making Lin agent crons use a more reliable primary provider, or changing Hermes failover behavior so stale/BrokenPipe routes to fallback sooner.
- **No-agent/script jobs fail:** focus on `cron.script_timeout_seconds`, script environment, and credentials; provider fallback does not apply when `no_agent: true`.

## Reporting format

Keep it concise:

- `Correct:` config and successful outputs.
- `Still wrong:` fresh logs/output showing stalls or missing failover.
- `Verdict:` correct / partial / not fixed.
- `Next fix:` one concrete next action.
