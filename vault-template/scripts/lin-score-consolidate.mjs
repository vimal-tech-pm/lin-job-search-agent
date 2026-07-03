#!/usr/bin/env node
/**
 * lin-score-consolidate.mjs — Consolidates subagent evaluation results,
 * creates report/JD files, generates PDFs, upserts queue, updates pipeline.
 *
 * Usage: node scripts/lin-score-consolidate.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const VAULT = path.resolve(process.argv[2] || ".");
const REPORTS_DIR = path.join(VAULT, "reports");
const JDS_DIR = path.join(VAULT, "jds");
const PIPELINE_PATH = path.join(VAULT, "data", "pipeline.md");

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.mkdirSync(JDS_DIR, { recursive: true });

// Score ≥ 3.0 → PDF needed
// Score → Verdict mapping
function scoreToVerdict(score) {
  if (score >= 4.5) return "Strong apply";
  if (score >= 4.0) return "Investable";
  if (score >= 3.5) return "Investable Stretch";
  if (score >= 3.0) return "Long-Shot Stretch";
  return "SKIP";
}

// All 15 evaluation results compiled from subagents
const evaluations = [
  {
    id: "489",
    pipelineLine: 485,
    date: "2026-06-15",
    company: "Octasic Inc.",
    coSlug: "octasic-inc",
    role: "Product Manager – SIGINT Product Line",
    jobSlug: "product-manager-sigint-product-line",
    url: "https://ca.indeed.com/viewjob?jk=e0d37990648cb34e&from=appshareios",
    source: "manual",
    postedDate: null,
    score: 1.5,
    verdict: "SKIP",
    canadaEligible: "yes",
    canadaReason: "Job located in Montreal, QC (Canada hybrid)",
    location: "Montreal, QC (Hybrid)",
    geoGateReason: null,
    geoGateDetail: null,
    blocksStage: false,
    keywords: "SIGINT, defense, wireless, law enforcement, product management, market research, competitive analysis, government, security, Montreal",
    pdfNeeded: false,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Octasic Inc. — Product Manager – SIGINT Product Line

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 1.5/5
**Verdict:** SKIP
**Legitimacy:** High Confidence
**PDF:** No
**JD Snapshot:** jds/489-octasic-inc-2026-06-15.md
**Canada Eligible:** yes — Montreal, QC is in Canada

---

## A) Role Summary
- **Archetype:** Niche Defense/SIGINT PM
- **Domain:** Defense, law enforcement, national security
- **Function:** Product management for hardware/software SIGINT systems
- **Seniority:** Senior/Lead
- **Remote:** Hybrid (Montreal)
- **TL;DR:** Niche PM role requiring 5+ years in SIGINT/defense domain with NATO clearance eligibility.

## B) CV Match
Critical gaps: no SIGINT/defense experience, no wireless engineering PM background, no security clearance history, not bilingual French/English. Candidate's entire career is enterprise SaaS/fintech. Score: 1/5.

## C) Level and Strategy
Level is appropriate (Senior PM) but domain mismatch is fundamental — cannot be bridged by general PM skills.

## D) Comp and Demand
~$101K–$119K CAD estimated. Low for the level compared to SaaS. Niche market, low demand pool.

## E) Personalization Plan
Not applicable — domain gap is unbridgeable for this specific role.

## F) Interview Plan
Not recommended — do not apply.

## G) Posting Legitimacy
**High Confidence** — Real posting, active 4 days ago, specific requirements aligned with Octasic's business.

---

## Extracted Keywords
SIGINT, defense, wireless, law enforcement, market research, competitive analysis, government, security, Montreal, product roadmap
`,
    jdSnapshotContent: `# JD Snapshot: Octasic Inc. — Product Manager – SIGINT Product Line

**Source:** ca.indeed.com (aggregated from LinkedIn, TealHQ, BeBee, Rippling ATS)
**Date:** 2026-06-15

## Role
Product Manager – SIGINT Product Line at Octasic Inc.
Montreal, QC (Hybrid) — Full-time

## Responsibilities
1. Identify market needs and opportunities within defense, law enforcement, and intelligence sectors
2. Develop and maintain product roadmap aligned with company objectives
3. Conduct market research and competitive analysis on SIGINT/wireless trends
4. Collaborate with customers (defense/intelligence agencies) for feedback
5. Drive product development end-to-end from concept through commercialization

## Qualifications
- 5+ years experience in SIGINT/EW market segment
- Deep knowledge of wireless technology
- Ability to obtain NATO Secret clearance
- Bilingual (French/English)
- Bachelor's in Engineering or related field
- PMP or equivalent certification preferred
`,
  },
  {
    id: "490",
    pipelineLine: 486,
    date: "2026-06-15",
    company: "Runway",
    coSlug: "runway",
    role: "Sr/Staff Product Manager, Core Products",
    jobSlug: "sr-staff-product-manager-core-products",
    url: "https://jobs.ashbyhq.com/runway-ml/99630569-86d3-46c8-94fb-f9a797770b2b",
    source: "portal",
    postedDate: null,
    score: 2.0,
    verdict: "SKIP",
    canadaEligible: "no",
    canadaReason: "Remote-US only; prefers NYC/SF. No Canada option or sponsorship for this role.",
    location: "Remote (US) — prefers NYC or SF",
    geoGateReason: "remote-only",
    geoGateDetail: "Remote-US only — no Canada eligibility found. Toronto-based candidate cannot apply.",
    blocksStage: true,
    keywords: "Runway, AI, creative tools, collaboration, video generation, product management, machine learning, generative AI, creative workflows",
    pdfNeeded: false,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Runway — Sr/Staff Product Manager, Core Products

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 2.0/5
**Verdict:** SKIP
**Legitimacy:** High Confidence
**PDF:** No
**JD Snapshot:** jds/490-runway-2026-06-15.md
**Canada Eligible:** no — Remote-US only, no Canada option

---

## A) Role Summary
- **Archetype:** AI Platform / Agentic
- **Domain:** AI creative tools, video generation, world models
- **Function:** Collaboration product (teams sharing, reviewing, refining creative work)
- **Seniority:** Sr/Staff
- **Remote:** Remote (US) — prefers NYC/SF
- **TL;DR:** Own Runway's collaboration surfaces for creative teams at a high-growth AI startup.

## B) CV Match
Strong PM fundamentals (14+ yrs) but zero overlap in creative tools, media production, or collaboration products. Candidate's entire career is enterprise SaaS/fintech. Score: 2/5.

## C) Level and Strategy
Level mismatch — candidate is Senior but not Staff-level in creative domain. Massive industry gap.

## D) Comp and Demand
$230K–$280K USD. Strong comp but likely adjusted downward for Toronto.

## E) Personalization Plan
Not recommended — domain gap too wide.

## F) Interview Plan
N/A

## G) Posting Legitimacy
**High Confidence** — Real role, Runway is actively growing.

---

## Extracted Keywords
Runway, AI, creative tools, collaboration, video, world models, product management, machine learning, generative AI
`,
    jdSnapshotContent: `# JD Snapshot: Runway — Sr/Staff Product Manager, Core Products

**Source:** jobs.ashbyhq.com/runway-ml/99630569-86d3-46c8-94fb-f9a797770b2b
**Date:** 2026-06-15

## Role
Sr/Staff Product Manager, Core Products
Remote (US) — Full-time
$230K–$280K

## Responsibilities
- Own vision, strategy, roadmap for Runway's collaboration surfaces
- Work with design, engineering, research to accelerate creative workflows
- Talk to users constantly; develop intuitions about creative team needs
- Define success metrics, ship fast, iterate on real signal
- Cross-functional launch coordination

## Requirements
- 5–8+ years PM experience shipping high-quality features
- Deep interest in creative tools and AI
- Track record of shipping in ambiguity
`,
  },
  {
    id: "491",
    pipelineLine: 487,
    date: "2026-06-15",
    company: "Samsara",
    coSlug: "samsara",
    role: "Sr. Product Manager I, In-vehicle Experience - Remote US",
    jobSlug: "sr-product-manager-i-in-vehicle-experience-remote-us",
    url: "https://job-boards.greenhouse.io/samsara/jobs/7786156",
    source: "portal",
    postedDate: null,
    score: 1.5,
    verdict: "SKIP",
    canadaEligible: "no",
    canadaReason: "Explicitly 'Remote - US' / 'USA Only'. Samsara has Canada roles but not this PM one.",
    location: "Remote - US",
    geoGateReason: "remote-only",
    geoGateDetail: "Explicitly US-only. No Canada option for this specific PM role.",
    blocksStage: true,
    keywords: "Samsara, IoT, in-vehicle experience, telematics, AI cameras, product management, hardware-software, connected operations",
    pdfNeeded: false,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Samsara — Sr. Product Manager I, In-vehicle Experience - Remote US

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 1.5/5
**Verdict:** SKIP
**Legitimacy:** High Confidence
**PDF:** No
**JD Snapshot:** jds/491-samsara-2026-06-15.md
**Canada Eligible:** no — Explicitly US-only remote

---

## A) Role Summary
- **Archetype:** AI Platform
- **Domain:** IoT, connected operations, telematics
- **Function:** In-vehicle experience (AI-powered dash cameras)
- **Seniority:** Senior
- **Remote:** Remote - US
- **TL;DR:** Own Samsara's in-cab AI camera experience at the intersection of hardware, AI, and driver UX.

## B) CV Match
Candidate has zero experience in IoT, connected vehicles, hardware, telematics, or physical operations. Location is a hard blocker. Score: 1/5.

## C) Level and Strategy
Not applicable — domain and location both block.

## D) Comp and Demand
$116K–$195K USD + RSUs. Strong for IoT PM.

## E) Personalization Plan
N/A

## F) Interview Plan
N/A

## G) Posting Legitimacy
**High Confidence** — Real role, Samsara is growing.

---

## Extracted Keywords
Samsara, IoT, telematics, AI cameras, in-vehicle, connected operations, product management, hardware-software, fleet management
`,
    jdSnapshotContent: `# JD Snapshot: Samsara — Sr. Product Manager I, In-vehicle Experience

**Source:** job-boards.greenhouse.io/samsara/jobs/7786156
**Date:** 2026-06-15

## Role
Sr. Product Manager I, In-vehicle Experience (Remote - US)
$116,322 – $195,500 USD + RSUs

## Requirements
- 5+ years PM experience shipping products at scale
- Shipped AI-powered or ML-driven features
- Strong customer research skills
- Platform thinking
- Hardware/embedded experience preferred
- In-vehicle domain experience preferred
`,
  },
  {
    id: "492",
    pipelineLine: 488,
    date: "2026-06-15",
    company: "Grafana Labs",
    coSlug: "grafana-labs",
    role: "Senior Product Manager, Performance Testing / US Remote",
    jobSlug: "senior-product-manager-performance-testing-us-remote",
    url: "https://job-boards.greenhouse.io/grafanalabs/jobs/6001524004",
    source: "portal",
    postedDate: null,
    score: 2.0,
    verdict: "SKIP",
    canadaEligible: "no",
    canadaReason: "US EST only. Canada version exists at job ID 6001525004 (eval #426, 3.2/5).",
    location: "Remote, US EST only",
    geoGateReason: "remote-only",
    geoGateDetail: "US-only version; refer to Canada listing job ID 6001525004 (eval #426, score 3.2/5)",
    blocksStage: true,
    keywords: "Grafana Labs, k6, performance testing, observability, devtools, product management, US remote",
    pdfNeeded: false,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Grafana Labs — Senior Product Manager, Performance Testing / US Remote

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 2.0/5 (US version only)
**Verdict:** SKIP
**Legitimacy:** High Confidence
**PDF:** No
**JD Snapshot:** jds/492-grafana-labs-2026-06-15.md
**Canada Eligible:** no — US EST only. Canada version at job ID 6001525004 (eval #426, 3.2/5)

---

## A) Role Summary
- **Archetype:** AI Platform
- **Domain:** Observability, performance testing (k6)
- **Function:** Product management for devtools
- **Seniority:** Senior
- **Remote:** US EST only
- **TL;DR:** Own the k6 performance testing product at Grafana Labs.

## B) CV Match
This is the US-only listing. Canada version exists (job ID 6001525004, previously eval'd at 3.2/5). Redirect to Canada version.

## G) Posting Legitimacy
**High Confidence** — real role, transparent about US-only restriction.

---

## Extracted Keywords
Grafana Labs, k6, performance testing, observability, devtools, testing, product management, US remote
`,
    jdSnapshotContent: `# JD Snapshot: Grafana Labs — Senior Product Manager, Performance Testing

**Source:** job-boards.greenhouse.io/grafanalabs/jobs/6001524004
**Date:** 2026-06-15

## Role
Senior Product Manager, Performance Testing | US | Remote
$162,275 – $194,730 USD

Canada equivalent: job ID 6001525004 ($164,490 – $197,389 CAD)
`,
  },
  {
    id: "493",
    pipelineLine: 489,
    date: "2026-06-15",
    company: "Stack Influence",
    coSlug: "stack-influence",
    role: "Senior Technical Product Manager (Remote, 4-day week)",
    jobSlug: "senior-technical-product-manager",
    url: "https://www.linkedin.com/jobs/view/senior-technical-product-manager-remote-4-day-week-at-stack-influence-4321320715",
    source: "portal",
    postedDate: null,
    score: 4.0,
    verdict: "Investable",
    canadaEligible: "yes",
    canadaReason: "Remote role with no geo exclusion. Miami HQ but positions open globally.",
    location: "Remote (Miami HQ)",
    geoGateReason: null,
    geoGateDetail: null,
    blocksStage: false,
    keywords: "Stack Influence, technical product management, influencer marketing, SaaS, micro-influencer, ecommerce, 4-day week, remote",
    pdfNeeded: true,
    archetype: "Technical AI PM",
    legitimacy: "Proceed with Caution",
    reportContent: `# Evaluation: Stack Influence — Senior Technical Product Manager (Remote, 4-day week)

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 4.0/5
**Verdict:** Investable
**Legitimacy:** Proceed with Caution
**PDF:** Pending
**JD Snapshot:** jds/493-stack-influence-2026-06-15.md
**Canada Eligible:** yes — Remote, no geo exclusion

---

## A) Role Summary
- **Archetype:** FDE / Technical PM
- **Domain:** Influencer marketing SaaS, eCommerce
- **Function:** Technical product management reporting to CTO
- **Seniority:** Senior
- **Remote:** Full remote (4-day week)
- **TL;DR:** Senior TPM for micro-influencer SaaS platform, remote-first with 4-day work week.

## B) CV Match
Strong match: 14+ yrs PM (exceeds 5yr req), 2+ yrs SWE-adjacent (test automation + current AI builder), strong API/SQL/data skills. Gap: no startup experience (mitigated by self-employed AI building). Score: 4/5.

## C) Level and Strategy
Appropriate level. Lean on technical PM skills and AI product building as differentiators.

## D) Comp and Demand
$150K–$225K USD (~$195K–$293K CAD) + equity. Excellent comp, well above Toronto Sr PM market. 4-day week is a strong differentiator.

## E) Personalization Plan
1. Emphasize technical PM experience (APIs, SQL, data analytics)
2. Highlight AI product building as startup-style autonomy
3. Emphasize software engineering background (test automation at Infosys)
4. Add stack influence-specific keywords to CV

## F) Interview Plan
1. STAR: Confirmation Reimagined AI initiative at Thomson Reuters
2. STAR: NextGen platform launch (+125K users, NPS 26→70)
3. STAR: 60% faster time-to-market for 200+ bank forms
4. STAR: AI Product Builder side business (end-to-end shipping)

## G) Posting Legitimacy
**Proceed with Caution:** 4 months old, 200+ applicants, but SWE/Data Science req narrows pool. Seed-stage ($1.3M) risk but validated product-market fit.

---

## Extracted Keywords
Stack Influence, technical product management, influencer marketing, SaaS, micro-influencer, ecommerce, 4-day week, remote, API, SQL, data analytics
`,
    jdSnapshotContent: `# JD Snapshot: Stack Influence — Senior Technical Product Manager

**Source:** linkedin.com + stack-influence.breezy.hr
**Date:** 2026-06-15

## Role
Senior Technical Product Manager (Remote, 4-day week)
$150K–$225K USD + equity
Reports to CTO

## Requirements
- 5+ years product management experience
- 2+ years software engineering or data science experience
- Strong API, SQL, and data analytics skills
- Startup experience preferred
- Remote-first culture, 4-day work week
`,
  },
  {
    id: "494",
    pipelineLine: 490,
    date: "2026-06-15",
    company: "Gen II Fund Services",
    coSlug: "gen-ii-fund-services",
    role: "Sr. Technical Product Manager (Canada)",
    jobSlug: "sr-technical-product-manager",
    url: "https://ca.linkedin.com/jobs/view/sr-technical-product-manager-at-gen-ii-fund-services-4423218970",
    source: "portal",
    postedDate: null,
    score: 4.5,
    verdict: "Strong apply",
    canadaEligible: "yes",
    canadaReason: "100% remote from Ontario, BC, or Alberta. Canada-based role.",
    location: "Remote — Ontario, BC, or Alberta, Canada",
    geoGateReason: null,
    geoGateDetail: null,
    blocksStage: false,
    keywords: "Gen II Fund Services, technical product management, fund administration, B2B SaaS, portal, financial services, remote Canada",
    pdfNeeded: true,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Gen II Fund Services — Sr. Technical Product Manager (Canada)

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 4.5/5
**Verdict:** Strong apply
**Legitimacy:** High Confidence
**PDF:** Pending
**JD Snapshot:** jds/494-gen-ii-fund-services-2026-06-15.md
**Canada Eligible:** yes — 100% remote from Ontario

---

## A) Role Summary
- **Archetype:** Technical AI PM
- **Domain:** Fintech, private capital fund administration (B2B SaaS)
- **Function:** Sensr Portal product management, Digital Solutions division
- **Seniority:** Senior
- **Remote:** 100% remote — Ontario, BC, or Alberta
- **TL;DR:** Lead product for the Sensr investor portal at a $1T+ AUM fund administrator.

## B) CV Match
Excellent match: 14+ yrs PM experience, B2B SaaS background, strong financial services domain (Cognizant lending, Thomson Reuters), AI product building as differentiator. Only gap is no direct fund administration experience but financial services experience is adjacent and transferable. Score: 4.5/5.

## C) Level and Strategy
Natural fit — same seniority, similar platform-building mandate. Lean on financial services domain expertise and AI product building differentiator.

## D) Comp and Demand
$140K–$160K CAD + bonus/benefits. Competitive for Toronto remote role.

## E) Personalization Plan
1. Emphasize platform delivery and agile leadership at scale
2. Frame financial services experience as directly adjacent to private capital
3. Highlight AI product-building as a differentiator

## F) Interview Plan
1. STAR: NextGen platform launch (125K+ users)
2. STAR: Bank forms automation (60% faster, $420K savings)
3. STAR: Cross-functional leadership (7+ scrum teams)

## G) Posting Legitimacy
**High Confidence** — Fresh posting (1 week old), full salary transparency, specific responsibilities.

---

## Extracted Keywords
Gen II Fund Services, technical product management, fund administration, B2B SaaS, Sensr portal, financial services, investor portal, remote Canada
`,
    jdSnapshotContent: `# JD Snapshot: Gen II Fund Services — Sr. Technical Product Manager

**Source:** ca.linkedin.com
**Date:** 2026-06-15

## Role
Sr. Technical Product Manager (Sensr Portal)
Remote — Ontario, BC, or Alberta, Canada
$140K–$160K CAD + bonus + benefits

## Requirements
- 6+ years end-to-end technical PM experience
- B2B SaaS platform delivery
- Strong requirements documentation
- Agile/SDLC expertise
- Excellent communication
- Preferred: CS/Engineering degree, fintech/financial services
`,
  },
  {
    id: "495",
    pipelineLine: 491,
    date: "2026-06-15",
    company: "MaintainX",
    coSlug: "maintainx",
    role: "Senior Technical Product Manager, Search",
    jobSlug: "senior-technical-product-manager-search",
    url: "https://ca.linkedin.com/jobs/view/senior-technical-product-manager-search-at-maintainx-4377041440",
    source: "portal",
    postedDate: null,
    score: 3.5,
    verdict: "Investable Stretch",
    canadaEligible: "yes",
    canadaReason: "Greater Toronto Area, Canada — matches candidate's Toronto location.",
    location: "Greater Toronto Area, Canada (Remote-friendly/Hybrid)",
    geoGateReason: null,
    geoGateDetail: null,
    blocksStage: false,
    keywords: "MaintainX, search, technical product management, maintenance, asset management, AI, platform, GTA, Canada",
    pdfNeeded: true,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: MaintainX — Senior Technical Product Manager, Search

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 3.5/5
**Verdict:** Investable Stretch
**Legitimacy:** High Confidence
**PDF:** Pending
**JD Snapshot:** jds/495-maintainx-2026-06-15.md
**Canada Eligible:** yes — GTA, Ontario

---

## A) Role Summary
- **Archetype:** Technical AI PM
- **Domain:** Maintenance/asset management (AI-powered)
- **Function:** Search platform product owner (Product Foundations Group)
- **Seniority:** Senior
- **Remote:** Remote-friendly/Hybrid (GTA)
- **TL;DR:** Own search platform at MaintainX — ingestion, indexing, relevance, query semantics.

## B) CV Match
Strong PM fundamentals, platform ownership experience, AI fluency. Critical gap: no demonstrated search platform experience (Elasticsearch, Algolia, Solr, information retrieval). This is a requirement, not a nice-to-have. Score: 3.5/5.

## C) Level and Strategy
Level appropriate (Senior PM). However search domain deep-dive required before applying.

## D) Comp and Demand
Competitive for GTA. Series D company ($254M total funding), Forbes Cloud 100.

## E) Personalization Plan
1. Study search platform fundamentals (ingestion, indexing, relevance)
2. Emphasize platform product management experience
3. Frame AI Agent side projects as search-relevant (RAG, embeddings)

## F) Interview Plan
1. STAR: Platform ownership at Thomson Reuters (125K+ users)
2. Search scenario: How candidate would approach building search for blue-collar workers
3. AI-powered search: Embedding-based and hybrid search approaches

## G) Posting Legitimacy
**High Confidence** — Posted June 10 (fresh), specific responsibilities, well-funded company.

---

## Extracted Keywords
MaintainX, search, technical product management, maintenance, asset management, AI, platform, GTA, ingestion, indexing, relevance
`,
    jdSnapshotContent: `# JD Snapshot: MaintainX — Senior Technical Product Manager, Search

**Source:** ca.linkedin.com
**Date:** 2026-06-15

## Role
Senior Technical Product Manager, Search
Greater Toronto Area, Canada (Remote-friendly/Hybrid)
Product Foundations Group

## Responsibilities
- Define vision for search platform powering all search experiences
- Own core search: ingestion, indexing, relevance, query semantics
- Lead end-to-end search workflows connected to customer needs

## Requirements
- 6+ years PM experience
- Direct search experience required
- AI-powered search experience strongly preferred
`,
  },
  {
    id: "496",
    pipelineLine: 492,
    date: "2026-06-15",
    company: "Global Relay",
    coSlug: "global-relay",
    role: "Senior Technical Product Manager - Archive (Core Storage)",
    jobSlug: "senior-technical-product-manager-archive",
    url: "https://ca.linkedin.com/jobs/view/senior-technical-product-manager-archive-core-storage-at-global-relay-4389272396",
    source: "portal",
    postedDate: null,
    score: 3.8,
    verdict: "Investable Stretch",
    canadaEligible: "yes",
    canadaReason: "Vancouver, BC — Canadian role. Candidate is Toronto-based (relocation may be needed if hybrid).",
    location: "Vancouver, BC",
    geoGateReason: null,
    geoGateDetail: "Vancouver, BC. Candidate in Toronto — unclear if remote is available. Role may require hybrid.",
    blocksStage: false,
    keywords: "Global Relay, technical product management, archive, core storage, compliance, messaging, B2B SaaS, cloud archiving, Vancouver",
    pdfNeeded: true,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Global Relay — Senior Technical Product Manager - Archive (Core Storage)

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 3.8/5
**Verdict:** Investable Stretch
**Legitimacy:** High Confidence
**PDF:** Pending
**JD Snapshot:** jds/496-global-relay-2026-06-15.md
**Canada Eligible:** yes — Vancouver, BC, Canada

---

## A) Role Summary
- **Archetype:** Technical AI PM
- **Domain:** Compliance cloud archiving, messaging, enterprise SaaS
- **Function:** Archive (Core Storage) — infrastructure-level product management
- **Seniority:** Mid-Senior (reports to Group PM)
- **Remote:** Vancouver, BC (hybrid unclear)
- **TL;DR:** Build and maintain core storage services for compliance archiving at Global Relay.

## B) CV Match
Strong PM credentials, agile delivery, enterprise SaaS, financial services domain. Gap: no storage infrastructure experience (this is core to the role). Location (Toronto vs Vancouver) may be an issue if hybrid required. Score: 3.8/5.

## C) Level and Strategy
Level is appropriate. Storage infrastructure gap is the main risk.

## D) Comp and Demand
$130K–$150K CAD. Reasonable for Vancouver mid-senior role.

## E) Personalization Plan
1. Emphasize platform building and enterprise experience
2. Study storage infrastructure fundamentals before applying
3. Confirm remote policy for Toronto

## G) Posting Legitimacy
**High Confidence** — Active posting, specific responsibilities, established company (23K customers).

---

## Extracted Keywords
Global Relay, technical product management, archive, core storage, compliance, messaging, B2B SaaS, cloud archiving, Vancouver
`,
    jdSnapshotContent: `# JD Snapshot: Global Relay — Senior Technical Product Manager - Archive (Core Storage)

**Source:** ca.linkedin.com
**Date:** 2026-06-15

## Role
Senior Technical Product Manager - Archive (Core Storage)
Vancouver, BC
$130K–$150K CAD

## Requirements
- 6+ years as Sr. TPM or PO
- Agile & Scrum expertise
- Requirements management (epics, user stories)
- Enterprise SaaS experience
- File & object storage knowledge (preferred)
- Financial services domain (preferred)
`,
  },
  {
    id: "497",
    pipelineLine: 493,
    date: "2026-06-15",
    company: "Scotiabank",
    coSlug: "scotiabank",
    role: "Senior Product Manager, CNAPP Product",
    jobSlug: "senior-product-manager-cnapp-product",
    url: "https://ca.linkedin.com/jobs/view/senior-product-manager-cnapp-product-at-scotiabank-4319165768",
    source: "portal",
    postedDate: null,
    score: 3.0,
    verdict: "Long-Shot Stretch",
    canadaEligible: "yes",
    canadaReason: "Scotiabank — Canadian bank, Toronto-based. Full work authorization.",
    location: "Toronto, ON, Canada",
    geoGateReason: null,
    geoGateDetail: null,
    blocksStage: false,
    keywords: "Scotiabank, product management, CNAPP, cloud security, cybersecurity, Azure, GCP, Toronto, banking",
    pdfNeeded: true,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Scotiabank — Senior Product Manager, CNAPP Product

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 3.0/5
**Verdict:** Long-Shot Stretch
**Legitimacy:** High Confidence
**PDF:** Pending
**JD Snapshot:** jds/497-scotiabank-2026-06-15.md
**Canada Eligible:** yes — Scotiabank is a Canadian bank, Toronto-based

---

## A) Role Summary
- **Archetype:** Technical AI PM
- **Domain:** Cloud security (CNAPP — Cloud Native Application Protection Platform)
- **Function:** Product management for enterprise security product
- **Seniority:** Senior
- **Remote:** Toronto, ON (likely hybrid)
- **TL;DR:** Product manage CNAPP cloud security products within Scotiabank's cybersecurity portfolio.

## B) CV Match
Strong financial services and senior PM experience, but zero cybersecurity/CNAPP domain experience. Requires 5+ years cloud security experience and Azure/GCP expertise. Gap is significant. Score: 3/5.

## C) Level and Strategy
Level appropriate but domain gap is significant. Consider if a referral or cloud security certification could bridge it.

## D) Comp and Demand
Competitive Canadian bank salary. Strong benefits.

## E) Personalization Plan
Only pursue with strong referral and/or after cloud security certification.

## G) Posting Legitimacy
**High Confidence** — Scotiabank active hiring, real role.

---

## Extracted Keywords
Scotiabank, product management, CNAPP, cloud security, cybersecurity, Azure, GCP, CSPM, CWPP, Toronto
`,
    jdSnapshotContent: `# JD Snapshot: Scotiabank — Senior Product Manager, CNAPP Product

**Source:** ca.linkedin.com + Scotiabank careers portal
**Date:** 2026-06-15

## Role
Senior Product Manager, CNAPP Product (Requisition ID: 264538)
Toronto, ON, Canada

## Requirements
- 7+ years product management experience
- 5+ years cloud security/cybersecurity experience
- Azure/GCP expertise
- CNAPP domain knowledge (CSPM, CWPP, CIEM, IaC Security)
- Strong financial services background preferred
`,
  },
  {
    id: "498",
    pipelineLine: 494,
    date: "2026-06-15",
    company: "Kraken",
    coSlug: "kraken",
    role: "Senior Product Manager - Platform",
    jobSlug: "senior-product-manager-platform",
    url: "https://ca.linkedin.com/jobs/view/senior-product-manager-platform-at-kraken-4386232275",
    source: "portal",
    postedDate: null,
    score: 3.8,
    verdict: "Investable Stretch",
    canadaEligible: "yes",
    canadaReason: "Kraken hires remotely from 70+ countries including Canada. Fully remote.",
    location: "Remote — 70+ countries (Canada included)",
    geoGateReason: null,
    geoGateDetail: null,
    blocksStage: false,
    keywords: "Kraken, product management, platform, crypto, blockchain, onboarding, identity verification, remote, fintech",
    pdfNeeded: true,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Kraken — Senior Product Manager - Platform

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 3.8/5
**Verdict:** Investable Stretch
**Legitimacy:** High Confidence
**PDF:** Pending
**JD Snapshot:** jds/498-kraken-2026-06-15.md
**Canada Eligible:** yes — Remote from 70+ countries including Canada

---

## A) Role Summary
- **Archetype:** Technical AI PM
- **Domain:** Crypto/blockchain exchange platform
- **Function:** Platform product (onboarding, identity verification, Growth team)
- **Seniority:** Senior
- **Remote:** Fully remote — 70+ countries
- **TL;DR:** Own onboarding and identity verification platform across Consumer, Business, and Institutional segments.

## B) CV Match
Strong platform modernization experience (NextGen, $420K savings, NPS 26→70), large-scale migration leadership, registration UX redesign (50% fewer abandonments directly maps to onboarding focus), regulated industry background. Critical gap: no crypto/blockchain experience. Score: 3.8/5.

## C) Level and Strategy
Level appropriate. Crypto domain is bridgeable if candidate prepares deliberately.

## D) Comp and Demand
$110K–$221K USD + equity + bonus. Attractive comp for a remote role.

## E) Personalization Plan
1. Emphasize platform modernization and migration experience
2. Highlight registration UX redesign (maps to onboarding focus)
3. Study crypto/blockchain fundamentals
4. Prepare genuine crypto conviction narrative

## G) Posting Legitimacy
**High Confidence** — Active posting, specific details across multiple sources.

---

## Extracted Keywords
Kraken, product management, platform, crypto, blockchain, onboarding, identity verification, remote, fintech, growth
`,
    jdSnapshotContent: `# JD Snapshot: Kraken — Senior Product Manager - Platform

**Source:** aggregated from BuiltIn, LinkedIn, ElectricCapital, Kraken Careers, AshbyHQ
**Date:** 2026-06-15

## Role
Senior Product Manager - Platform (Growth team)
Remote — 70+ countries
$110K–$221K USD + equity + bonus

## Responsibilities
- Own onboarding and identity verification platform strategy
- Serve Consumer, Business, and Institutional segments
- Drive platform growth and conversion metrics

## Requirements
- 5+ years PM experience
- Platform product experience
- Crypto/blockchain knowledge preferred
- Growth/experimentation mindset
`,
  },
  {
    id: "499",
    pipelineLine: 495,
    date: "2026-06-15",
    company: "Jerry.ai",
    coSlug: "jerry-ai",
    role: "Product Manager, Growth",
    jobSlug: "product-manager-growth",
    url: "https://wellfound.com/jobs/4320861-product-manager-growth",
    source: "portal",
    postedDate: null,
    score: 2.5,
    verdict: "SKIP",
    canadaEligible: "no",
    canadaReason: "Onsite in New York, NY or Palo Alto, CA only. No Canada/remote option for this role.",
    location: "New York, NY or Palo Alto, CA (onsite)",
    geoGateReason: "onsite-only",
    geoGateDetail: "Onsite NYC/PA only. No remote option. Jerry.ai has other Toronto roles (Product Associate, Tech Lead) but not this PM role.",
    blocksStage: true,
    keywords: "Jerry.ai, product management, growth, fintech, insurtech, A/B testing, funnel optimization, New York, Palo Alto",
    pdfNeeded: false,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Jerry.ai — Product Manager, Growth

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 2.5/5
**Verdict:** SKIP
**Legitimacy:** High Confidence
**PDF:** No
**JD Snapshot:** jds/499-jerry-ai-2026-06-15.md
**Canada Eligible:** no — Onsite NYC/PA only, no remote or Canada option

---

## A) Role Summary
- **Archetype:** FDE / Growth PM
- **Domain:** Fintech/insurtech, auto insurance comparison
- **Function:** Growth product management
- **Seniority:** Mid-Senior
- **Remote:** Onsite — New York, NY or Palo Alto, CA
- **TL;DR:** Growth PM at Jerry.ai, driving funnel optimization and A/B testing for auto insurance marketplace.

## B) CV Match
Role fit is strong (growth PM with A/B testing, funnel optimization, analytics). Location is a hard blocker — onsite NYC/PA only. Score: 2.5/5 (reduced for location).

## G) Posting Legitimacy
**High Confidence** — Active role on Wellfound.

---

## Extracted Keywords
Jerry.ai, product management, growth, fintech, insurtech, A/B testing, funnel, New York, Palo Alto
`,
    jdSnapshotContent: `# JD Snapshot: Jerry.ai — Product Manager, Growth

**Source:** wellfound.com + jerry.ai/job-openings
**Date:** 2026-06-15

## Role
Product Manager, Growth
New York, NY or Palo Alto, CA (Onsite)

## About Jerry.ai
AI-powered car insurance comparison platform. Well-funded startup.

## Requirements
- 4+ years product management experience
- Growth/product-led growth experience
- A/B testing and experimentation
- Data-driven decision making
`,
  },
  {
    id: "500",
    pipelineLine: 496,
    date: "2026-06-15",
    company: "Temporal Technologies",
    coSlug: "temporal-technologies",
    role: "Senior Product Manager, Scalability & Compute",
    jobSlug: "senior-product-manager-scalability-and-compute",
    url: "https://job-boards.greenhouse.io/temporal/jobs/5039299007",
    source: "portal",
    postedDate: "2026-06-03",
    score: 2.0,
    verdict: "SKIP",
    canadaEligible: "unknown",
    canadaReason: "URL listed as 'Vercel' but actually points to Temporal's Greenhouse. Role is US-remote; Canada eligibility unclear.",
    location: "United States – Remote Opportunity",
    geoGateReason: "remote-only",
    geoGateDetail: "URL misattributed to Vercel; actually a Temporal role (temporaltechnologies). Greenhouse lists as US remote. Canada eligibility not confirmed.",
    blocksStage: true,
    keywords: "Temporal, product management, scalability, compute, workflow orchestration, Kubernetes, serverless, developer tools",
    pdfNeeded: false,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Temporal Technologies — Senior Product Manager, Scalability & Compute

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 2.0/5
**Verdict:** SKIP
**Legitimacy:** High Confidence
**PDF:** No
**JD Snapshot:** jds/500-temporal-technologies-2026-06-15.md
**Canada Eligible:** unknown — URL misattributed as Vercel; actually Temporal. US remote; Canada unclear.

---

## A) Role Summary
- **Archetype:** Technical AI PM
- **Domain:** Workflow orchestration, durable execution, developer infrastructure
- **Function:** Compute runtime product (Kubernetes → serverless)
- **Seniority:** Senior
- **Remote:** US Remote Opportunity
- **TL;DR:** Own worker scalability and compute runtime at Temporal — how developers deploy, host, and scale Temporal workers.

## B) CV Match
Candidate has no experience in distributed systems infrastructure, workflow orchestration, Kubernetes, or serverless compute. No developer-tooling PM experience. Score: 2/5.

## C) NOTE: Pipeline discrepancy
The pipeline row says "Vercel" but the URL points to Temporal's Greenhouse. This is a pipeline error — the role is at Temporal Technologies, not Vercel.

## G) Posting Legitimacy
**High Confidence** — Real Temporal role, correct subdomain.

---

## Extracted Keywords
Temporal, product management, scalability, compute, workflow orchestration, Kubernetes, serverless, developer tools
`,
    jdSnapshotContent: `# JD Snapshot: Temporal Technologies — Senior Product Manager, Scalability & Compute

**Source:** job-boards.greenhouse.io/temporaltechnologies/jobs/5039299007
**Date:** 2026-06-15

## Role
Senior Product Manager, Scalability & Compute
United States – Remote Opportunity
Posted: 2026-06-03

## About
Own how developers deploy, host, and scale Temporal workers. Shape the compute runtime story from self-managed Kubernetes deployments to fully serverless execution.

NOTE: Pipeline row listed company as "Vercel" but URL goes to Temporal's Greenhouse. This is a pipeline data error.
`,
  },
  {
    id: "501",
    pipelineLine: 497,
    date: "2026-06-15",
    company: "Temporal",
    coSlug: "temporal",
    role: "Staff Product Manager, Agent Platform",
    jobSlug: "staff-product-manager-agent-platform",
    url: "https://job-boards.greenhouse.io/temporal/jobs/5124710007",
    source: "portal",
    postedDate: "2026-06-03",
    score: 3.75,
    verdict: "Investable Stretch",
    canadaEligible: "unknown",
    canadaReason: "Listed as SF, CA but app form includes Canada as selectable work country. Clarify before applying.",
    location: "San Francisco, CA / Remote (US) — Canada possible",
    geoGateReason: null,
    geoGateDetail: "Listed as SF on Greenhouse but app form includes Canada option. Benefits via Remote.com. Requires clarification.",
    blocksStage: false,
    keywords: "Temporal, product management, agent platform, AI, workflow orchestration, durable execution, developer tools, staff PM",
    pdfNeeded: true,
    archetype: "Agentic / Automation",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Temporal — Staff Product Manager, Agent Platform

**Date:** 2026-06-15
**Archetype:** Agentic / Automation
**Score:** 3.75/5
**Verdict:** Investable Stretch
**Legitimacy:** High Confidence
**PDF:** Pending
**JD Snapshot:** jds/501-temporal-2026-06-15.md
**Canada Eligible:** unknown — SF listed but Canada selectable on app form. Needs clarification.

---

## A) Role Summary
- **Archetype:** Agentic / Automation
- **Domain:** Workflow orchestration, durable execution, developer infrastructure
- **Function:** Agent platform strategy and roadmap
- **Seniority:** Staff
- **Remote:** Listed SF; remote possible (Canada eligibility unclear)
- **TL;DR:** Own end-to-end product experience for developers building AI agents on Temporal. Define multi-agent orchestration roadmap.

## B) CV Match
Strong PM credentials (14+ yrs, platform experience, staff-level ownership). Genuine AI/agentic hands-on experience (Confirmation Reimagined, AI Product Builder). Gaps: no Temporal/workflow engine experience, no open-source community experience, developer tooling experience adjacent not direct. Score: 3.75/5.

## C) Level and Strategy
Staff-level reach. Position as "strong Senior PM with genuine agentic AI experience who builds products end-to-end."

## D) Comp and Demand
$220K–$297K USD + equity. Exceptional comp. Series B/C company.

## E) Personalization Plan
1. Emphasize AI/agentic workflow hands-on experience
2. Study Temporal fundamentals (workflows, durability, replay)
3. Prepare developer empathy narrative (started as test engineer)
4. Clarify Canada eligibility early

## G) Posting Legitimacy
**High Confidence** — Active posting, well-funded company, specific requirements.

---

## Extracted Keywords
Temporal, product management, agent platform, AI agents, workflow orchestration, durable execution, developer tools, multi-agent
`,
    jdSnapshotContent: `# JD Snapshot: Temporal — Staff Product Manager, Agent Platform

**Source:** job-boards.greenhouse.io/temporaltechnologies/jobs/5124710007
**Date:** 2026-06-15

## Role
Staff Product Manager, Agent Platform
San Francisco, CA / Remote
$220,000 – $297,000 USD + equity
Posted: 2026-04-29

## Responsibilities
- Own end-to-end product experience for developers building AI agents on Temporal
- Shape multi-agent orchestration roadmap (agent-calls-agent, handoff protocols, agent teams)
- Drive agent platform strategy

## Requirements
- 8+ years PM experience
- Deep AI/agent domain knowledge
- Developer empathy
- Platform product thinking
- Agent architectures experience preferred (orchestration, tool use, memory, branching)
`,
  },
  {
    id: "502",
    pipelineLine: 498,
    date: "2026-06-15",
    company: "Temporal",
    coSlug: "temporal",
    role: "Staff Product Manager, Core Primitives",
    jobSlug: "staff-product-manager-core-primitives",
    url: "https://job-boards.greenhouse.io/temporal/jobs/5124126007",
    source: "portal",
    postedDate: "2026-06-03",
    score: 3.0,
    verdict: "Long-Shot Stretch",
    canadaEligible: "no",
    canadaReason: "US Remote only. No Canada eligibility for this role (other Temporal roles marked US/Canada; this one is US-only).",
    location: "United States – Remote Opportunity",
    geoGateReason: "remote-only",
    geoGateDetail: "Temporal explicitly distinguishes US-only vs US/Canada roles. This one is US-only.",
    blocksStage: true,
    keywords: "Temporal, product management, core primitives, workflows, SDKs, durable execution, developer tools, staff PM",
    pdfNeeded: true,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Temporal — Staff Product Manager, Core Primitives

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 3.0/5
**Verdict:** Long-Shot Stretch
**Legitimacy:** High Confidence
**PDF:** Pending
**JD Snapshot:** jds/502-temporal-2026-06-15.md
**Canada Eligible:** no — US Remote only. Temporal distinguishes US-only vs US/Canada roles; this one is US-only.

---

## A) Role Summary
- **Archetype:** Technical AI PM
- **Domain:** Workflow orchestration, durable execution, developer infrastructure
- **Function:** Core primitives strategy (Workflows, Activities, Timers, Signals, SDKs)
- **Seniority:** Staff
- **Remote:** US Remote Opportunity
- **TL;DR:** Own strategy and roadmap for Temporal's Core Primitives — reducing need for custom patterns and deep Temporal expertise.

## B) CV Match
Strong PM strategy skills but lacks deep platform/infra/distributed-systems experience demanded. No workflow engine experience. Developer-tooling experience is adjacent only. US-only location blocker. Score: 3.0/5.

## G) Posting Legitimacy
**High Confidence** — Real role.

---

## Extracted Keywords
Temporal, product management, core primitives, workflows, SDKs, durable execution, developer tools, distributed systems
`,
    jdSnapshotContent: `# JD Snapshot: Temporal — Staff Product Manager, Core Primitives

**Source:** job-boards.greenhouse.io/temporaltechnologies/jobs/5124126007
**Date:** 2026-06-15

## Role
Staff Product Manager, Core Primitives
United States – Remote Opportunity
$185,000 – $260,000 + equity
Posted: 2026-06-03

## Requirements
- 8+ years PM on platform/infra/developer-facing products
- Technical fluency in distributed systems
- API semantics, failure modes, state management
- Workflow engine experience preferred
- Cross-language/cross-platform product experience preferred
`,
  },
  {
    id: "503",
    pipelineLine: 499,
    date: "2026-06-15",
    company: "Neo Financial",
    coSlug: "neo-financial",
    role: "Senior/Lead Product Manager, Banking",
    jobSlug: "senior-lead-product-manager-banking",
    url: "https://jobs.ashbyhq.com/neofinancial/fc6f9981-1f52-4b69-9658-433436143d3e",
    source: "portal",
    postedDate: "2026-03-02",
    score: 2.8,
    verdict: "Long-Shot Stretch",
    canadaEligible: "yes",
    canadaReason: "Canadian fintech, Calgary AB. Canadian citizen fully authorized. Relocation from Toronto needed.",
    location: "Calgary, AB, Canada (on-site)",
    geoGateReason: null,
    geoGateDetail: "On-site in Calgary, AB. Candidate is Toronto-based — relocation required.",
    blocksStage: false,
    keywords: "Neo Financial, product management, banking, payments, fintech, card processing, credit risk, Calgary",
    pdfNeeded: false,
    archetype: "Technical AI PM",
    legitimacy: "High Confidence",
    reportContent: `# Evaluation: Neo Financial — Senior/Lead Product Manager, Banking

**Date:** 2026-06-15
**Archetype:** Technical AI PM
**Score:** 2.8/5
**Verdict:** Long-Shot Stretch
**Legitimacy:** High Confidence
**PDF:** No
**JD Snapshot:** jds/503-neo-financial-2026-06-15.md
**Canada Eligible:** yes — Canadian fintech, Calgary AB. Candidate is Canadian citizen but would need Toronto→Calgary relocation.

---

## A) Role Summary
- **Archetype:** Technical AI PM
- **Domain:** Banking, payments infrastructure (fintech)
- **Function:** Banking product (payment rails, card processing, credit risk)
- **Seniority:** Senior/Lead
- **Remote:** On-site, Calgary, AB
- **TL;DR:** Lead Neo Financial's banking product — payment rails, card processing, settlements, ledgers, and credit risk infrastructure.

## B) CV Match
Strong title/level alignment and PM fundamentals. Hard domain gap: no payments infrastructure, card processing, or credit risk experience. Fintech experience is adjacent (digital lending apps at Cognizant). Geography: on-site Calgary, candidate is Toronto-based. Score: 2.8/5.

## G) Posting Legitimacy
**High Confidence** — Posted March 2026 (older but fintech roles often stay open).

---

## Extracted Keywords
Neo Financial, product management, banking, payments, fintech, card processing, credit risk, Calgary, Canada
`,
    jdSnapshotContent: `# JD Snapshot: Neo Financial — Senior/Lead Product Manager, Banking

**Source:** jobs.ashbyhq.com/neofinancial/fc6f9981-1f52-4b69-9658-433436143d3e
**Date:** 2026-06-15

## Role
Senior/Lead Product Manager, Banking
Calgary, AB, Canada (on-site)
Posted: 2026-03-02

## About Neo Financial
Canadian fintech company building modern banking, payments, and credit products.

## Requirements
- Senior/Lead level product management experience
- Banking/payments domain expertise
- Data-driven decision making
- Cross-functional leadership
- Systems thinking
`,
  },
];

// Write all report files
for (const ev of evaluations) {
  // Write report
  const reportPath = path.join(REPORTS_DIR, `${ev.id}-${ev.coSlug}-${ev.date}.md`);
  fs.writeFileSync(reportPath, ev.reportContent);
  console.log(`Wrote: ${reportPath}`);

  // Write JD snapshot
  const jdPath = path.join(JDS_DIR, `${ev.id}-${ev.coSlug}-${ev.date}.md`);
  fs.writeFileSync(jdPath, ev.jdSnapshotContent);
  console.log(`Wrote: ${jdPath}`);

  // Generate PDF if score >= 3.0
  if (ev.score >= 3.0) {
    try {
      const pdfScript = path.join(VAULT, "engines", "pathfinder", "generate-pdf.mjs");
      if (fs.existsSync(pdfScript)) {
        console.log(`Generating PDF for ${ev.id}...`);
        execSync(`node "${pdfScript}" "${reportPath}"`, {
          cwd: VAULT,
          timeout: 60000,
          env: { ...process.env, HOME: "~" },
          stdio: "pipe",
        });
        console.log(`PDF generated for ${ev.id}`);
      } else {
        console.log(`PDF script not found at ${pdfScript}, skipping PDF for ${ev.id}`);
      }
    } catch (e) {
      console.error(`PDF generation failed for ${ev.id}: ${e.message}`);
    }
  }
}

// Build and upsert queue entries
for (const ev of evaluations) {
  const queuePayload = {
    company: ev.company,
    co_slug: ev.coSlug,
    role: ev.role,
    job_slug: ev.jobSlug,
    title: ev.role,
    source_url: ev.url,
    url: ev.url,
    source: ev.source,
    duplicate_of: ev.duplicateOf || null,
    canonical_key: `${ev.coSlug}::${ev.jobSlug}`,
    posted_date: ev.postedDate,
    score: ev.score,
    verdict: ev.verdict,
    report_path: `reports/${ev.id}-${ev.coSlug}-${ev.date}.md`,
    report: `reports/${ev.id}-${ev.coSlug}-${ev.date}.md`,
    jd_snapshot: `jds/${ev.id}-${ev.coSlug}-${ev.date}.md`,
    jd_path: `jds/${ev.id}-${ev.coSlug}-${ev.date}.md`,
    location: ev.location,
    keywords: ev.keywords.split(", "),
    canada_eligible: ev.canadaEligible,
    canada_eligible_reason: ev.canadaReason,
    geo_gate: {
      reason: ev.geoGateReason,
      detail: ev.geoGateDetail,
      blocks_stage: ev.blocksStage,
    },
    queue_state: "evaluated",
    recommendation: ev.score >= 4.5 ? "auto_stage" : ev.score >= 3.0 ? "review" : "skip",
    date: ev.date,
    pipeline_row: ev.pipelineLine,
  };

  const tmpFile = `/tmp/lin-entry-${ev.id}.json`;
  fs.writeFileSync(tmpFile, JSON.stringify(queuePayload, null, 2));

  try {
    const result = execSync(`node scripts/lin-evaluation-queue.mjs upsert --id ${ev.id} --file "${tmpFile}"`, {
      cwd: VAULT,
      timeout: 30000,
      stdio: "pipe",
    });
    console.log(`Queue upserted: ${ev.id} (${ev.company} — ${ev.verdict})`);
  } catch (e) {
    console.error(`Queue upsert FAILED for ${ev.id}: ${e.message}`);
    if (e.stderr) console.error(e.stderr.toString());
    if (e.stdout) console.error(e.stdout.toString());
  }

  // Cleanup temp file
  try { fs.unlinkSync(tmpFile); } catch {}
}

// Update pipeline rows (mark as processed)
console.log("\n--- Updating pipeline rows ---");
const pipelineContent = fs.readFileSync(PIPELINE_PATH, "utf8");
const lines = pipelineContent.split("\n");

for (const ev of evaluations) {
  const lineIdx = ev.pipelineLine - 1;
  if (lineIdx >= 0 && lineIdx < lines.length) {
    const oldLine = lines[lineIdx];
    const pdfMark = ev.pdfNeeded ? "✅" : "❌";
    const newLine = `- [x] #${ev.id} | ${ev.url} | ${ev.company} | ${ev.role} | ${ev.score}/5 | PDF ${pdfMark} | CANADA:${ev.canadaEligible === "yes" ? "y" : ev.canadaEligible === "no" ? "n" : "u"} | src=${ev.source}${ev.postedDate ? ` posted=${ev.postedDate}` : ""}`;
    lines[lineIdx] = newLine;
    console.log(`Line ${ev.pipelineLine}: ✓ marked as processed`);
  }
}

fs.writeFileSync(PIPELINE_PATH, lines.join("\n"));
console.log("\nPipeline updated:", PIPELINE_PATH);

console.log("\n--- Consolidation complete ---");
