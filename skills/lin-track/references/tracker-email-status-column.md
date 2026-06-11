# Email Status in HTML Tracker — Required Changes

When adding the email status column to `lin-tracker.mjs`, three changes are needed.
The header and row column were added in the June 9 session, but the `emailStatusChip()`
function was NOT added. The tracker will render email cells as `${emailStatusChip(...)}`
which will show raw template literal syntax. Add this function to fix.

## Function to add

Insert after `canadaChip()` (~line 596):

```js
// email status → badge chip. Maps last_email_status to a visual indicator.
function emailStatusChip(status, lastCheck) {
  if (!status) return "";
  const icons = { silent: "🔇", acknowledged: "📨", rejection: "❌", interview: "🎙️", offer: "🎉" };
  const key = Object.keys(icons).find(k => String(status).toLowerCase().startsWith(k));
  const icon = key ? icons[key] : "📬";
  const checked = lastCheck ? ` (${String(lastCheck).slice(0, 10)})` : "";
  const label = String(status).slice(0, 30);
  return `<span class="em" title="${escapeHtml(status + checked)}">${icon} ${escapeHtml(label)}</span>`;
}
```

## Header change (DONE)

Line 1556: added `<th>email</th>` between `applied` and `R`

## Row change (DONE)

After the `applied_at` td: added `<td>${emailStatusChip(j.last_email_status, j.last_email_check) || ...}</td>`

## Kanban card change (DONE)

In the `card()` function: reads `j.last_email_status` and renders via `emailStatusChip`

## CSS

The badge uses class `em` — no custom CSS needed, inherits existing badge styling from `.cmeta span`.

## Verification

After adding the function, run:
```bash
node -c scripts/lin-tracker.mjs && node scripts/lin-tracker.mjs
open data/applications.html
```

The "email" column in the Table view should show 📨 acknowledged / 🔇 silent / etc.
The Kanban cards should show the same chip below the Canada badge.
