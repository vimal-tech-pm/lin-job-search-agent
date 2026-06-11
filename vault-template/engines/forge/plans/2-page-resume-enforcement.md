# Revised Plan: 2-Page Resume Enforcement Pipeline

> **Historical note (2026-04-16)**: This plan predates the single-builder consolidation (see `plans/encapsulated-skipping-candle.md`). All Python-builder rows and parity requirements below are obsolete — only `resume-factory/scripts/build-resume.js` remains. The content guardrails, overflow-recovery protocol, and typography changes described here still apply to the JS builder.

## Context

The builder detects page overflow but just exits with error code 1 — it doesn't help produce a 2-page resume. The Netomi resume is already 3 pages, proving the gap. This revised plan merges the best of V1 (Claude) and V2 (ChatGPT), incorporates user feedback, and adds a typography lever.

**User feedback incorporated:**
1. **No "Earlier Career" section** — ATS systems struggle with non-standard section names. Old roles get bullet reduction or removal instead.
2. **Font size 11pt → 10.5pt** — modest but meaningful first lever (~3-8 lines/page saved) before content trimming.

---

## Layer 0: Typography Optimization — Font Size Reduction

Reduce all body-level font sizes from 11pt to 10.5pt. This is a one-time theme change that buys ~3-8 lines per page without touching content.

### Elements to change (all currently 11pt → 10.5pt)

| Element | JS key | Current | New |
|---------|--------|---------|-----|
| Body text / bullets | `body` | 11 / 22 | 10.5 / 21 |
| Company name | `companyName` | 11 / 22 | 10.5 / 21 |
| Achievement metric | `achievementMetric` | 11 / 22 | 10.5 / 21 |
| Education degree | `eduDegree` | 11 / 22 | 10.5 / 21 |
| Cert items | `certItem` | 11 / 22 | 10.5 / 21 |

**Leave unchanged**: Name (18pt), title (12pt), section headers (12pt), job title (11.5pt), tagline (10pt), contact (9.5pt), dates (10pt), locations (10pt), achievement context (10pt), edu institution (10pt). These are already optimized or serve as visual hierarchy anchors.

### Files to modify

| File | Change |
|------|--------|
| `resume-factory/scripts/build-resume.js` (lines 63-78) | Update 5 size values from 22 → 21 (half-points) |
| `resume-factory/themes/executive-clean.md` (lines 55-133) | Update all 11pt references to 10.5pt in documentation |

---

## Layer 1: Prevention — Content Guardrails in md-format-spec.md

Add concrete limits to `resume-factory/references/md-format-spec.md`.

### Soft warnings (builders emit, don't fail)

Using stable warning codes (from V2):
- `WARN_BULLET_COUNT_HIGH` — total bullets across all roles > 22
- `WARN_BULLET_TOO_LONG` — any single bullet > 200 characters
- `WARN_ACHIEVEMENTS_COUNT_HIGH` — more than 8 Key Achievements
- `WARN_ACHIEVEMENT_ROW_OVERFLOW` — a rendered achievement row (4 items + pipe separators + spacing) exceeds the printable line width. The existing 35-char-per-item limit in md-format-spec.md should prevent this, but when 4 items are near the ceiling, the combined row with ` | ` separators (~160+ chars) can wrap to 3+ lines. Add a check: if (sum of item lengths in a row) + (separator overhead: 3 pipes × 9 chars each = 27) > 150, warn.
- `WARN_SKILL_CATEGORIES_HIGH` — more than 4 Skills categories

Output format (grep-able):
```
WARNING [WARN_BULLET_COUNT_HIGH]: 26 bullets detected (recommended <=22).
```

Warnings do NOT change exit code.

### Guidance-only (docs, not programmatic)

- **Bullet count by recency:**
  - Most recent role: 4-6 bullets
  - 2nd and 3rd most recent: 3-5 bullets
  - 4th and older: 2-3 bullets
  - Roles >10 years old: 1-2 bullets
- **Max bullet length**: ~150 chars target, flag >200 chars
- **Key Achievements row width**: With 4 items per row plus pipe-separator spacing, the rendered row must not exceed 2 lines. Tighten items to ≤30 chars if the row overflows at 35-char items. Existing 35-char limit stays as the spec ceiling; this is a rendered-output safeguard.
- **Role handling for old/short roles**: Reduce bullets to 1-2 or remove entirely if not relevant to target JD. **Do NOT create custom section names like "Earlier Career"** — keep each role as a standard Professional Experience entry or omit it.

### Files to modify

| File | Change |
|------|--------|
| `resume-factory/references/md-format-spec.md` | Add warning-tier constraints and bullet count guidance |
| `resume-factory/scripts/build-resume.js` | Add 5 warning codes with stable output format |

---

## Layer 2: Detection — Actionable Overflow Output

The builder already detects >2 pages and exits 1. **One addition**: on overflow, print actionable context:

```
WARNING: Resume is 3 pages (max 2).
  Roles: 7 | Bullets: 26 | Target for 2 pages: ~18-20 bullets across 5-6 roles.
```

This is informational — no auto-trimming in builders.

### Files to modify

| File | Change |
|------|--------|
| `resume-factory/scripts/build-resume.js` | Add role/bullet count to overflow message |

---

## Layer 3: Correction — Deterministic Trim-and-Rebuild Loop

