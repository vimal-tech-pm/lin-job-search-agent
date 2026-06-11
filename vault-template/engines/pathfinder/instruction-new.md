<!-- ============================================================
  VENDORED INTO LIN — this doc describes career-ops as a standalone system.
  Lin uses it via /lin verbs; do NOT follow the install/update instructions
  below as written. The update mechanism is disabled (update-system.mjs is
  renamed to *.UPDATE-DISABLED). See ~/.hermes/profiles/lin/lin/PROVENANCE.md
  and ~/.hermes/profiles/lin/lin/engines/pathfinder/LIN-LOCAL-CHANGES.md.
============================================================ -->

# Quick Instructions For Using Career-Ops For Another Person

Yes, you can copy this whole `career-ops` folder to a pendrive, move it to another laptop, and open it there.

The important part is privacy: this folder may contain the current person's CV, profile, reports, generated PDFs, job tracker, and saved job descriptions. If you are setting it up for a new person, make a clean copy first and replace the personal files.

## What You Need On The New Laptop

Install these once:

1. VS Code: https://code.visualstudio.com/
2. Node.js LTS: https://nodejs.org/
3. Claude Code, Codex, or another AI coding assistant that can open this folder.

Optional:

1. Git: https://git-scm.com/
2. Go: https://go.dev/ if you want to use the dashboard.

The dashboard is optional. It gives you a terminal screen where you can browse applications, filter jobs, open reports, open job URLs, and change application statuses.

## Copy The Folder With A Pendrive

1. Plug the pendrive into the old laptop.
2. Copy the full `career-ops` folder to the pendrive.
3. Plug the pendrive into the new laptop.
4. Copy the `career-ops` folder from the pendrive to a normal folder, for example:
   - Windows: `Documents/career-ops`
   - Mac: `Documents/career-ops`
   - Linux: `~/career-ops`
5. Open the copied folder in VS Code.

Do not run the project directly from the pendrive. Copy it to the laptop first.

## First Setup On The New Laptop

Open the VS Code terminal inside the `career-ops` folder.

Run these commands:

```bash
npm install
npx playwright install chromium
npm run doctor
```

If the terminal says `npm` is not found, install Node.js LTS and restart VS Code.

## Updater And GitHub Sync

The updater is not called automatically by Node.js itself. It is called from project instructions and npm scripts.

Main places that call the updater:

| File | What It Does |
|---|---|
| `AGENTS.md` | Tells Codex/OpenCode-style agents to run `node update-system.mjs check` at the start of a session |
| `CLAUDE.md` | Tells Claude Code to run `node update-system.mjs check` at the start of a session |
| `package.json` | Defines `npm run update:check`, `npm run update`, and `npm run rollback` |
| `test-all.mjs` | Includes an updater check in the project test/doctor flow |
| Manual terminal commands | You can run `node update-system.mjs check`, `node update-system.mjs apply`, or `node update-system.mjs rollback` yourself |

There are two safe ways to use the the candidate GitHub updater on the new laptop.

Option 1: Replace the original updater name.

This is the simplest option. Keep the normal call sites unchanged, but replace the file they point to:

1. Keep `update-system-candidate.mjs`.
2. Delete or rename the old `update-system.mjs`.
3. Rename `update-system-candidate.mjs` to `update-system.mjs`.
4. Run:

```bash
node update-system.mjs check
```

This works because all existing instructions and npm scripts already call `update-system.mjs`.

Option 2: Keep both updater files and change the callers.

Use this if you do not want to delete or rename the original updater. On the new laptop, edit these references:

1. In `AGENTS.md`, replace updater commands like this:

```text
node update-system.mjs check
```

with:

```text
node update-system-candidate.mjs check
```

Also update the apply, dismiss, and rollback examples in the same file:

```text
node update-system-candidate.mjs apply
node update-system-candidate.mjs dismiss
node update-system-candidate.mjs rollback
```

2. In `CLAUDE.md`, make the same replacements.

3. In `package.json`, update the scripts:

```json
"update:check": "node update-system-candidate.mjs check",
"update": "node update-system-candidate.mjs apply",
"rollback": "node update-system-candidate.mjs rollback"
```

4. In `test-all.mjs`, update the updater check reference only if you want the full project test/doctor flow to use `update-system-candidate.mjs` too.

After that, run:

```bash
npm run update:check
```

or:

```bash
node update-system-candidate.mjs check
```

If both files exist and you do not change these callers, the system will keep using the original `update-system.mjs`.

## LinkedIn And Playwright Setup

Yes, the new person's LinkedIn will be different.

There are two separate things:

1. Playwright is the browser tool. It is installed on the laptop and can be reused.
2. LinkedIn login is personal. It must be set up again for each person.

Do not copy the previous person's LinkedIn login files to another person.

Private LinkedIn files:

```text
.env
.linkedin-session/
```

For a new person, delete those two from the copied folder if they exist.

Then create a fresh `.env` file:

```bash
cp .env.example .env
```

Open `.env` and replace the example values:

```text
LINKEDIN_EMAIL=new_person_email@example.com
LINKEDIN_PASSWORD=new_person_linkedin_password
```

Then run:

```bash
npm run linkedin-login
```

