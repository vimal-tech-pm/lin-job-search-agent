# Executive Clean

A polished, corporate theme with navy accents and Calibri typography. Clean section dividers, restrained color palette, and tight spacing optimized for 2-page resumes with dense content. ATS-tested and recruiter-approved.

## Page Setup

- **Page size**: US Letter (8.5 × 11 in / 12240 × 15840 DXA)
- **Margins**: Top=0.40in (576 DXA), Bottom=0.40in (576 DXA), Left=0.50in (720 DXA), Right=0.50in (720 DXA)
- **Content width**: 10800 DXA (7.5 inches)
- **Right tab stop**: 10800 DXA (flush right, for dates)

## Color Palette

| Token             | Hex       | Usage                                              |
|-------------------|-----------|----------------------------------------------------|
| `accent`          | `#2B579A` | Section header bottom borders                      |
| `metric`          | `#1A3C6E` | Key achievement metric values (bold numbers)       |
| `text-dark`       | `#000000` | Name, job titles, skill categories, bold metrics   |
| `text-body`       | `#333333` | Body text, summary, bullet text, section headers   |
| `text-secondary`  | `#555555` | Tagline, contact info, dates, locations, achievement context |

## Typography

All text uses the **Calibri** font family. Sizes are in **points (pt)**. Sizes in the builder use **half-points** (multiply pt × 2).

### Header Block (all centered)

| Element       | Font     | Size  | Weight | Color           | Space Before | Space After |
|---------------|----------|-------|--------|-----------------|-------------|------------|
| Name          | Calibri  | 18pt  | Bold   | `text-dark`     | 0           | 0          |
| Title         | Calibri  | 12pt  | Normal | `text-body`     | 1pt (20)    | 0.5pt (10) |
| Tagline       | Calibri  | 10pt  | Normal | `text-secondary`| 0           | 0          |
| Contact       | Calibri  | 9.5pt | Normal | `text-secondary`| 2.5pt (50)  | 2pt (40)   |

- **Tagline** has a bottom border: `accent` color, 6/8 pt (size=6), 4pt space below border
- **Contact** LinkedIn text is a hyperlink (same color, no underline override needed)

### Section Headers

| Property       | Value                                          |
|----------------|-------------------------------------------------|
| Font           | Calibri Bold 12pt                              |
| Color          | `text-body` (#333333)                          |
| Space before   | 12pt (240 half-points)                         |
| Space after    | 3pt (60 half-points)                           |
| Bottom border  | `accent` color, 4/8 pt (size=4), 2pt space    |
| Alignment      | Left                                           |

### Key Achievements (centered block)

Two rows of pipe-separated items. Each item has:

| Part            | Font          | Size | Weight | Color           |
|-----------------|---------------|------|--------|-----------------|
| Metric value    | Calibri       | 10.5pt | Bold   | `metric`        |
| Context label   | Calibri       | 10pt | Normal | `text-secondary`|

- Row 1: space before 1.5pt, space after 0.5pt
- Row 2: space before 0pt, space after 2pt
- Items separated by `    |    ` (4 spaces, pipe, 4 spaces)
- Center aligned

### Skills & Tools

| Part            | Font          | Size | Weight | Color           |
|-----------------|---------------|------|--------|-----------------|
| Category name   | Calibri       | 10.5pt | Bold   | `text-dark`     |
| Skill items     | Calibri       | 10.5pt | Normal | `text-body`     |

- Each category: space before 1pt, space after 1pt
- Category and items are on the same line, separated by `: `

### Professional Experience

**Job Title Line** (with right-aligned date):

| Part            | Font          | Size   | Weight | Color           |
|-----------------|---------------|--------|--------|-----------------|
| Job title       | Calibri       | 11.5pt | Bold   | `text-dark`     |
| Date range      | Calibri       | 10pt   | Normal | `text-secondary`|

- Space before: 8pt (160 half-points)
- Right tab stop at 10800 DXA for date alignment
- Job title and date on same paragraph, separated by tab character

**Company Line**:

| Part            | Font          | Size | Style  | Color           |
|-----------------|---------------|------|--------|-----------------|
| Company name    | Calibri       | 10.5pt | Italic | `text-body`     |
| Location        | Calibri       | 10pt | Italic | `text-secondary`|

- Space before: 0.5pt (10 half-points)
- Space after: 2.5pt (50 half-points)
- Company and location on same line, separated by `  |  `

**Bullet Points**:

| Part            | Font          | Size | Weight | Color           |
|-----------------|---------------|------|--------|-----------------|
| Normal text     | Calibri       | 10.5pt | Normal | `text-body`     |
| Bold metrics    | Calibri       | 10.5pt | Bold   | `text-dark`     |

- Bullet character: `•` (Calibri font)
- Indent: left=360 DXA, hanging=360 DXA
- Space before: 1.5pt (30 half-points)
- Space after: 1.5pt (30 half-points)

### Education

**Degree Line** (with right-aligned date):

| Part            | Font          | Size | Weight | Color           |
|-----------------|---------------|------|--------|-----------------|
| Degree name     | Calibri       | 10.5pt | Bold   | `text-dark`     |
| Date range      | Calibri       | 10pt | Normal | `text-secondary`|

- Space before: 4pt (80 half-points)
- Right tab stop at 10800 DXA

**Institution Line**:

| Part            | Font          | Size | Style  | Color           |
|-----------------|---------------|------|--------|-----------------|
| Institution     | Calibri       | 10pt | Italic | `text-body`     |

- Space before: 0.5pt (10 half-points)
- Space after: 1.5pt (30 half-points)

### Certifications

Same as Professional Experience bullet points (10.5pt Calibri, `text-body`, bullet list).

## Best Used For

Senior professionals, corporate roles, management consulting, financial services, product management, enterprise SaaS. Works well for 1–3 page resumes with dense experience sections.
