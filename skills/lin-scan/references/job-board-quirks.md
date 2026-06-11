# Job Board Quirks

Known behaviors and workarounds for specific job board platforms.

## Greenhouse

- **Long pages truncate.** `web_extract` often cuts off Greenhouse JDs mid-content (they have many workstream sections). Fallback: `curl -sL <url> > /tmp/jd.html` then use Python with regex to extract sections.
- **Application may be external.** Some Greenhouse listings (especially fellowships, research programs) route to external forms (Constellation, Lever, etc.). Always scan the JD for "apply at" links. Anthropic Fellows uses bit.ly/afpsafety (Constellation) — the Greenhouse page is just the listing.
- **`&` in shell commands.** When scraping for terms containing `&` (e.g., "Economics & Policy"), avoid inline `curl | python3 -c "..."` — the shell interprets `&`. Instead: write to temp file first, then process with `execute_code` or a Python file.

## Airtable (Application Forms)

- **Forms are fully client-side rendered.** `web_extract`, `curl`, and plain HTTP fetch return nearly empty pages — all question text is rendered by JavaScript. No form data appears in the HTML source.
- **Region blocking.** Airtable may return a deactivation/maintenance message instead of form content for IPs outside supported regions. The `window.initData` blob will contain a GeoIP block notice, not form fields.
- **Extraction strategies (in order of reliability):**
  1. Ask the user to paste the form questions directly (fastest, most accurate).
  2. Use CDP browser to navigate and inspect the rendered DOM (requires Chrome with `--remote-debugging-port`).
  3. Search the web for blog posts, interview guides, or Reddit threads that reproduce the form questions (fragments only, may be outdated).
  4. Draft from `job.md` + known employer patterns (least reliable — forms change between cohorts).
- **Form fields change between cohorts.** Anthropic Fellows (Constellation/Airtable) updates questions each application cycle and sometimes per workstream. Never assume last cycle's questions are current.

- **URL rot — dead JD redirects to generic careers page.** When a Greenhouse JD URL returns the generic company careers page instead of the specific role, the posting was likely closed and reposted under a new job ID. The subdomain may also differ (`boards.greenhouse.io` vs `job-boards.greenhouse.io`). Recovery workflow: (1) Confirm the URL is dead via web_extract — returns generic company content, not role-specific JD. (2) Search for the live version with web_search: `{Company} "{Role Title}" greenhouse jobs`. (3) If found, verify the new URL returns the actual JD. (4) Update all references: job.yml.source_url, job.md, PACKAGE.md (apply link + checklist), data/pipeline.md, data/evaluation-queue.json (url + source_url fields). (5) Run tracker refresh. (6) Do not close the Lin-managed job folder — the role is still live, just at a different URL. Only close if confirmed gone with no repost.

## Workday / MyWorkdayJobs

- **web_extract usually fails.** Workday career and apply pages are client-side rendered; `web_extract` returns "Failed to fetch url" or empty content. Use `browser_navigate` to extract the JD.
- **URL structure.** Format: `https://{company}.wd1.myworkdayjobs.com/Ext/job/{Location}/Job-Title_{job-id}/apply` or `/Ext/user/{user-id}/_h~1_...`. The `/apply` path appends the form, which may have questions.
- **Apply detection.** Workday's "Apply" button is a `<button>` element only visible in rendered DOM. Use `browser_snapshot` after navigation to check for it. The text "Apply Now" or "Submit Application" in the snapshot confirms an active listing.

## Indeed (ViewJob pages)

- **Anti-bot blocking.** `web_extract` and `curl` fail with "Failed to fetch url". Indeed uses Cloudflare-level protection. Only a logged-in browser session can read viewjob pages.
- **LinkedIn/Indeed scanner strategy.** The `lin011scanLinkedIn` and `lin012scanIndeed` cron jobs remain paused. When enabled, they use the Hermes `browser_navigate` + `browser_snapshot` approach in a CDP-attached browser — no web_extract fallback path available.
- **Canada-specific URLs.** Use `https://ca.indeed.com/viewjob?jk=<id>` instead of `.com` for Canadian job listings.

## LinkedIn (/jobs/view/ pages)

- **Full blocks extraction.** `web_extract` on `linkedin.com/jobs/view/<id>` returns 404 or empty — LinkedIn blocks all non-browser HTTP fetches. Only a logged-in browser session with `www.linkedin.com` cookies can view JD pages.
- **web_search CAN find LinkedIn URLs.** Searching `site:linkedin.com/jobs/view <role> Canada` returns LinkedIn job page URLs via web_search, but you cannot extract the JD body. Useful for discovery + building a URL to open in the browser.
- **Stale JDs on LinkedIn.** LinkedIn may display a JD body text even after applications close (the "Easy Apply" button disappears first). For liveness, check for the Apply/Easy Apply button in the rendered snapshot, not just JD text presence. If only JD text is visible with no apply path, classify as `uncertain` not `active`.

## Ashby (jobs.ashbyhq.com)

- **web_extract works well.** Ashby career pages are server-rendered. `web_extract` returns full listings with department breakdown, role titles, and locations. Individual job pages also render well.
- **URL structure.** Company listing: `https://jobs.ashbyhq.com/{company}`. Individual job: `https://jobs.ashbyhq.com/{company}/{uuid}`.
- **No anti-bot.** Ashby does not block extraction. Use web_extract as the primary strategy.

## Wellfound (AngelList)

- **JDs are client-side rendered.** `web_extract` and `curl` fail — the page shell loads but job content is rendered by JavaScript. Use `browser_navigate` to fetch the JD. The browser snapshot captures the full role title, company, salary, location, and description.
- **URL cleanup.** User-provided URLs often include query params (`?ref=onboarding&job_listing_slug=...`). Strip to the canonical form: `https://wellfound.com/jobs/<slug>` (e.g., `https://wellfound.com/jobs/4320885-senior-technical-product-manager-ai-engineering-systems`).
- **Location extraction.** Wellfound surfaces remote-eligibility and visa sponsorship prominently in the snapshot (e.g., "Remote (Canada + US)", "Visa Sponsorship: Available"). These are first-class signals for `canada_eligible` decisions — capture them during JD extraction.
- **Company name** is in the page title (`... at CompanyName • Location | Wellfound`) and in the snapshot header. Extract before adding to pipeline.