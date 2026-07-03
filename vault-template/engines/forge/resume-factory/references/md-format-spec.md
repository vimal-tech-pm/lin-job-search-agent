# Resume Markdown Format Specification (v1.0)

This document defines the **exact** Markdown structure that the resume-factory builder expects. Upstream agents generating `.md` resume files MUST follow this format precisely. The builder parses this structure deterministically — deviations will produce broken or incorrect output.

## Format Overview

The `.md` file uses a combination of YAML frontmatter (for metadata) and structured Markdown sections. Every resume has these sections in order:

1. YAML Frontmatter (contact info + meta)
2. Professional Summary
3. Key Achievements
4. Skills & Tools
5. Professional Experience
6. Education
7. Certifications

Sections 3 (Key Achievements) and 7 (Certifications) are optional. All others are required.

---

## 1. YAML Frontmatter

```yaml
---
name: "ALEX MORGAN"
title: "Senior Product Manager"
tagline: "Product Strategy & Roadmap | Platform Modernization | Agile Delivery | Data-Driven Growth"
contact:
  phone: "555-000-0000"
  email: "you@example.com"
  linkedin: "linkedin.com/in/alexmorgan"
  linkedin_url: "https://www.linkedin.com/in/alexmorgan/"
  location: "Toronto, ON"
---
```

**Rules:**
- `name`: ALL CAPS in the output (the builder uppercases it; store natural case here)
- `title`: Rendered as-is below the name
- `tagline`: Pipe-separated keywords. Use ` | ` (space-pipe-space) as delimiter
- `contact`: All fields optional except `email` and `location`. Fields render in this order: phone, email, linkedin, location. LinkedIn renders as a hyperlink using `linkedin_url`
- Additional contact fields can be added (e.g., `github`, `website`) — they render in order after the standard fields, pipe-separated

## 2. Professional Summary

```markdown
## PROFESSIONAL SUMMARY

Senior Product Manager with 14+ years of experience in product strategy, roadmap execution, and agile delivery across digital platforms in financial services, tax & accounting, and enterprise SaaS. Proven track record of launching products adopted by 125,000+ professionals, driving NPS from 26 to 70, and delivering $420K+ in cost savings. Skilled in cross-functional leadership, data-driven decision-making, and stakeholder management from engineering teams to C-suite executives.
```

**Rules:**
- Section header: `## PROFESSIONAL SUMMARY` (ALL CAPS, H2)
- Body: A single paragraph (no line breaks). The builder wraps it automatically
- No bullets, no bold markers — plain text only

## 3. Key Achievements (Optional)

```markdown
## KEY ACHIEVEMENTS

- **NPS 26 to 70** (125K+ users)
- **60%** faster time-to-market
- **$420K+** cost savings
- **$2BN** loan originations
- **50%** fewer abandoned registrations
- **25%** reduction in build items
- **10%** loan conversion increase
- **$50M+** RFP wins
```

**Rules:**
- Section header: `## KEY ACHIEVEMENTS` (ALL CAPS, H2)
- Each achievement is a bullet (`- `)
- The **bold** portion is the metric/number (rendered in accent color by the theme)
- The non-bold portion is the context label
- The builder renders these in a centered, pipe-separated layout across 2 rows
  (4 items per row). If fewer than 5 items, use a single row
- Items render in the order listed

**CRITICAL — KEEP ITEMS SHORT:**

Each item shares a centered line with 3 other items. If the metric plus context is too
long, the row will overflow and alignment will break across renderers.

- The **bold metric** should be 1-4 words max
- The context label should be 2-5 words max
- Total length per item (metric + context combined): **35 characters or fewer**

**GOOD examples (short enough to render cleanly):**

```markdown
- **NPS 26 to 70** (125K+ users)
- **60%** faster time-to-market
- **$420K+** cost savings
- **$2BN** loan originations
- **250** audit firms migrated
- **100%** migration completion
- **zero** data loss
- **25,000+** weekly professionals
```

**BAD examples (too long and likely to overflow):**

```markdown
- **250 audit firms** migrated in a flagship platform launch
- **100%** customer completion in a cloud-to-data-center migration
- **25,000+** weekly professionals supported on current platform
- **8+** VP and Director business reviews presented
```

