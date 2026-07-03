# Browser-Based Company Research (Tavily Down Pattern)

When `web_search` / `web_extract` are returning 429s or are otherwise unavailable, use the browser tool (browser_navigate + browser_snapshot) to gather company research directly.

## Worked Example: Zynga (2026-06-19)

**Target:** Zynga, for a Senior Technical Product Manager, ML & Analytics interview prep.

### Step 1: Homepage → company snapshot
`browser_navigate("https://www.zynga.com/")`

Extract from the footer/description: parent company (Take-Two, NASDAQ: TTWO), scale stats (10B+ downloads, 175+ countries), game portfolio list. The homepage description paragraph is usually the richest single source.

### Step 2: Company story/our-story page
`browser_navigate("https://www.zynga.com/about/our-story/")`

**Known redirect:** `/about/` → cookies/privacy page. Use `/about/our-story/` instead.

Extract: founding year (2007), acquisition story (Take-Two, May 2022), key historical milestones (first virtual goods sales 2008, FarmVille peak 32M DAU, 700M installs, 183M+ MAU), data-driven culture (Cadir Lee pioneered big data/analytics for mass-market apps).

### Step 3: Careers page for culture signals
`browser_navigate("https://www.zynga.com/jobs/careers/")`

Extract: Connected Workplace model (hybrid/onsite/remote), ERG communities (Amigos, ZAPI, zPride, WAZ, zParents, etc.), D&I commitments, benefits summary.

### Step 4: Glassdoor — expect failure
Glassdoor uses Cloudflare bot detection (page title "Just a moment...", "Humans only"). The headless browser cannot get through even with stealth features. Do not attempt; note the blocker and move on.

### Step 5: Assemble findings
Either write to `companies/{co}/company-research.md` or embed directly in `interview-prep.md` under a "Company Context" section. Include:
- Company scale & ownership
- Key products/games
- Data culture signals
- Office/location context relevant to the role
- Known quirks or redirects for future research sessions

## Company Site Quirks Encountered
| Company | URL | Behavior |
|---------|-----|----------|
| Zynga | /about/ | Redirects to cookies page; use /about/our-story/ |
| Zynga | /jobs/careers/locations/ | Returns 404 |
| Skimmer | skimmer.com (not their domain) | SSL cert invalid — use getskimmer.com |
| Skimmer | getskimmer.com | Proper domain, renders well |
| Semperis | semperis.com | Renders well, rich product pages |
| Various | Glassdoor | Cloudflare block (headless) |
| Various | LinkedIn company pages | Renders basic info; deep extraction blocked without login |

## When to NOT use browser fallback
- The page is a plain-text or JSON endpoint (use curl instead — faster)
- You need to search across many companies (wait for Tavily recovery or use small batch)
- The company site is known to be a single-page app with heavy JS that doesn't render in snapshot
