# User-Provided Application Answer Drafts

## When the user supplies answer text directly

At any point during the pipeline (pre- or post-apply), the user may paste raw answer text for a job's application questions. Save it immediately to the canonical path.

## Workflow

1. **Find the job folder** — search `companies/<co>/jobs/*/` for the company. If it doesn't exist yet (pre-staging), the user is likely prepping answers before the pipeline has staged the role — save to memory instead, or ask.

2. **Save to canonical path** — per conventions §10:
   ```
   companies/{co}/jobs/{slug}/resumes/application-answers.md
   ```
   NOT the root of the job folder (`application-answers.md` at root is NOT the canonical location).

3. **Format** — use a top-level heading with company name and role title. Prefix each answer with the question text as an H3 subheading, then the user's verbatim response. Example:

   ```markdown
   # Company — Job Title

   ## Are you legally eligible to work in Canada?
   Yes

   ## List out at least two of our company values...
   [user's text]
   ```

   Preserve the user's exact wording — these are their draft answers, not agent-generated.

4. **Don't fabricate** — if the user provided a placeholder like "[insert GitHub handle]", preserve it verbatim. Do not fill in blanks.

## Common prompts from this session

- "save for X :" followed by raw answer text
- "save it in correct job folder for future reference"

## Pitfalls

- **Path matters** — `resumes/application-answers.md`, not `application-answers.md` at the job root. The `lin-finalize` package step and conventions §10 both expect the `resumes/` subfolder path.
- **No folder yet** — if the company/job folder doesn't exist (role hasn't been staged), say so and offer to save to memory instead.
- **User wrote to root** — if you accidentally saved to the root, move the file to `resumes/application-answers.md` when you next touch that folder.
- **Session transcript is the fallback** — the full text is always in the chat transcript. The file is for convenience when the user revisits the folder.
