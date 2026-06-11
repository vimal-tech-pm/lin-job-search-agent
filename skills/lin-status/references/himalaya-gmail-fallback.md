# Himalaya Gmail Fallback for Lin Status Checks

The lin profile sandboxes `$HOME` to `~/.hermes/profiles/lin/home/`. Himalaya's config lives at `$LIN_REAL_HOME/.config/himalaya/config.toml`. All himalaya commands MUST be prefixed with `HOME=$LIN_REAL_HOME`.

## Quick search for applied-job status

```bash
HOME=$LIN_REAL_HOME himalaya envelope list \
  --folder "INBOX" \
  --page-size 500 \
  --max-width 400 \
  "<CompanyName>"
```

Then grep for status signals:

```bash
HOME=$LIN_REAL_HOME himalaya envelope list --folder "INBOX" --page-size 500 --max-width 400 | \
  grep -iE "interview|reject|unfortunately|next step|offer|phone screen|not moving|regret"
```

## Reading a specific email

```bash
HOME=$LIN_REAL_HOME himalaya message read <ID>
```

## Available folders

```bash
HOME=$LIN_REAL_HOME himalaya folder list
```

Key folders: INBOX, [Gmail]/All Mail, [Gmail]/Sent Mail, Lin (job-specific), Work/LinkedIn.

## Classification keywords

| Signal | Keywords | Maps to status |
|--------|----------|----------------|
| Rejection | unfortunately, not moving forward, no longer, regret to inform, not been selected, position has been filled | `closed` |
| Interview | interview, phone screen, schedule a call, would like to speak, meet the team, video call, availability for a call | `interviewing` |
| Offer | pleased to offer, delighted to extend, offer letter, congratulations | `offer` |
| Acknowledgement | thank you for applying, application received, we have received | SKIP (not a status change) |

## Script integration

The `scripts/lin-gmail-status.mjs` script already wraps himalaya as a fallback. To use it:

```bash
node scripts/lin-gmail-status.mjs           # auto-apply updates
node scripts/lin-gmail-status.mjs --dry-run  # preview only
node scripts/lin-gmail-status.mjs --since 14 # check last 14 days
```

## Common pitfalls

- **Sandboxed HOME**: himalaya fails silently with "Cannot find configuration" in the sandbox path. Always `HOME=$LIN_REAL_HOME`.
- **Large inboxes**: `--page-size 500` is needed; default is too small for job-email matching.
- **Company name matching**: uses substring match on subject + from fields. "Kin Insurance Hiring Team" matches "Kin Insurance" correctly via substring.