**How to fix long items:**

```markdown
- **250** audit firms migrated
- **100%** migration completion
- **25,000+** weekly professionals
- **8+** VP/Director reviews
```

## 4. Skills & Tools

```markdown
## SKILLS & TOOLS

- **Product & Strategy:** Product Strategy & Roadmap, OKR & KPI Management, Go-to-Market Strategy, Data Storyboarding, Market Research, User Experience Design
- **Execution & Delivery:** Agile/Scrum/SAFe, Sprint Planning, Requirements Analysis, A/B Testing, Quality Assurance, Cross-functional Leadership, Stakeholder Management
- **Tools & Platforms:** Azure DevOps, Jira, Rally, Pendo, Adobe Analytics, Power BI, Figma, Lucidchart, Advanced Excel
```

**Rules:**
- Section header: `## SKILLS & TOOLS` (ALL CAPS, H2)
- Each category is a bullet with the category name in **bold** followed by a colon
- Skills within a category are comma-separated plain text
- No nested bullets — keep flat

## 5. Professional Experience

```markdown
## PROFESSIONAL EXPERIENCE

### Product Manager | Jun 2021 – Present
*Thomson Reuters | Toronto, Canada*

- Defined product vision, roadmap, and backlog for a NextGen digital platform trusted by **125,000+ professionals**, achieving an NPS score of **70** (up from legacy 26).
- Led end-to-end product execution for two major platform launches, coordinating across engineering, QA, design, and business stakeholders to deliver on schedule with zero critical defects at launch.
- Reduced time-to-market for 200+ critical bank forms by **60%** through process redesign and automation, directly increasing revenue and saving over **$420K**.

### Product Owner & Consultant | Jul 2016 – Jun 2021
*Cognizant Technology Solutions | Toronto, Canada & Chennai, India*

- Owned and managed roadmap and product launches for business-critical applications generating **$2BN in loan originations** with 400,000+ users across multiple lines of business.
- Achieved **10% increase in loan conversion** through customer experience improvements backed by A/B testing and data-driven insights for 100,000+ users.
```

**Rules:**
- Section header: `## PROFESSIONAL EXPERIENCE` (ALL CAPS, H2)
- Each role is an H3 (`###`) with format: `### Job Title | Date Range`
  - Date format: `Mon YYYY – Mon YYYY` or `Mon YYYY – Present`
  - Use an en-dash (`–`) not a hyphen (`-`) between dates
  - The pipe `|` separates title from dates
- Company line: Italic text (`*Company Name | Location*`)
  - Pipe separates company from location
- Bullet points (`- `): Each accomplishment on its own line
  - **Bold** markers around metrics/numbers within bullets (e.g., `**60%**`, `**$420K**`)
  - Bold should wrap ONLY the metric value, not the surrounding text
  - Each bullet is one complete sentence or thought

**CRITICAL — BOLD-MARKING RULES FOR BULLETS:**

Bold markers in experience bullets are for metric emphasis only. If you bold the wrong
span, the whole bullet can render in dark text and lose contrast.

- Bold wraps ONLY the metric or result phrase
- The rest of the sentence stays plain text
- Never bold the entire bullet
- If a bullet has no metric, use no bold at all
- Bold spans should be **5 words or fewer**

**CORRECT examples:**

```markdown
- Reduced time-to-market for 200+ critical bank forms by **60%** through process redesign.
- Led migration of **250 audit firms** in the largest transformation in business unit history.
- Achieved **10% increase in loan conversion** through A/B testing and data-driven insights.
- Partnered with engineering, QA, and operations on **50+** accessibility fixes.
```

**WRONG examples:**

```markdown
- **Reduced time-to-market for 200+ critical bank forms by 60% through process redesign.**
- Reduced time-to-market for **200+ critical bank forms by 60% through process redesign and automation, directly increasing revenue**.
- Led migration of **250 audit firms in the largest transformation in the business unit's history**.
```

## 6. Education

