# source — Candidate Source Material Management

Build, enrich, and maintain `source_files/candidate_source_material.md` — the raw career material repository that feeds into the master resume and storybank. The `source` command is the canonical entry point for adding new career details, metrics, and achievements to the system.

Also read `references/commands/resume.md` (for master resume conventions and md-format-spec awareness) and `references/storybank-guide.md` (for storybank candidate identification).

---

## Why Source Material Exists

The master resume is a curated document — it can't capture every detail from 15+ years of work. Source material is the unfiltered repository: every quantified achievement, every workstream, every leadership signal. The master resume is derived from source material, not the other way around.

The pipeline is:
```
Raw Inputs (resume, LinkedIn, coaching sessions)
         ↓
candidate_source_material.md   (comprehensive, unfiltered)
         ↓  [auto-sync on every change]
Master_Resume.md               (curated, buildable, no page limit)
         ↓  [on-demand via apply]
Tailored Variants              (JD-targeted, 2-page cap)
```

When source material changes, the master resume becomes stale. The `source` command manages that sync cycle.

---

## Sub-Commands

| Sub-command | Purpose |
|-------------|---------|
| `source build` | Initial build from resume, LinkedIn, and candidate input |
| `source enrich` | Add new material to an existing company section or add a new company |
| `source review` | Show completeness, pending sections, and cross-reference gaps |
| `source sync` | Trigger master resume regeneration from current source material |

---

## `source build`

**Purpose**: Create `source_files/candidate_source_material.md` from scratch.

**Sequence**:

1. **Existence check**: If `source_files/candidate_source_material.md` already exists, confirm overwrite or redirect to `source enrich`.

2. **Input gathering**: Collect the candidate's resume text, LinkedIn profile content, and any additional documents (career portfolio, detailed experience notes, prior application materials). If these are already on disk (e.g., from kickoff), read them directly.

3. **Company detection**: Identify every company/role from the inputs. For each, create a section using the standardized template below.

4. **Section build** (per company):
   - **Canonical Role Snapshot**: company, business area, role, date range, geography, product context
   - **Canonical Scope**: what was owned — products, users, teams, budgets
   - **Verified Context and Metrics**: quantified achievements. Each metric tagged with source: `resume` / `LinkedIn` / `candidate-stated` / `interview-surfaced`. When two sources conflict, keep both and note the discrepancy for candidate to resolve.
   - **Major Workstreams**: group by theme (e.g., "Platform Migration", "AI Innovation", "Cross-Functional Leadership")
   - **Year-by-Year Detail**: for current or recent roles with 3+ years, trace progression by year
   - **Leadership and Seniority Signals**: scope indicators — team size, budget, stakeholder level, strategic decisions owned
   - **Best Resume Material Candidates**: which achievements should appear on the master resume. Each item tagged `(status: in-master)` or `(status: pending)`.
   - **Storybank Candidates**: which experiences could become interview stories. Each item tagged `(status: captured-as-S###)` or `(status: pending)`.

5. **Working Rules section**: Document source priority (LinkedIn > resume for recency), metric conflict resolution rules, and target role context.

6. **Source Files section**: List all original documents used to build this file.

7. **Save** to `source_files/candidate_source_material.md`.

8. **Auto-sync**: Immediately trigger master resume regeneration (see `source sync`). Update coaching state Source Material section.

**Output schema**:
```markdown
## Source Material Update

### What Changed
- [company]: Initial section created from [sources used]

### Source Material Status
| Company | Sections Complete | Metrics Verified | Storybank Candidates | Resume Material Candidates | Status |
|---------|-------------------|------------------|----------------------|---------------------------|--------|
| [company] | [yes/partial/pending] | [count] | [count] | [count] | [synced/stale] |

### Master Resume Sync
- Master resume: [refreshed / no changes needed]
- Bullets added/updated: [count]
- Active variants potentially stale: [list or "none"]

**Recommended next**: `source enrich` — fill in Pending Details sections with additional context. **Alternatives**: `stories`, `resume`
```

---

## `source enrich`

**Purpose**: Add new material to an existing company's section, or add a new company that was missing from the initial build.

**Sequence**:

1. **Input acceptance**: Accept new material in any form — free text, pasted metric, interview learning, achievement detail, project outcome, updated metric from a debrief.

2. **Company identification**: Detect from context which company/role this belongs to, or ask: "Which company does this belong to?"

3. **Section update**:
   - New quantified achievement → add to **Verified Context and Metrics** with source attribution
   - New project or theme → add to **Major Workstreams**
   - Year-specific detail → add to **Year-by-Year Detail**
   - Leadership evidence → add to **Leadership and Seniority Signals**
   - Good resume bullet candidate → add to **Best Resume Material Candidates** with `(status: pending)`
   - Strong story candidate → add to **Storybank Candidates** with `(status: pending)`

4. **New company**: If this is a company not yet in source material, create a full section using the standardized template. Mark incomplete fields as "Pending details from candidate."

5. **Update Last updated date**.

6. **Auto-sync**: Set coaching state Source Material → Sync status: "stale". Trigger `source sync` to regenerate the master resume.

**Output schema**: Same as `source build`.

---

## `source review`

**Purpose**: Audit the current state of source material — completeness, gaps, and cross-reference status.

**Sequence**:

1. **Read** `source_files/candidate_source_material.md`.

2. **Completeness summary**: For each company, show which sections are complete vs. "Pending details".

3. **Storybank cross-reference**: Compare Storybank Candidates in source material against `memory/coaching_state.md` Storybank. Flag:
   - Candidates with `(status: pending)` that could be built into stories now
   - Stories in the storybank not yet linked to a source material entry

