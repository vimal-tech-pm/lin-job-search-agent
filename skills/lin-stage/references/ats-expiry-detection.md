# ATS-Specific Expired Job Detection Patterns

When checking liveness via `browser_navigate`, each ATS platform has distinct
expiry signals. Recognizing them saves reading full page content.

## Greenhouse (`job-boards.greenhouse.io/{co}/jobs/{id}`)

- **Expired:** URL redirects to `https://job-boards.greenhouse.io/{co}?error=true`
- Page title changes to `"Jobs at {Company}"` (board index) instead of
  `"Job Application for {Title} at {Company}"`
- **Quick check:** if `browser_navigate` returns a URL containing `?error=true`
  or the title starts with `"Jobs at"`, classify as `expired` immediately
- **Active:** URL stays at the specific job ID, title is
  `"Job Application for {Title} at {Company}"`, Apply button visible
- **Yield:** ~30% of 2+ week old Greenhouse URLs are expired (observed: Gusto,
  Rithum, Fixify, Toast, Liberate, Human Interest, Postscript, Varicent all
  expired in a single 2026-06-28 session)

## Ashby (`jobs.ashbyhq.com/{co}/{uuid}`)

- **Expired:** page shows `"Job not found"` heading with text
  `"The job you requested was not found."` — no redirect, just a 404-style page
- **Active:** full job posting with Overview/Application tabs, Apply button,
  compensation/department/location headings
- **Yield:** Ashby URLs are the most stable (~95% active), but when gone they're
  completely gone (no board index redirect)

## Workable (`apply.workable.com/{co}/j/{id}`)

- **Expired:** page shows `"This job is no longer available."` banner with a
  dismiss button, redirects to the company's Workable careers page
- URL may include `?not_found=true` parameter
- **Active:** full job posting with Description/Requirements/Benefits sections,
  Apply for this job button visible

## Wellfound / AngelList (`wellfound.com/jobs/{id}`)

- **Expired:** redirects to the company's careers page or Wellfound homepage
- **Active:** job posting with "Apply Now" button, company info, "Actively
  Hiring" badge, "Recruiter recently active" indicator

## Lever (`jobs.lever.co/{co}/{id}`)

- **Expired:** redirects to company's Lever board or shows a "position closed"
  message
- **Active:** job posting with "APPLY FOR THIS JOB" link visible, full JD
  rendered

## LinkedIn (`linkedin.com/jobs/view/...` or `ca.linkedin.com/jobs/view/...`)

- **Expired:** page shows `"No longer accepting applications"` text with an
  error icon — the posting is still visible but the apply path is closed
- **Active:** Apply / Easy Apply / "Apply on company website" link visible, no
  "No longer accepting applications" text. Look for "Reposted N days ago" and
  applicant count as freshness indicators
- **Authwall:** if LinkedIn shows a sign-in wall but the posting is recent with
  applicants, use the pragmatic classification (see gotcha in SKILL.md)

## Workday (`{co}.wd3.myworkdayjobs.com/...`)

- **Expired:** generic job board loads with "Loading" text but no specific job
  posting appears; or the job detail page shows the title but with a "posted N
  days ago" that's very old and no Apply button
- **Active:** job detail page loads with Apply button, location/time
  type/requisition ID visible
- **Note:** Workday URLs are often generic (company careers page, not a
  specific job ID) — these can't be liveness-checked and should be classified as
  `uncertain`

## Indeed (`ca.indeed.com/viewjob?jk={id}`)

- **Expired:** page shows `"This job has expired on Indeed"` banner with
  reasons text ("the employer is not accepting applications, is not actively
  hiring, or is reviewing applications")
- **Active:** full JD visible with Apply button

## Classification decision tree

```
browser_navigate(url)
├── URL contains ?error=true → EXPIRED (Greenhouse)
├── Title contains "Job not found" → EXPIRED (Ashby)
├── Page text contains "no longer available" → EXPIRED (Workable)
├── Page text contains "This job has expired" → EXPIRED (Indeed)
├── Page text contains "No longer accepting applications" → EXPIRED (LinkedIn)
├── Redirected to company careers page (not specific job) → EXPIRED (Wellfound/Lever)
├── Apply button / Easy Apply visible, no expired signal → ACTIVE
├── Sign-in wall (LinkedIn) + recent posting + applicants → ACTIVE (pragmatic)
└── Everything else → UNCERTAIN
```