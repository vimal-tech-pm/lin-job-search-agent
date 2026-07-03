# Core Resume (Generic) Workflow

A "core resume" or "master resume" is a resume not tailored to a specific employer — it targets a role archetype (e.g., Senior Product Manager) with the candidate's full story optimized for ATS and human readability.

## When to Use

- User asks for a "master resume," "core resume," or "generic resume"
- User wants a submit-ready resume before having a specific JD
- User wants both an ATS plain-text version and a polished PDF

## Steps

1. **Create the job folder** under `companies/generic/jobs/<role-slug>/`:
   ```
   companies/generic/jobs/senior-product-manager/
   ├── job.md          # Synthetic JD with required/nice-to-have/soft signals
   ├── job.yml          # status: decoding → materials_ready, discovered_via: intake-manual
   ├── status-history.md
   └── resumes/
   ```

2. **Write a synthetic JD** (`job.md`) — derive required skills and nice-to-haves from the candidate's `career-profile/profile.yml` target roles and `career-profile/experience.md`. Use the role archetype definition from `profile.yml` as the primary source. Include sections: Required, Nice-to-Have, Soft Signals, Salary (blank), Location, Team Context (blank), Risks (none).

3. **Write `job.yml`** with `company_slug: generic`, `title: "<Role Title>"`, `status: decoding`.

4. **Create `companies/generic/company.yml`** — scaffold with `co_slug: generic`, `display_name: "Generic (Core Resume)"`, empty careers/hq/notes.

5. **Run FORGE build**:
   ```bash
   cd ~/.hermes/profiles/lin/lin
   node engines/forge/resume-factory/scripts/build-resume.js \
     career-profile/resume.md executive-clean \
     companies/generic/jobs/<role-slug>/resumes/forge --pdf
   ```
   Expect 3 pages for a 14+ year, 7-role candidate. This is fine — FORGE is the editable draft.

6. **Run PATHFINDER build** — the skill requires generating an HTML file and converting it:
   - Generate HTML from the template (`engines/pathfinder/templates/cv-template.html`) following the instructions in `engines/pathfinder/modes/pdf.md`
   - Apply recency-tier bullet caps: Current (0-2y) ≤6, Recent (2-5y) ≤4, Prior (5-10y) ≤3, Early career (10+y) ≤2
   - **For long careers (7+ roles, 18+ years):** these caps may still produce 3 pages. Trim more aggressively (e.g., 3/2/2/1/1/1/1) and iterate. Always verify page count via `generate-pdf.mjs`.
   - Apply Self-Employed line-order exception: for any role with "Self-Employed" in the company line, put the role title in `job-company` (prominent) and "Self-Employed" in `job-role` (secondary).
   - Write HTML to `/tmp/cv-your-name-generic.html`
   - Run: `node engines/pathfinder/generate-pdf.mjs /tmp/cv-your-name-generic.html companies/generic/jobs/<role-slug>/resumes/pathfinder.pdf --format=letter`
   - Verify output says `Pages: 2`. If 3, trim bullets further and regenerate.

7. **Run ATS compare** — compare FORGE and PATHFINDER output for keyword coverage, structural score, and qualitative pass. Write to `resumes/ats-compare.md`.

8. **Set `job.yml.ats_winner`** — for generic core resumes, PATHFINDER typically wins (2-page, recruiter-scan-optimized). FORGE DOCX stays as the editable draft for JD-specific tailoring.

9. **Run `node scripts/lin-package.mjs <role-slug>`** — stages the recruiter-named symlink and refreshes PACKAGE.md + tracker.

10. **Copy deliverables** to the user's preferred output folder (`~/resumes/`):
    - `Your_Name_Resume_Generic_YYYYMMDD.pdf` (PATHFINDER winner, submit-ready)
    - `Your_Name_Master_Resume_FORGE.pdf` and `.docx` (editing draft)
    - `Your_Name_Master_Resume_PATHFINDER.pdf` (ATS-optimized)
    - `Your_Name_Master_Resume_ATS.txt` (plain-text fallback)
    - `Your_Name_Master_Resume_Narrative.md` (story-driven version for direct outreach)
    - `ATS_Compare_Generic_<Role>.md`

## Additional Output Versions

In addition to the two engine outputs, produce two hand-written versions:
- **ATS plain text** (`.txt`): No formatting, no tables, keyword-dense. Use for portal text-entry fields (Workday, Greenhouse).
- **Narrative markdown** (`.md`): Story-driven with impact table, grouped narrative bullets, tools/methods table. Use for direct outreach, networking, and hiring-manager conversations.

Both are saved directly to `~/resumes/`.

## Key Differences from JD-Specific Intake

- No PATHFINDER score (no real employer to evaluate)
- No cover letter needed
- No `--no-resume` flag needed (always build the resume)
- Synthesize the target role's keyword requirements from `profile.yml` archetypes rather than a real JD
- The "generic" company slug is reused for any future core resume rebuilds