```markdown
## EDUCATION

### Master of Business Administration (International Business & Finance) | Aug 2010 – May 2012
*Indian Institute of Foreign Trade*

### Bachelor of Engineering (Electronics & Communication) | Aug 2004 – May 2008
*Madras Institute of Technology, Anna University*
```

**Rules:**
- Section header: `## EDUCATION` (ALL CAPS, H2)
- Each degree is an H3: `### Degree Name (Specialization) | Date Range`
- Institution is italic on the next line: `*Institution Name*`
- No bullets under education entries (unless the user explicitly adds coursework/honors)

## 7. Certifications (Optional)

```markdown
## CERTIFICATIONS

- Pragmatic Product Management Certification (PMC Level I & II)
- Certified Scrum Product Owner (CSPO)
- Certified SAFe 4 Advanced Scrum Master (SASM)
```

**Rules:**
- Section header: `## CERTIFICATIONS` (ALL CAPS, H2)
- Simple bullet list, no bold, no dates (unless the user wants dates)

---

## Parser Expectations

The builder script parses this format as follows:

1. **YAML frontmatter**: Everything between `---` markers → parsed as YAML
2. **Section headers**: Lines starting with `## ` → new section
3. **Role/Education headers**: Lines starting with `### ` → new entry within a section
4. **Italic company lines**: Lines wrapped in `*...*` → company/institution
5. **Bullets**: Lines starting with `- ` → list items
6. **Bold markers**: `**text**` → bold formatting (context-dependent: accent color in achievements, black bold in bullets)
7. **Plain paragraph text**: Anything else under a section → body text

## Content Guardrails (2-Page Enforcement)

These guidelines keep resumes within 2 pages by default. The builders emit soft warnings (not hard errors) when thresholds are exceeded.

### Builder warnings (advisory, do not block build)

| Warning Code | Trigger | Threshold |
|---|---|---|
| `WARN_BULLET_COUNT_HIGH` | Total bullets across all experience roles | >22 |
| `WARN_BULLET_TOO_LONG` | Any single bullet character count | >200 chars |
| `WARN_ACHIEVEMENTS_COUNT_HIGH` | Number of Key Achievement items | >8 |
| `WARN_ACHIEVEMENT_ROW_OVERFLOW` | Combined width of a 4-item achievement row + pipe separators | >150 chars |
| `WARN_SKILL_CATEGORIES_HIGH` | Number of skill categories | >4 |

### Bullet count guidance by recency

- **Most recent role**: 4-6 bullets
- **2nd and 3rd most recent**: 3-5 bullets
- **4th and older**: 2-3 bullets
- **Roles >10 years old**: 1-2 bullets

### Bullet length guidance

- Target: each bullet renders in 1-2 printed lines (~150 characters)
- Flag bullets over 200 characters for tightening

### Key Achievements row width

With 4 items per row plus ` | ` pipe-separator spacing, the rendered row must not exceed 2 lines. If the row overflows at the 35-char-per-item ceiling, tighten items to ≤30 chars each.

### Role handling for old or short-tenure roles

- Roles <6 months or >10 years old: reduce to 1-2 bullets or remove entirely if not relevant to the target JD
- **Do NOT create custom section names** (e.g., "Earlier Career") — ATS systems struggle with non-standard section headers. Keep each role as a standard Professional Experience entry or omit it

## Validation Checklist

Before passing a `.md` file to the builder, verify:

- [ ] YAML frontmatter has `name`, `title`, `tagline`, and `contact.email` + `contact.location`
- [ ] All section headers are H2 (`##`) and ALL CAPS
- [ ] All role/education entries are H3 (`###`) with pipe-separated dates
- [ ] Company/institution lines are italic (`*...*`)
- [ ] Bullets start with `- ` (dash space)
- [ ] Bold metrics use `**...**` markers and wrap only the metric or result phrase
- [ ] No experience bullet has its entire text wrapped in bold
- [ ] Bold spans in experience bullets are 5 words or fewer
- [ ] Key Achievement items are 35 characters or fewer total (metric + context)
- [ ] Dates use `Mon YYYY – Mon YYYY` format with en-dash
- [ ] No images, no HTML tags, no nested lists
- [ ] Sections appear in the order specified above