4. **Resume cross-reference**: Compare Best Resume Material Candidates against the master resume bullets. Flag:
   - Items with `(status: pending)` — not yet reflected in the master resume
   - Items with `(status: in-master)` — verify they still appear in the current master

5. **Sync status**: Report whether master resume is synced or stale.

**Output schema**:
```markdown
## Source Material Review

### Coverage
| Company | Canonical Snapshot | Metrics Verified | Workstreams | Year-by-Year | Storybank Candidates | Resume Material Candidates |
|---------|-------------------|------------------|-------------|--------------|----------------------|---------------------------|

### Pending Items
**Resume Material Candidates not yet in master resume:**
- [company]: [item] (status: pending)

**Storybank Candidates not yet captured:**
- [company]: [item] (status: pending)

**Companies with incomplete sections:**
- [company]: [list of missing/pending sections]

### Sync Status
- Source material last updated: [date]
- Master resume last synced: [date]
- Status: [synced / stale]

**Recommended next**: `source enrich [company]` — [reason]. **Alternatives**: `stories add`, `source sync`
```

---

## `source sync`

**Purpose**: Regenerate the master resume from current source material. Also runs automatically after `source build` and `source enrich`.

**Sequence**:

1. **Read** `source_files/candidate_source_material.md` and `source_files/<Name>_Master_Resume.md`.

2. **Gap analysis**: Identify Best Resume Material Candidates with `(status: pending)` not yet reflected in the master resume.

3. **Regenerate master resume**:
   - Add bullets derived from pending Resume Material Candidates
   - Reorder bullets to keep strongest, most quantified material prominent
   - Remove or compress bullets that are now outdated or superseded by better source material
   - Ensure compliance with `resume-factory/references/md-format-spec.md` (buildable Markdown, standard section headers, no Earlier Career sections)
   - The master resume has **no page limit** — include all material worth having. Page limits apply only to tailored variants.

4. **Update status**: Mark newly incorporated items as `(status: in-master)` in `source_files/candidate_source_material.md`.

5. **Export**: Build the master resume PDF/DOCX using:
   ```
   node resume-factory/scripts/build-resume.js <master.md> executive-clean <output-base> --pdf
   ```
   (run `npm install --prefix resume-factory` once per environment; PDF rendering needs Playwright + Chromium, which the postinstall hook provisions — `--pdf` fails fast with an install hint if they are missing)

6. **Stale variant detection**: Scan `applications/active/*/` for tailored variants. List each active application folder as "potentially stale" in the coaching state Source Material section.

7. **Update coaching state**:
   - Source Material → Last master sync: today, Sync status: "synced", Stale tailored variants: [list]
   - Resume Optimization → Date: today

8. **Report** what changed and which tailored variants may need refreshing.

**Output schema**:
```markdown
## Master Resume Sync Complete

### Changes Made
- Bullets added: [count] — [brief summary of what was added]
- Bullets updated: [count]
- Items promoted to in-master: [list]

### Active Variants Potentially Stale
[list of application folders, or "none"]

To refresh a variant: run `apply` for that company again. It will pull from the updated master resume.

**Recommended next**: `apply [company]` — refresh the highest-priority tailored variant. **Alternatives**: `source enrich`, `stories`
```

---

## Standardized Company Section Template

```markdown
### [Company Name]

#### Canonical Role Snapshot
- Company:
- Business area:
- Role:
- Date range:
- Geography:
- Product context:

#### Canonical Scope
[what was owned — products, users, teams, budget]

#### Verified Context and Metrics
[quantified achievements — each tagged with source: resume / LinkedIn / candidate-stated / interview-surfaced]

#### Major Workstreams
[grouped by theme]

#### Year-by-Year Detail
[for roles 3+ years — trace progression annually]

#### Leadership and Seniority Signals
[scope indicators — team size, budget, stakeholder level, strategic decisions]

#### Best Resume Material Candidates
- [achievement] (status: in-master / pending / rejected)

#### Storybank Candidates
- [experience] (status: captured-as-S### / pending / rejected)
```

---

## Auto-Sync Behavior

Auto-sync fires whenever source material changes (via `source build`, `source enrich`, or enrichment hooks from `analyze`, `debrief`, `stories`, or `feedback`). It does the following without requiring an explicit `source sync` call:

1. Sets coaching state Source Material → Sync status: "stale"
2. Identifies new Resume Material Candidates to incorporate
3. Updates the master resume
4. Exports updated master PDF/DOCX
5. Lists active tailored variants as potentially stale
6. Sets Sync status: "synced"

If the master resume update would require content judgment calls (e.g., which of two competing bullets is stronger), present the decision to the candidate rather than guessing.

---

## Coaching State Integration

After any `source` sub-command, update `memory/coaching_state.md`:

```markdown
## Source Material
- Last updated: [date]
- Last master sync: [date]
- Sync status: [synced / stale]
- Companies covered: [list]
- Pending sections: [companies or sections with "Pending details"]
- Stale tailored variants: [list of application folders, or "none"]
```

Also update Resume Optimization → Date when master resume is rebuilt.

---

## Enrichment Hooks from Other Commands

The `source` workflow is also triggered by other commands when they surface new career material:

- **`analyze`**: New metrics or behavioral examples found in transcript analysis → enrich source material
- **`debrief`**: Recalled career details → enrich source material
- **`stories`**: New story added or improved with new earned secrets → update Storybank Candidates status + enrich Verified Context and Metrics
- **`feedback` Type D**: Post-session career detail → enrich source material
- **`kickoff`**: Builds initial source material during Step 2.7

In all cases, after enrichment: set Sync status: "stale" and trigger auto-sync.
