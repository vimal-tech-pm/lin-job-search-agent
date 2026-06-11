# Quick Setup For A New Person

This guide is for using this repository to customize resumes and job-search materials for another person.

Yes, you can copy this project folder to a pen drive and open it on another laptop. The important part is to make a clean copy first so the new person does not inherit someone else's resume, applications, memory, or tracker.

## What This Tool Does

This folder contains an AI interview and resume coach. It can:

- Read a resume and create a coaching profile.
- Decode job descriptions.
- Build tailored resumes for specific jobs.
- Save each application in its own folder.
- Track interview loops and next steps.

The main commands a user will type into Codex or Claude are:

- `kickoff` — start a new person's profile.
- `apply [job link]` — decode a job and build a tailored resume.
- `resume` — improve a resume.
- `prep [company]` — prepare for an interview.
- `help` — see available commands.

## Before Giving This To Another Person

Make a clean copy. Do not give them a folder that still contains the previous person's private files.

### Delete Personal Data

In the copied folder, delete the contents of these folders:

- `memory/`
- `source_files/`
- `applications/active/`
- `applications/archive/`

Keep the folders themselves if possible. If you accidentally delete the folders, recreate them with the same names.

Also delete any personal resume, PDF, DOCX, job application, or tracker files you see anywhere in the copy.

### Keep These Folders And Files

Do not delete these:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `references/`
- `resume-factory/`
- `scripts/`
- `applications/README.md`
- `memory/README.md`
- `instruction-new.md`

These are the system instructions and tools.

### Optional Privacy Step

If the new person will not use your GitHub repository, delete the hidden `.git/` folder from the copied project. This prevents accidental commits or pushes to the original repository.

On most computers, hidden folders are not visible by default. If you do not see `.git/`, skip this step.

## Copying To A Pen Drive

1. Create a clean copy of the project folder.
2. Rename it for the new person, for example:
   - `interview-coach-jane`
   - `resume-coach-arun`
3. Copy that renamed folder to the pen drive.
4. On the other laptop, copy the folder from the pen drive to a normal working location, such as:
   - Documents
   - Desktop
   - VS Code workspace folder
5. Open the copied folder in VS Code, Codex, Claude Code, Cursor, or another AI coding workspace that can read and write files.

Do not work directly from the pen drive if possible. Copy the folder to the laptop first. It will be faster and safer.

## What The New Person Needs Installed

Minimum:

- VS Code or another editor.
- Codex, Claude Code, Cursor, or another AI assistant that can open the folder and edit files.

Recommended for resume PDF/DOCX export:

- Node.js LTS.
- npm packages for the resume builder.

If Node.js is not installed, the AI can still write resume Markdown, but PDF/DOCX export may not work until Node is installed.

After opening the folder, ask the AI:

```text
Check whether this project is ready to build resumes on this laptop.
If needed, install or set up the resume-factory dependencies.
```

## First-Time Setup For A New Candidate

Open the clean folder in the AI workspace and type:

```text
kickoff
```

The coach will ask for:

- Resume.
- Target role.
- Seniority level.
- Interview timeline.
- Main concern.
- Preferred feedback directness.

Let the coach ask one question at a time. Paste the resume when asked.

After kickoff, the coach will create new private working files in:

- `memory/coaching_state.md`
- `memory/interview_tracker.md`
- `source_files/`

These files now belong to the new person.

## Applying To A Job

When the new person has a job link, type:

```text
apply [paste job link here]
```

Example:

```text
apply https://company.com/jobs/product-manager
```

The coach should:

1. Read the job description.
2. Decode the role.
3. Compare it to the person's resume.
4. Create a tailored resume.
5. Export PDF and DOCX if the laptop is set up for export.
6. Save everything under:

```text
applications/active/Company_Role/
```

## Where The Outputs Go

For each application, look in:

```text
applications/active/
```

Each company-role folder usually contains:

