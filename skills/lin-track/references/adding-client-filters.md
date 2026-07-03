# Adding Client-Side Filters — Worked Example: Seniority Level

Implemented 2026-06-25. The user wanted to group Product Manager roles by seniority level (Group, Director, Principal, Staff, Senior, PM) in the dashboard — without any backend data model changes.

## Implementation

**Three files changed, zero backend changes** (no job.yml, tracker-data.mjs, or pipeline modification):

### 1. `scripts/lib/tracker-html.mjs`

Added a helper to classify role titles at render time:

```js
function seniorityLevel(role) {
  const t = String(role || "");
  if (/\bgroup\b/i.test(t)) return "Group";
  if(/\bdirector\b/i.test(t)) return "Director";
  if (/\bprincipal\b/i.test(t)) return "Principal";
  if (/\bstaff\b/i.test(t)) return "Staff";
  if (/\bsenior\b|\bsr\.?\b/i.test(t)) return "Senior";
  return "PM";
}
```

**Order matters** — highest-rank prefix wins so "Senior Principal Product Manager" → Principal, not Senior.

Emitted `data-level` on the `<tr>` inside `rowHtml()`:
```js
data-level="${level}"      // added alongside existing data- attributes
```

Added dropdown to the filter bar in `renderHtml()`:
```html
<select id="f-level" title="seniority level (derived from the role title)">
  <option value="any">level: any</option>
  <option value="Group">Group</option>
  <option value="Director">Director</option>
  <option value="Principal">Principal</option>
  <option value="Staff">Staff</option>
  <option value="Senior">Senior</option>
  <option value="PM">PM</option>
</select>
```

### 2. `scripts/templates/dashboard.js`

Filter check in `rowVisible()`:
```js
const lvl = $("#f-level").value;
if (lvl !== "any" && tr.dataset.level !== lvl) return false;
```

Wired into the listener array so changes trigger refresh:
```js
["q", "f-score", "f-canada", "f-source", "f-level"].forEach(...)
```

### 3. Regenerate

```bash
cd ~/.hermes/profiles/lin/lin && node scripts/lin-tracker.mjs
```

This is critical — the template edits alone don't update the static `applications.html`.

## Distribution (post-implementation)

Senior 412, PM 393, Principal 64, Staff 61, Group 9, Director 5.

Edge cases verified: "Associate Director, Product" → Director, "Sr. Product Manager" → Senior, "Product Owner" → PM.

## Pattern

Any future client-side-only filter follows the same 4-step recipe:
1. Add a helper + `data-*` attribute in `tracker-html.mjs`
2. Add a filter control HTML in `renderHtml()`
3. Add the filter check + listener wire in `dashboard.js`
4. Regenerate with `lin-tracker.mjs`