Add a "Page Overflow Recovery" protocol. Canonical source: `resume-factory/SKILL.md` Step 6. Other files reference it.

### Trim loop (max 3 passes)

**Pass targets** (from V2):
- Pass 1 target: ≤22 bullets
- Pass 2 target: ≤20 bullets
- Pass 3 target: ≤18 bullets

**Trim priority order** (apply in order, rebuild after each change):

1. Remove roles <6 months (internships, short stints) unless directly relevant to target JD
2. Reduce bullets in roles >10 years old to 1-2 max
3. Reduce bullets in oldest remaining roles to 2 max
4. Reduce bullets in middle-recency roles to 3 max
5. Shorten longest bullets (>150 chars) to 1-line versions
6. Reduce Key Achievements from 8 → 6 → 4 (keep most quantified, most relevant). Also tighten any achievement items causing row overflow (≤30 chars per item if 4-per-row layout wraps)
7. Tighten Professional Summary to 2 sentences

**Note**: No "Earlier Career" consolidation step. Old roles keep their standard format with reduced bullets, or are removed entirely.

### Deterministic tie-break rules (from V2)

When deciding which bullet or role to cut first, score by:
- JD keyword overlap (higher = keep)
- Quantified impact present (yes = keep)
- Recency (newer = keep)
- Role seniority signal (higher scope = keep)

If tied: cut oldest role first → shortest tenure → lowest quantified-impact density.

### Stop conditions

- **Success**: PDF ≤ 2 pages
- **After 3 passes still >2**: Stop and report to user with what was already removed, current page count, and explicit prompt for deeper cuts

### Files to modify

| File | Change |
|------|--------|
| `resume-factory/SKILL.md` | Replace Step 6 with canonical Page Overflow Recovery protocol |
| `references/commands/resume.md` | Add: "After export, verify page count. If >2, invoke Page Overflow Recovery per SKILL.md Step 6." |
| `references/commands/apply.md` | Add: "Before tracker update, verify page count ≤2. If overflow, invoke SKILL.md Step 6." |
| `CLAUDE.md` | One-liner in Resume Export Standard: "Never deliver >2 page resume. On overflow, follow `resume-factory/SKILL.md` Step 6." |
| `AGENTS.md` | Same one-liner (mirrors CLAUDE.md) |

---

## Full File Change Summary

| # | File | Layer | Change |
|---|------|-------|--------|
| 1 | `resume-factory/scripts/build-resume.js` | 0, 1, 2 | Font sizes 22→21, add 5 warning codes, add overflow context |
| 2 | `resume-factory/themes/executive-clean.md` | 0 | Update all 11pt references to 10.5pt |
| 3 | `resume-factory/references/md-format-spec.md` | 1 | Add bullet count guidelines, max length, role handling guidance |
| 4 | `resume-factory/SKILL.md` | 3 | Replace Step 6 with deterministic Page Overflow Recovery |
| 5 | `references/commands/resume.md` | 3 | Add page-count verification after export |
| 6 | `references/commands/apply.md` | 3 | Add page-count verification before tracker update |
| 7 | `CLAUDE.md` | 3 | One-liner pointer to SKILL.md Step 6 |
| 8 | `AGENTS.md` | 3 | Same one-liner (mirrors CLAUDE.md) |

---

## What NOT to Change

- **No auto-trim logic in builders.** Builders convert markdown → DOCX/PDF. Content decisions belong to the AI agent.
- **No hard errors for bullet counts.** Warnings guide the agent; senior candidates may legitimately need more content.
- **No "Earlier Career" or custom section names.** ATS systems struggle with non-standard sections. Old roles stay as standard entries with reduced bullets or get removed.

---

## Expected Outcome for the Netomi Resume

Applying this revised protocol to the current 3-page Netomi resume:

1. **Font size 11→10.5pt** → saves ~5-8 lines across 3 pages (may not be enough alone)
2. **Remove "Management Consultant Intern"** (2 months, 2011 — too short, low relevance) → saves ~4 lines
3. **Reduce "Software Test Engineer" (2008-2010)** from current bullets to 1-2 → saves ~3 lines
4. **Reduce "Sr BA / BD Lead" (2014-2016)** from 3 bullets to 2 → saves ~2 lines
5. **Reduce "BA / Solution Consultant" (2012-2014)** from 3 bullets to 2 → saves ~2 lines
6. **Tighten 2 longest Thomson Reuters bullets** → saves ~2-3 lines

Total: ~18-22 lines saved → comfortably fits in 2 pages.

---

## Verification

### Automated tests

1. `--validate-only` on high-bullet fixture → emits `WARN_BULLET_COUNT_HIGH`
2. `--validate-only` on long-bullet fixture → emits `WARN_BULLET_TOO_LONG`
3. Overflow fixture with `--pdf` → prints role/bullet counts + target hint, exit 1
4. Existing invalid fixtures → same hard-error semantics unchanged

### Manual smoke tests

5. Build Netomi resume → overflow detected with actionable context
6. Apply trim protocol iteratively → achieves ≤2 pages (or escalates after 3 passes)
7. Build compact-valid.md → no warnings, clean pass
8. Verify 10.5pt renders cleanly in both DOCX and PDF output

---

## Status

- [ ] Implementation pending
- Revised: 2026-04-04