- Job description source.
- JD decode.
- Tailored resume `.md`.
- Resume `.pdf`.
- Resume `.docx`.

If PDF or DOCX is missing, ask the AI:

```text
Export the tailored resume for this application to PDF and DOCX.
```

## Important Rule For Tailored Resumes

The system is configured to include every experience from the master resume in the final tailored resume. Relevant roles should get more bullets. Less relevant or older roles should still appear, even if only as one compact line or one compact bullet.

This avoids accidentally dropping earlier experience that may still help the candidate's story.

## Starting Over For Another Person

To reuse the same copied project for a different person, clear the private files again:

1. Delete contents of `memory/`.
2. Delete contents of `source_files/`.
3. Delete contents of `applications/active/`.
4. Delete contents of `applications/archive/`.
5. Start again with:

```text
kickoff
```

Do not mix two people's resumes, trackers, or application folders in the same copy.

## Simple Prompt To Start A Session

Use this prompt after opening the folder:

```text
This is a clean interview-coach folder for a new candidate. Please read AGENTS.md and start with kickoff. Ask me one question at a time.
```

## Keeping The System Up To Date

The folder ships with a small auto-updater so that improvements to the system files (skill prompts, references, scripts, resume-factory code) can be pulled from the original GitHub repo without touching any of the new person's resume, applications, or coaching memory.

### What It Updates (System Files Only)

These files get refreshed from the canonical repo:

- `CLAUDE.md`, `AGENTS.md`, `README.md`, `VERSIONS.md`, `LICENSE`, `instruction-new.md`, `VERSION`
- `references/`, `releases/`, `archive/`, `scripts/`
- `resume-factory/` (except `themes/` and `templates/`, which keep local tweaks)
- `applications/README.md`, `memory/README.md` (structural templates only)

### What It Never Touches (User Files)

These always stay exactly as the candidate left them:

- `memory/coaching_state.md`, `memory/interview_tracker.md`
- `source_files/` (master resume, candidate background, archived docs)
- `applications/active/`, `applications/archive/` (all company/role folders)
- `plans/` (personal workflow plans)

### Automatic Check On Each Session

Every time a new Codex / Claude Code / Cursor session starts in this folder, the AI silently runs:

```bash
node scripts/update-system-candidate.mjs check
```

- If a new version is available, the AI will say so and ask whether to update.
- If the user answers yes, the AI runs `node scripts/update-system-candidate.mjs apply`.
- If the user answers no, the AI runs `node scripts/update-system-candidate.mjs dismiss` and stops asking until the user says "check for updates" again.
- If the folder is offline or already up to date, the AI stays quiet.

The user can force a check any time by saying "check for updates" or "update interview-coach".

### Manual Commands

Run these from the project root:

```bash
node scripts/update-system-candidate.mjs check      # See whether an update is available (JSON output)
node scripts/update-system-candidate.mjs apply      # Pull the latest system files
node scripts/update-system-candidate.mjs rollback   # Restore the most recent pre-update snapshot
node scripts/update-system-candidate.mjs dismiss    # Stop being prompted about this version
```

### How Rollback Works

Before changing any file, the updater copies the current version into `.update-backups/<timestamp>/`. If something looks wrong after an update, run `rollback` and the previous state will be restored from the most recent snapshot. User files were never in the backup (because they were never touched), so rollback cannot lose the candidate's work.

### If The User Deleted `.git/`

That's fine. The updater detects the missing `.git/` folder and falls back to a shallow clone of the repo into a temp directory, copies over the system files, then cleans up. No git setup is required on the target laptop.

## Safety Notes

- Do not upload someone else's resume or private application files to GitHub unless they explicitly agree.
- Do not reuse one person's `memory/` or `source_files/` for another person.
- Keep each candidate in a separate copy of the folder.
- If you are unsure whether the folder is clean, ask the AI:

```text
Check this folder for personal candidate data before I give it to someone else.
```
