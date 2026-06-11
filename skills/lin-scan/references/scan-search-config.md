# Lin scan search configuration

Use this reference when the user asks to add, broaden, or audit scan keywords/search terms such as "platform product", "AI product", or new target role families.

## Which files own what

- `engines/pathfinder/portals.yml`
  - Owned by the portal scan (`lin010scan` / §scan).
  - Add title keywords under `title_filter.positive` so discovered job titles survive deterministic filtering.
  - Add broad `search_queries` entries when the keyword should be actively searched across ATS/job-board pages.
  - This is the correct place for portal WebSearch/direct-company scan vocabulary.

- `career-profile/scan-channels.json`
  - Owned by browser/API channel scans (`lin011scanLinkedIn`, `lin012scanIndeed`, `lin013scanGmail`).
  - Add LinkedIn/Indeed search URLs under the matching channel's `searches` array.
  - Keep only enablement + search URLs/queries here. Do **not** add caps; caps live in `career-profile/pipeline-config.json`.

- `career-profile/pipeline-config.json`
  - Operational caps and thresholds only (`daily.scan_cap`, `daily.scan_linkedin_cap`, `promote_threshold`, etc.).
  - Do not put search vocabulary here.

## Pattern for adding a target phrase

Example: adding `Platform Product`.

1. Patch `engines/pathfinder/portals.yml`:
   - Add the phrase to `title_filter.positive`.
   - If the phrase needs active discovery, add a query under the most relevant section, e.g. `# -- Enterprise Platform PM queries --`.

2. Patch `career-profile/scan-channels.json` if LinkedIn/Indeed browser channels should also search it:
   - LinkedIn example URL: `https://www.linkedin.com/jobs/search/?keywords=platform%20product&location=Canada&f_WT=2`
   - Indeed example URL: `https://ca.indeed.com/jobs?q=platform+product&l=Remote`

3. Verify:
   - `python3 -m json.tool career-profile/scan-channels.json >/dev/null`
   - Re-read the edited snippets and confirm the entries landed in the expected sections.
   - If touching YAML syntax, run a lightweight parser if available, or at minimum verify indentation around the changed block.

## Reporting back

Be specific and concise. Tell the user:
- exact file(s) changed
- exact section(s) changed
- line numbers from the verification read, if available
- what was **not** changed (for example: caps/thresholds were not touched)
