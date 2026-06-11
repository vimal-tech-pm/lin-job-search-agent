# apply — New Job Application Workflow

Start a new application loop interactively. This command is the application equivalent of `kickoff`: it asks for the JD one question at a time, runs the decode, produces a tailored resume, and organizes the resulting artifacts into the application workspace.

This command is not a replacement for `decode` or `resume`. It orchestrates them in the right sequence and makes sure the tracker, folder structure, and saved outputs stay clean.

Also read:
- `references/commands/decode.md`
- `references/commands/resume.md`
- `references/differentiation.md`
- `references/storybank-guide.md`

---

## Priority Check

- If no `memory/coaching_state.md` exists: soft-gate to `kickoff` first.
- Regardless of entry path, ensure `memory/` exists before any tracker or state write with `mkdir -p memory`.
- If no master resume exists: create or refresh the master resume before tailoring.
- If Source Material sync status in coaching state is "stale": "Your source material has been updated since your last master resume build. Refreshing the master resume first to ensure the tailored variant uses your latest material." Run `source sync` before proceeding to Step 5.
- If the role already has an active application folder and tracker row: show what exists and ask whether this is a JD refresh or a new variant.

---

## Required Inputs

- Job description text, JD URL, or JD file path

## Optional Inputs

- Application priority: High / Medium / Low
- Existing company context (if already in the tracker)
- Output preference if the candidate wants a specific resume filename

---

## One-Question-at-a-Time Intake

Enforce sequencing:
1. Ask for the JD if it was not provided.
2. If company or role is ambiguous after parsing, ask for the missing clarification.
3. If fit is `Weak` or `Long-Shot Stretch`, pause after decode and ask whether to continue with a tailored resume anyway.

Do not ask for multiple fields at once unless the candidate explicitly wants a fast checklist.

---

## Logic / Sequence

### Step 1: Intake And Parse

- Accept the JD as pasted text, URL, PDF, DOCX, or plain description.
- Extract company and role from the JD.
- Normalize a folder-safe application name as `Company_Role`.

### Step 2: Workspace Setup

Create or update:
- `applications/active/Company_Role/`
- `applications/active/Company_Role/source/`

Store the JD source or a cleaned JD copy in the application folder.

### Step 3: Run Decode

Run a Standard `decode` by default:
- competency extraction
- fit verdict
- frameable vs structural gaps
- recruiter verification questions

Save the decode into the application folder.

### Step 4: Decision Gate

- If verdict is `Strong Fit` or `Investable Stretch`: continue directly to tailored resume creation.
- If verdict is `Long-Shot Stretch` or `Weak Fit`: tell the candidate clearly, then ask whether they still want the tailored resume.

### Step 5: Tailored Resume

Locate the master resume in `source_files/` (e.g., `source_files/<Name>_Master_Resume.md`). If no master resume exists, gate here — prompt the candidate to provide one or run `kickoff` first. Never tailor from a previously tailored variant.

Run the `resume` command's JD-Targeted Optimization (Step 7) against the master resume, using the decoded JD from Step 3 as input.

When running JD-targeted resume creation, enforce the Experience Coverage Rule from `references/commands/resume.md`: every master-resume experience must appear in the tailored final resume, with bullet density determined by JD relevance.

Save the tailored resume as buildable Markdown (per `resume-factory/references/md-format-spec.md`) in the application folder.
Follow `resume` Step 8 (Export) to generate `.docx` and `.pdf` alongside the `.md`.

### Step 6: Outputs And Export Targets

Always prepare the output paths even if actual export is deferred:
- markdown resume in the application folder
- `.docx` and `.pdf` export targets alongside the markdown resume

If the environment can produce exports cleanly, use `node resume-factory/scripts/build-resume.js <resume.md> executive-clean <output-base> --pdf`, with `<output-base>` set to the markdown resume path without its extension, so the generated `.docx` and `.pdf` land next to the `.md`. Run `npm install --prefix resume-factory` once per environment first so Playwright + Chromium are provisioned; the `--pdf` step fails fast (exit 1) with an install hint if they are missing. If the environment cannot export, still create and reference the target file paths.

After generating PDF, verify page count ≤2. If the resume overflows, apply the Page Overflow Recovery protocol from `resume-factory/SKILL.md` Step 6 before updating the tracker.

### Step 7: Tracker And State Updates

Before writing tracker or state outputs, ensure `memory/` exists with `mkdir -p memory`.

If `memory/interview_tracker.md` does not exist, create it as a fallback with these template headers before updating the relevant row:

```markdown
# Interview Tracker
Last updated: [date]

## Active Applications
| Company | Role | Status | Priority | Next Step | Last Updated |
|---------|------|--------|----------|-----------|--------------|

## Upcoming Schedule
| Date | Company | Role | Stage | Notes |
|------|---------|------|-------|-------|

## Backlog / Targets
| Company | Role | Source | Priority | Notes |
|---------|------|--------|----------|-------|
```

Update:
- `memory/interview_tracker.md`
- `memory/coaching_state.md` Interview Loops
- `memory/coaching_state.md` JD Analysis section
- `memory/coaching_state.md` Resume Optimization section
- Session Log

If the role already exists in the tracker, refresh the row instead of duplicating it.

If `memory/coaching_state.md` is still missing because the candidate skipped or deferred `kickoff`, preserve the soft-gate language, but still create `memory/interview_tracker.md` so the application workflow remains self-bootstrapping on disk.

---

## Output Schema

Return exactly:

```markdown
## Application Setup: [Company] — [Role]
- Workspace: [application folder path]
- JD source: [what was used]
- Priority: [High / Medium / Low / not set]

## Decode Summary
- Verdict: [Strong Fit / Investable Stretch / Long-Shot Stretch / Weak Fit]
- Strongest match: [top evidence-based match]
- Biggest gap: [top gap]
- Decision note: [apply / apply with eyes open / probably skip]

## Tailored Resume
- Master resume source: [path to master resume used, e.g., source_files/First_Last_Master_Resume.md]
- Positioning shift: [how the resume was adapted for this JD]
- Keywords emphasized: [top keyword/theme list]
- Files created:
  - [decode file]
  - [resume file]
  - [pdf file]
  - [docx file]

## Tracker Update
- Status: [created / updated]
- Next action: [single next action]

**Recommended next**: `[command]` — [highest-leverage next move]. **Alternatives**: `[command]`, `[command]`
```

---

## Notes

- This command is designed for a single serious application, not batch triage.
- Use `decode` directly when the candidate only wants a fit read.
- Use `resume` directly when the candidate already has the target role, company, and keyword direction locked.
