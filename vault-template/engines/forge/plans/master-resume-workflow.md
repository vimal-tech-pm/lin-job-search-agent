# Plan: Master Resume Workflow with `source` Command

## Context

The interview coaching skill has a `candidate_source_material.md` and a `Master_Resume.md` but no formal workflow connecting them. Currently:
- Source material was created ad-hoc during kickoff
- No command exists to build/enrich source material over time
- No mechanism syncs source material changes → master resume → tailored variants
- `coaching_state.md` has extensive merge conflicts from parallel sessions that need resolution first
- Multiple commands (analyze, debrief, stories, feedback) surface new material but it never flows back to source material or master resume

**Goal**: Create a `source` command and auto-sync pipeline so that: raw candidate input → `candidate_source_material.md` → `Master_Resume.md` → tailored variants stay in sync, with enrichment possible from any coaching session.

**Design decisions made:**
- New standalone `source` command (not distributed across existing commands)
- Auto-sync on every change (source material change → master resume regeneration → stale variant flagging)
- Fix merge conflicts in coaching_state.md as a prerequisite

---

## Phase 0: Fix Merge Conflicts in coaching_state.md

**Files to modify:**
- `memory/coaching_state.md`
- `memory/interview_tracker.md` (if conflicts exist)

**Approach:**
- Read the full file and resolve all `<<<<<<< ours` / `>>>>>>> theirs` markers
- Keep the most recent data (2026-04-06 versions) for conflicting fields
- For Interview Loops (Netomi, AlphaSense): keep the most detailed/recent version of each entry
- For Resume Optimization: keep the 2026-04-06 AlphaSense variant data (most recent)
- Verify the resolved file matches the schema in CLAUDE.md

---

## Phase 1: Create the `source` Command

### 1a. Create `references/commands/source.md`

This is the command reference file defining the `source` workflow.

**Command purpose**: Build, enrich, and maintain `source_files/candidate_source_material.md` — the raw career material repository that feeds into the master resume and storybank.

**Sub-commands:**
| Sub-command | Purpose |
|-------------|---------|
| `source build` | Initial build from resume, LinkedIn, and candidate input |
| `source enrich` | Add new material to an existing company section or add a new company |
| `source review` | Show what's in source material, what's pending, what gaps exist |
| `source sync` | Trigger master resume regeneration from current source material |

**Core Logic / Sequence:**

