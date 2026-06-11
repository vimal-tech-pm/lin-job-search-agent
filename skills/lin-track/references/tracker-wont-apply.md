# Won't-apply tracker implementation

Added 2026-06-03 as part of the `/lin won't-apply` command.

## Files changed

- `scripts/lin-wont-apply.mjs` — new deterministic helper
- `scripts/lin-tracker.mjs` — both `renderTracker()` (markdown) and `renderHtml()` (HTML) updated

## Helper (`lin-wont-apply.mjs`)

Accepts `<job-slug|co-slug/job-slug|#queue-id> [reason]`:

1. If target is a queue ID (`#NNN`): sets `queue_state: "skipped"`, `recommendation: "manual_override"`, appends note, refreshes tracker. If the row has `promotion.job_folder`, closes that Lin folder too.
2. If target is a job slug: closes the job (`status: "closed"`, `status_detail: "won’t_apply: {reason}"`), appends `status-history.md`, matches and closes the linked evaluation queue row, refreshes tracker.

## Tracker detection helpers (in `lin-tracker.mjs`)

```js
function isWontApplyDetail(detail) {
  return /won[’']?t[_ -]?apply|wont[_ -]?apply|do not apply|don[’']?t apply|user_declined/i.test(String(detail || ""));
}

function isWontApplyQueueRow(r) {
  const notes = Array.isArray(r?.notes) ? r.notes.join("\n") : "";
  return r?.queue_state === "skipped" && (
    r?.recommendation === "manual_override" ||
    r?.liveness?.result === "user_declined" ||
    isWontApplyDetail(notes)
  );
}
```

## Critical fixes

### `readEvaluationQueue` filter exception

`readEvaluationQueue()` normally filters OUT queue rows that have a matching Lin job folder (to avoid cluttering the queue tab with already-promoted items). Won't-apply rows must be an exception — they should remain visible even after promotion:

```js
return roles.filter((r) => {
    if (isWontApplyQueueRow(r)) return true;  // keep won't-apply rows
    if (r.url && ownedByUrl.has(r.url)) return false;
    if (r.co_slug && r.job_slug && ownedByPair.has(`${r.co_slug}|${r.job_slug}`)) return false;
    return true;
});
```

Without this, a won't-apply role that was promoted before being declined would vanish from both the queue tab AND the archive tab.

### Double-counting prevention

The same role typically appears in both the "Won't apply — queue rows" and "Won't apply — Lin-managed jobs" sections (one queue row + one job folder). Funnel counts must deduplicate:

```js
const wontApplyCount = jobs.filter((j) => j.status === "closed" && isWontApplyDetail(j.status_detail)).length
  + queue.filter((r) => isWontApplyQueueRow(r) && !jobs.some((j) => j.coSlug === r.co_slug && j.jobSlug === r.job_slug)).length;
```

### Shell quoting

The `#` character in queue IDs is a shell comment. Always quote: `node scripts/lin-wont-apply.mjs "#132" "reason"`.