A browser window may open. If LinkedIn asks for SMS, email verification, CAPTCHA, or two-factor authentication, the new person must complete it in the browser. After they finish, press Enter in the terminal.

The login session is saved here:

```text
.linkedin-session/storageState.json
```

If LinkedIn keeps logging into the wrong account, delete `.linkedin-session/` and run this:

```bash
npm run linkedin-login -- --force
```

If the new person does not want to store their LinkedIn password in `.env`, skip LinkedIn automation. They can still use Career-Ops by pasting job URLs, job descriptions, and LinkedIn text manually.

Never share `.env` or `.linkedin-session/`. They are private because they can contain credentials or logged-in browser cookies.

## Optional: Use The Dashboard

Use this only if you installed Go.

The dashboard is a terminal app. It is not a website and it does not open in the browser.

First, open the VS Code terminal inside the `career-ops` folder.

Build the dashboard once:

```bash
cd dashboard
go build -o career-dashboard .
```

Run the dashboard on Mac or Linux:

```bash
./career-dashboard --path ..
```

Run the dashboard on Windows PowerShell:

```powershell
.\career-dashboard.exe --path ..
```

After the first build, you do not need to run `go build` every time. To open the dashboard later, open the terminal inside `career-ops/dashboard` and run the dashboard command again.

If you are currently in the main `career-ops` folder, use these commands:

Mac or Linux:

```bash
cd dashboard
./career-dashboard --path ..
```

Windows PowerShell:

```powershell
cd dashboard
.\career-dashboard.exe --path ..
```

How to use the dashboard:

| Key | What It Does |
|---|---|
| Up / Down | Move through applications |
| Left / Right | Switch tabs |
| `s` | Change sorting |
| `v` | Switch grouped/flat view |
| Enter | Open the selected report |
| `o` | Open the job URL |
| `c` | Change application status |
| Esc | Go back or quit |

If the dashboard says it cannot find `applications.md`, make sure `data/applications.md` exists. If this is a new person, create the tracker first or ask the AI assistant to set up the tracker.

## Make A Clean Copy For A New Person

Before adding the new person's details, remove or replace the previous person's private files.

Private files to replace:

```text
cv.md
config/profile.yml
modes/_profile.md
article-digest.md
portals.yml
data/applications.md
data/pipeline.md
data/scan-history.tsv
data/follow-ups.md
interview-prep/story-bank.md
reports/
output/
jds/
batch/tracker-additions/
.env
.linkedin-session/
```

Simple safe option:

1. Rename the copied folder to the new person's name, for example `career-ops-ravi`.
2. Delete old generated files from:
   - `reports/`
   - `output/`
   - `jds/`
   - `batch/tracker-additions/`
3. Replace `cv.md` with the new person's CV.
4. Replace `config/profile.yml` with the new person's name, email, location, target roles, and salary range.
5. Replace `modes/_profile.md` with the new person's preferences, strengths, deal-breakers, and career story.
6. Replace `portals.yml` with the new person's target companies and job-search keywords.

If you are not sure what to delete, ask the AI assistant:

```text
Set up this career-ops folder for a new person. Remove old personal data, keep the system files, and ask me for the new person's CV, profile, target roles, salary range, and job preferences.
```

## Files You Should Personalize

Use these files for the new person:

| File | What To Put There |
|---|---|
| `cv.md` | The person's full CV in markdown |
| `config/profile.yml` | Name, email, location, timezone, target roles, salary range |
| `modes/_profile.md` | Career story, strengths, role archetypes, deal-breakers, negotiation notes |
| `article-digest.md` | Proof points, portfolio projects, articles, case studies |
| `portals.yml` | Companies, job boards, search keywords |
| `data/applications.md` | Application tracker |

Do not put personal information into `modes/_shared.md`. That file is a system file and can be overwritten by updates.

## Start Using It

Open Claude Code, Codex, or your AI coding assistant in the `career-ops` folder.

Then ask:

```text
I want to set up career-ops for a new person. Here is their CV. Please create or update cv.md, config/profile.yml, modes/_profile.md, and portals.yml. Ask me for anything missing.
```

After setup, you can use it like this:

```text
Evaluate this job for me: [paste job URL]
```

```text
Generate a tailored CV/PDF for this role: [paste job URL or job description]
```

```text
Scan for new jobs that match this profile.
```

```text
Show my application tracker.
```

## Important Rules

1. Always review the CV before sending it to a company.
2. Do not let the AI submit applications automatically.
3. Do not apply to low-fit jobs unless there is a clear reason.
4. Keep one separate folder per person.
5. Do not mix two people's CVs, reports, or trackers in the same folder.
6. Do not share the folder until you remove private data.

## Quick Troubleshooting

If PDF generation fails:

```bash
npx playwright install chromium
```

If setup looks broken:

```bash
npm run doctor
npm run verify
```

If the tracker has duplicate or messy statuses:

```bash
npm run normalize
npm run dedup
npm run verify
```

If the system says an update is available:

```bash
npm run update:check
npm run update
```

Updates should not overwrite personal files like `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml`, `data/`, `reports/`, or `output/`.

## Best Practice

For each new person, use a separate folder:

```text
career-ops-alex
career-ops-ravi
career-ops-maria
```

This keeps each person's CV, job tracker, reports, and generated PDFs separate.