**`source build` (initial creation):**
1. Check if `source_files/candidate_source_material.md` already exists → if yes, confirm overwrite or switch to `source enrich`
2. Gather inputs: resume text, LinkedIn profile, any additional docs (career portfolio, detailed experience docs)
3. For each company/role detected, create a section with:
   - Canonical Role Snapshot (company, role, dates, geography, product context)
   - Canonical Scope
   - Verified Context & Metrics (quantified achievements with source attribution)
   - Major Workstreams (grouped themes)
   - Year-by-Year Detail (for current/recent roles with 3+ years)
   - Leadership & Seniority Signals
   - Best Resume Material Candidates (with status: in-master / pending / rejected)
   - Storybank Candidates (with status: captured-as-S### / pending / rejected)
4. Create Working Rules section (source priority, metric conflict rules, target role)
5. Create Source Files section (list of original documents used)
6. Save to `source_files/candidate_source_material.md`
7. **Auto-sync**: Immediately trigger master resume build/refresh (Phase 2 auto-sync)

**`source enrich` (ongoing updates):**
1. Accept new material: text, metrics, achievements, project details, interview learnings
2. Ask which company/role this belongs to (or detect from context)
3. Update the relevant section in `candidate_source_material.md`:
   - Add new metrics to Verified Context & Metrics
   - Add new workstreams or detail to existing ones
   - Update Year-by-Year Detail
   - Add new Resume Material Candidates
   - Add new Storybank Candidates
4. Update `Last updated` date
5. **Auto-sync**: Regenerate master resume, flag active tailored variants as stale

**`source review`:**
1. Read `source_files/candidate_source_material.md`
2. Show summary: companies covered, completeness per company, pending sections
3. Cross-reference with coaching state storybank: which storybank candidates have been captured vs. pending
4. Cross-reference with master resume: which Resume Material Candidates are reflected in bullets vs. missing
5. Flag gaps: companies with "Pending details" status

**`source sync`** (explicit manual trigger, also runs automatically):
1. Read current `source_files/candidate_source_material.md`
2. Read current `source_files/<Name>_Master_Resume.md`
3. Compare: which Resume Material Candidates from source are missing or underrepresented in master resume
4. Regenerate/update the master resume using the full source material
5. Validate against `resume-factory/references/md-format-spec.md`
6. Export updated master resume (PDF/DOCX)
7. Check for active tailored variants in `applications/active/` → flag each as potentially stale
8. Update coaching state: Resume Optimization section + Source Material Freshness tracking
9. Report what changed and what tailored variants may need refreshing

**Output Schema for `source build`/`source enrich`:**
```markdown
## Source Material Update

### What Changed
- [company]: [what was added/updated]

### Source Material Status
| Company | Sections Complete | Metrics Verified | Storybank Candidates | Resume Material Candidates | Status |
|---------|-------------------|------------------|----------------------|---------------------------|--------|

### Master Resume Sync
- Master resume: [refreshed / flagged for refresh]
- Bullets added/updated: [count]
- Active variants potentially stale: [list]

**Recommended next**: `[command]` — [reason]. **Alternatives**: `[command]`, `[command]`
```

### 1b. Add `source` to Command Registry in CLAUDE.md

Add to the command table:
```
| `source` | Build/enrich candidate source material and sync to master resume |
```

Add to Mode Detection Priority (after existing entries, before "Otherwise"):
```
- Source material / "add to my source material" / "update my career details" / "I have new metrics" / "enrich my profile" intent → `source`
```

Add to Multi-Step Intent Detection:
```
| "I want to build my resume from scratch" | `source build` → `resume` (Deep Optimization) → `stories` |
| "I have new achievements to add" | `source enrich` → (auto-sync master resume) |
```

Add to File Routing:
```
- **`source`**: Also read `references/commands/resume.md` (for master resume conventions and md-format-spec awareness), `references/storybank-guide.md` (for storybank candidate identification).
```

### 1c. Add Source Material Freshness Tracking to Coaching State Schema

Add new section to the coaching state schema in CLAUDE.md (after Resume Optimization):

```markdown
## Source Material
- Last updated: [date]
- Last master sync: [date]
- Sync status: [synced / stale — source updated since last master build]
- Companies covered: [list]
- Pending sections: [companies or sections marked "Pending details"]
- Stale tailored variants: [list of application folders needing refresh, or "none"]
```

Add to Schema Migration Check:
```
- **Missing `Source Material` section**: Add the section header with empty fields. Note in Coaching Notes: "[date]: Source Material tracking section added. Run `source review` to populate."
```

### 1d. Add State Update Triggers for `source`

Add to the State Update Triggers list in CLAUDE.md:
```
- source builds or enriches candidate source material (save Source Material section to memory/coaching_state.md — last updated, last master sync, sync status, companies covered, pending sections, stale tailored variants). Auto-trigger master resume regeneration: update `source_files/<Name>_Master_Resume.md`, run export, update Resume Optimization section, flag stale tailored variants.
```

### 1e. Wire Auto-Sync into Existing Commands

Add "source material enrichment hooks" to these existing commands' reference files:

**`references/commands/analyze.md`** — Add after scoring:
> When analysis reveals new quantified achievements, impactful metrics, or strong behavioral examples not already in `source_files/candidate_source_material.md`, append them to the relevant company's section (Verified Context & Metrics, or Storybank Candidates). Update the Source Material tracking in coaching state. This triggers auto-sync to master resume.

**`references/commands/debrief.md`** — Add after capture:
> When debrief captures recalled details, metrics, or context about past work not already in source material, route to `source_files/candidate_source_material.md`. Update Source Material tracking.

**`references/commands/stories.md`** — Add after story creation/improvement:
> When a story is added or improved with new earned secrets, metrics, or details, check if `source_files/candidate_source_material.md` is missing this material. If so, enrich the relevant company section. Update Source Material tracking. This triggers auto-sync.

**`references/commands/feedback.md`** — Add to Type E (post-session memories):
> When candidate provides career details, metrics, or achievements as post-session context, route to `source_files/candidate_source_material.md` in addition to wherever else it belongs.

### 1f. Update kickoff to Use `source build`

In `references/commands/kickoff.md`, add after Step 2.5 (Resume Analysis):

> **Step 2.7: Source Material Initialization**
> After resume analysis, check if `source_files/candidate_source_material.md` exists.
> - If it does NOT exist: Build it from the resume and any additional documents provided (LinkedIn, career portfolio). Follow the `source build` workflow — create sections for each company with Canonical Role Snapshot, Verified Context & Metrics, Major Workstreams, Resume Material Candidates, and Storybank Candidates.
> - If it DOES exist: Run a quick freshness check — is the source material consistent with what the candidate just provided? Flag any discrepancies.
>
> This step ensures every kickoff produces a usable `candidate_source_material.md` that downstream commands can enrich.

### 1g. Update `apply` to Check Sync Status

In `references/commands/apply.md`, add to Priority Check:

> - If Source Material sync status is "stale" (source updated since last master build): "Your source material has been updated since your last master resume build. I'll refresh the master resume first to ensure the tailored variant uses your latest material." Run `source sync` before proceeding to Step 5 (Tailored Resume).

---

## Phase 2: Auto-Sync Pipeline Implementation

The auto-sync mechanism defined in the `source` command reference and CLAUDE.md:

**When source material changes (via `source enrich`, `source build`, or enrichment hooks from analyze/debrief/stories/feedback):**

1. Update `source_files/candidate_source_material.md` with new material
2. Set coaching state Source Material → Sync status: "stale"
3. Read current master resume from `source_files/<Name>_Master_Resume.md`
4. Identify new Resume Material Candidates from source that are missing from master resume
5. Regenerate master resume:
   - Add new bullets derived from new source material
   - Reorder bullets to keep strongest material prominent
   - Ensure format compliance with `resume-factory/references/md-format-spec.md`
   - Master resume has NO page limit — include everything worth having
6. Save updated master resume
7. Export updated master (PDF/DOCX via resume-factory builder)
8. Set coaching state Source Material → Sync status: "synced", Last master sync: today
9. Scan `applications/active/*/` for tailored variants → list them as "potentially stale" in Source Material section
10. Update Resume Optimization section with new date
11. Report: "Master resume refreshed with [N] new bullets from source material. [X] active tailored variants may need updating — run `apply` again for any active applications to get fresh variants."

---

## Phase 3: Formalize `candidate_source_material.md` Schema

The current file structure is good but needs these additions:

**Standardized company section template:**
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
[what was owned]

#### Verified Context And Metrics
[quantified achievements — each with source: resume/LinkedIn/candidate-stated/interview-surfaced]

#### Major Workstreams
[grouped by theme]

#### Year-By-Year Detail (for roles 3+ years)
[timeline progression]

#### Leadership And Seniority Signals
[scope indicators]

#### Best Resume Material Candidates
[which achievements should appear on paper — with status: in-master / pending / rejected]

#### Storybank Candidates
[which experiences could become stories — with status: captured-as-S### / pending / rejected]
```

**Key additions to current format:**
- Source attribution on metrics (resume / LinkedIn / candidate-stated / interview-surfaced)
- Status tracking on Resume Material Candidates (in-master / pending / rejected)
- Status tracking on Storybank Candidates (captured-as-S### / pending / rejected)

---

## Complete Data Flow

```
                    Raw Inputs
    ┌──────────────────┼──────────────────┐
    │                  │                  │
 Resume          LinkedIn            Coaching
 (kickoff)       (kickoff)           Sessions
                                    (analyze,
                                     debrief,
                                     stories,
                                     feedback)
    │                  │                  │
    └──────────────────┼──────────────────┘
                       │
                       ▼
        ┌──────────────────────────┐
        │  candidate_source_       │
        │  material.md             │
        │  (source_files/)         │
        │                          │
        │  Per-company sections    │
        │  with verified metrics,  │
        │  resume material         │
        │  candidates, storybank   │
        │  candidates              │
        └────────────┬─────────────┘
                     │
              AUTO-SYNC (on every change)
                     │
                     ▼
        ┌──────────────────────────┐
        │  Master_Resume.md        │
        │  (source_files/)         │
        │                          │
        │  Comprehensive,          │
        │  untailored, no page     │
        │  limit, buildable .md    │
        └────────────┬─────────────┘
                     │
              ON-DEMAND (via `apply`)
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │Variant A│ │Variant B│ │Variant C│
   │(Netomi) │ │(Alpha-  │ │(future) │
   │         │ │ Sense)  │ │         │
   └─────────┘ └─────────┘ └─────────┘
   applications/active/Company_Role/
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `memory/coaching_state.md` | **Modify** | Resolve all merge conflicts, add Source Material section |
| `memory/interview_tracker.md` | **Modify** | Resolve merge conflicts if present |
| `references/commands/source.md` | **Create** | New command reference file |
| `CLAUDE.md` | **Modify** | Add `source` to command registry, mode detection, multi-step intent, file routing, state update triggers, schema migration, coaching state schema |
| `references/commands/kickoff.md` | **Modify** | Add Step 2.7 source material initialization |
| `references/commands/apply.md` | **Modify** | Add sync status check to Priority Check |
| `references/commands/resume.md` | **Modify** | Add source material context assembly step |
| `references/commands/analyze.md` | **Modify** | Add source material enrichment hook |
| `references/commands/debrief.md` | **Modify** | Add source material enrichment hook |
| `references/commands/stories.md` | **Modify** | Add source material enrichment hook |
| `references/commands/feedback.md` | **Modify** | Add source material enrichment hook |
| `source_files/candidate_source_material.md` | **Modify** | Add status tracking to Resume Material Candidates and Storybank Candidates |

---

## Verification

1. **Schema check**: After modifying CLAUDE.md, verify the coaching state schema includes Source Material section and all references are consistent
2. **Command registry check**: Verify `source` appears in the command table, mode detection, multi-step intent, and file routing
3. **Cross-reference check**: Verify all enrichment hooks in analyze/debrief/stories/feedback reference the correct source material path
4. **Existing file check**: Verify `candidate_source_material.md` gains status tracking columns without losing existing data
5. **Merge conflict resolution**: Verify `coaching_state.md` has zero `<<<<<<<` markers after cleanup
6. **End-to-end flow test**: Mentally trace: `source build` → `source enrich` (add a new metric) → auto-sync fires → master resume updates → `apply` for a new JD → tailored variant uses the new material
