#!/usr/bin/env node
/**
 * Resume Factory Builder — build-resume.js
 *
 * Usage:
 *   node build-resume.js <input.md> <theme-name> <output-name> [--pdf] [--validate-only]
 *
 * Reads a standardized resume .md file, validates it against the shared
 * resume-factory markdown contract, applies the named theme's formatting,
 * and produces a .docx file. When --pdf is requested, it also renders the
 * theme's HTML template to .pdf via Playwright + headless Chromium
 * (see scripts/render-pdf-playwright.mjs). There is no fallback PDF engine:
 * if Playwright/Chromium is missing, the render step exits 1 with an install
 * hint and no PDF is produced.
 *
 * Supported themes: executive-clean
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  LevelFormat, BorderStyle, ExternalHyperlink, TabStopType
} = require("docx");

const SECTION_ORDER = [
  "PROFESSIONAL SUMMARY",
  "KEY ACHIEVEMENTS",
  "SKILLS & TOOLS",
  "PROFESSIONAL EXPERIENCE",
  "EDUCATION",
  "CERTIFICATIONS"
];
const REQUIRED_SECTIONS = new Set([
  "PROFESSIONAL SUMMARY",
  "SKILLS & TOOLS",
  "PROFESSIONAL EXPERIENCE",
  "EDUCATION"
]);
const DATE_PATTERN = /^[A-Z][a-z]{2} \d{4} – (?:[A-Z][a-z]{2} \d{4}|Present)$/;
const MAX_ACHIEVEMENT_ITEM_CHARS = 35;
const MAX_BOLD_SPAN_WORDS = 5;
const METRIC_SIGNAL_PATTERN = /(\d|[$%+]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)\b)/i;

// ═══════════════════════════════════════════════════════════════
// THEME DEFINITIONS — each theme is a complete formatting spec
// ═══════════════════════════════════════════════════════════════

const THEMES = {
  "executive-clean": {
    page: {
      width: 12240, height: 15840, // US Letter in DXA (twentieths of a point)
      marginTop: 576, marginBottom: 576, marginLeft: 720, marginRight: 720
    },
    rightTabStop: 10800, // flush-right tab for dates (content width in DXA)
    colors: {
      accent: "2B579A",
      metric: "1A3C6E",
      textDark: "000000",
      textBody: "333333",
      textSecondary: "555555"
    },
    fonts: { primary: "Calibri" },
    // Sizes in half-points (multiply pt × 2)
    sizes: {
      name: 36,           // 18pt
      title: 24,          // 12pt
      tagline: 20,        // 10pt
      contact: 19,        // 9.5pt
      sectionHeader: 24,  // 12pt
      jobTitle: 23,       // 11.5pt
      companyName: 21,    // 10.5pt
      companyLocation: 20,// 10pt
      body: 21,           // 10.5pt
      date: 20,           // 10pt
      achievementMetric: 21, // 10.5pt
      achievementContext: 20, // 10pt
      eduDegree: 21,      // 10.5pt
      eduInstitution: 20, // 10pt
      certItem: 21        // 10.5pt
    },
    // Spacing values in DXA (twentieths of a point)
    spacing: {
      titleBefore: 20, titleAfter: 10,
      contactBefore: 50, contactAfter: 40,
      sectionBefore: 240, sectionAfter: 60,
      jobTitleBefore: 160, jobTitleAfter: 0,
      companyBefore: 10, companyAfter: 50,
      bulletBefore: 30, bulletAfter: 30,
      skillBefore: 20, skillAfter: 20,
      achieveRow1Before: 30, achieveRow1After: 10,
      achieveRow2Before: 0, achieveRow2After: 40,
      eduDegreeBefore: 80, eduDegreeAfter: 0,
      eduInstBefore: 10, eduInstAfter: 30
    },
    borders: {
      tagline: { color: "2B579A", size: 6, space: 4 },
      sectionHeader: { color: "2B579A", size: 4, space: 2 }
    },
    bullet: {
      char: "\u2022", indent: 360, hanging: 360
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// MARKDOWN PARSER
// ═══════════════════════════════════════════════════════════════

function parseResumeMd(content) {
  const result = {
    meta: {},
    sections: []
  };

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    result.meta = parseSimpleYaml(fmMatch[1]);
    content = content.slice(fmMatch[0].length).trim();
  }

  const sectionRegex = /^## (.+)$/gm;
  let lastIndex = 0;
  let lastHeader = null;
  let match;
  const rawSections = [];

  while ((match = sectionRegex.exec(content)) !== null) {
    if (lastHeader !== null) {
      rawSections.push({
        header: lastHeader,
        body: content.slice(lastIndex, match.index).trim()
      });
    }
    lastHeader = match[1].trim();
    lastIndex = match.index + match[0].length;
  }
  if (lastHeader !== null) {
    rawSections.push({
      header: lastHeader,
      body: content.slice(lastIndex).trim()
    });
  }

  for (const sec of rawSections) {
    const parsed = {
      header: sec.header,
      body: sec.body,
      type: identifySectionType(sec.header)
    };

    switch (parsed.type) {
      case "summary":
        parsed.text = sec.body.replace(/\n/g, " ").trim();
        break;
      case "achievements":
        parsed.items = parseAchievements(sec.body);
        break;
      case "skills":
        parsed.categories = parseSkills(sec.body);
        break;
      case "experience":
        parsed.roles = parseExperienceRoles(sec.body);
        break;
      case "education":
        parsed.degrees = parseEducation(sec.body);
        break;
      case "certifications":
        parsed.items = parseCertifications(sec.body);
        break;
      default:
        parsed.text = sec.body;
    }

    result.sections.push(parsed);
  }

  return result;
}

function identifySectionType(header) {
  const h = header.toUpperCase();
  if (h.includes("SUMMARY")) return "summary";
  if (h.includes("ACHIEVEMENT")) return "achievements";
  if (h.includes("SKILL") || h.includes("TOOL")) return "skills";
  if (h.includes("EXPERIENCE")) return "experience";
  if (h.includes("EDUCATION")) return "education";
  if (h.includes("CERTIFICATION")) return "certifications";
  return "other";
}

function parseSimpleYaml(yaml) {
  const result = {};
  let currentKey = null;
  let subObj = null;

  for (const line of yaml.split("\n")) {
    const topMatch = line.match(/^(\w[\w_]*):\s*"?([^"]*)"?\s*$/);
    const subStart = line.match(/^(\w[\w_]*):\s*$/);
    const subItem = line.match(/^\s+(\w[\w_]*):\s*"?([^"]*)"?\s*$/);

    if (subItem && currentKey) {
      if (!subObj) subObj = {};
      subObj[subItem[1]] = subItem[2];
    } else if (subStart) {
      if (currentKey && subObj) result[currentKey] = subObj;
      currentKey = subStart[1];
      subObj = {};
    } else if (topMatch) {
      if (currentKey && subObj) result[currentKey] = subObj;
      currentKey = null;
      subObj = null;
      result[topMatch[1]] = topMatch[2];
    }
  }
  if (currentKey && subObj) result[currentKey] = subObj;
  return result;
}

function parseAchievementItem(text) {
  const boldMatch = text.match(/\*\*(.+?)\*\*/);
  const metric = boldMatch ? boldMatch[1] : "";
  const context = text.replace(/\*\*(.+?)\*\*/, "").trim();
  return { metric, context };
}

function parseAchievements(body) {
  return nonblankLines(body)
    .filter(line => line.startsWith("- "))
    .map(line => parseAchievementItem(line.replace(/^-\s+/, "")));
}

function parseSkills(body) {
  return nonblankLines(body)
    .filter(line => line.startsWith("- "))
    .map(line => {
      const text = line.replace(/^-\s+/, "");
      const catMatch = text.match(/\*\*(.+?)\*\*:?\s*(.*)/s);
      if (catMatch) {
        let category = catMatch[1].replace(/:$/, "").trim();
        let items = catMatch[2].trim();
        if (items.startsWith(":")) items = items.slice(1).trim();
        return { category: `${category}:`, items };
      }
      return { category: "", items: text };
    });
}

function parseExperienceRoles(body) {
  const roles = [];
  for (const block of splitH3Blocks(body)) {
    const headerLine = block.header;
    const pipeIdx = headerLine.lastIndexOf("|");
    let jobTitle;
    let dateRange;
    if (pipeIdx > 0) {
      jobTitle = headerLine.slice(0, pipeIdx).trim();
      dateRange = headerLine.slice(pipeIdx + 1).trim();
    } else {
      jobTitle = headerLine;
      dateRange = "";
    }

    let company = "";
    let location = "";
    const companyLine = block.lines.find(line => /^\*[^*]/.test(line.trim()));
    if (companyLine) {
      const clean = companyLine.trim().replace(/^\*|\*$/g, "");
      const cpipe = clean.indexOf("|");
      if (cpipe > 0) {
        company = clean.slice(0, cpipe).trim();
        location = clean.slice(cpipe + 1).trim();
      } else {
        company = clean.trim();
      }
    }

    const bullets = block.lines
      .filter(line => line.startsWith("- "))
      .map(line => parseBulletRuns(line.replace(/^-\s+/, "").trim()));

    roles.push({ jobTitle, dateRange, company, location, bullets });
  }
  return roles;
}

function parseEducation(body) {
  const degrees = [];
  for (const block of splitH3Blocks(body)) {
    const headerLine = block.header;
    const pipeIdx = headerLine.lastIndexOf("|");
    let degree;
    let dateRange;
    if (pipeIdx > 0) {
      degree = headerLine.slice(0, pipeIdx).trim();
      dateRange = headerLine.slice(pipeIdx + 1).trim();
    } else {
      degree = headerLine;
      dateRange = "";
    }

    let institution = "";
    const instLine = block.lines.find(line => /^\*[^*]/.test(line.trim()));
    if (instLine) {
      institution = instLine.trim().replace(/^\*|\*$/g, "").trim();
    }

    degrees.push({ degree, dateRange, institution });
  }
  return degrees;
}

function parseCertifications(body) {
  return nonblankLines(body)
    .filter(line => line.startsWith("- "))
    .map(line => line.replace(/^-\s+/, "").trim());
}

function splitH3Blocks(body) {
  return body
    .split(/^### /m)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const lines = part
        .split("\n")
        .map(line => line.trimEnd())
        .filter(line => line.trim());
      return { header: lines[0].trim(), lines: lines.slice(1) };
    });
}

function nonblankLines(body) {
  return body
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

function parseBulletRuns(text) {
  const runs = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      runs.push({ text: text.slice(lastIdx, match.index), bold: false });
    }
    runs.push({ text: match[1], bold: true });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    runs.push({ text: text.slice(lastIdx), bold: false });
  }
  return runs;
}

function achievementDisplayLength(metric, context) {
  return [metric.trim(), context.trim()].filter(Boolean).join(" ").length;
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function looksLikeMetricText(text) {
  return METRIC_SIGNAL_PATTERN.test(text);
}

function normalizeBoldRuns(runs) {
  const nonemptyRuns = runs.filter(run => run.text.trim());
  if (nonemptyRuns.length > 0 && nonemptyRuns.every(run => run.bold)) {
    return runs.map(run => ({
      text: run.text,
      bold: run.bold
        && countWords(run.text) <= MAX_BOLD_SPAN_WORDS
        && looksLikeMetricText(run.text)
    }));
  }
  return runs;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

function validateResume(resume) {
  const errors = [];
  const meta = resume.meta || {};
  const sections = resume.sections || [];

  for (const field of ["name", "title", "tagline", "contact"]) {
    if (!(field in meta)) {
      errors.push(`Frontmatter missing \`${field}\`.`);
    }
  }

  const contact = meta.contact || {};
  for (const field of ["email", "location"]) {
    if (!contact[field]) {
      errors.push(`Frontmatter \`contact.${field}\` is required.`);
    }
  }

  const headers = sections.map(section => section.header);
  for (const required of REQUIRED_SECTIONS) {
    if (!headers.includes(required)) {
      errors.push(`Missing required section: \`${required}\`.`);
    }
  }

  if (headers.length) {
    const canonicalPositions = headers
      .filter(header => SECTION_ORDER.includes(header))
      .map(header => SECTION_ORDER.indexOf(header));
    const sortedPositions = [...canonicalPositions].sort((a, b) => a - b);
    if (canonicalPositions.join(",") !== sortedPositions.join(",")) {
      errors.push("Sections are out of order relative to the resume-factory spec.");
    }
  }

  for (const section of sections) {
    if (section.header !== section.header.toUpperCase()) {
      errors.push(`Section header must be all caps: \`${section.header}\`.`);
    }

    if (section.type === "summary" && section.body.trim().includes("\n")) {
      errors.push("Professional Summary must be a single paragraph.");
    }

    if (section.type === "skills") {
      for (const line of nonblankLines(section.body)) {
        if (!line.startsWith("- **") || !line.includes(":")) {
          errors.push(`Skills line must be \`- **Category:** items\`: \`${line}\`.`);
        }
      }
    }

    if (section.type === "achievements") {
      validateAchievements(section.body, errors);
    }

    if (section.type === "experience") {
      validateExperience(section.body, errors);
    }

    if (section.type === "education") {
      validateEducation(section.body, errors);
    }
  }

  return errors;
}

function validateAchievements(body, errors) {
  for (const line of nonblankLines(body)) {
    if (!line.startsWith("- ")) continue;
    const { metric, context } = parseAchievementItem(line.slice(2).trim());
    if (achievementDisplayLength(metric, context) > MAX_ACHIEVEMENT_ITEM_CHARS) {
      errors.push(
        "Key Achievement items must be 35 characters or fewer total "
        + `(metric + context): \`${line}\`.`
      );
    }
  }
}

function validateExperience(body, errors) {
  const roles = splitH3Blocks(body);
  if (!roles.length) {
    errors.push("Professional Experience must contain at least one `###` role entry.");
    return;
  }

  for (const role of roles) {
    const header = role.header;
    if (!header.includes("|")) {
      errors.push(`Experience role header must include title and date range: \`${header}\`.`);
      continue;
    }
    const dateRange = header.slice(header.lastIndexOf("|") + 1).trim();
    if (!DATE_PATTERN.test(dateRange)) {
      errors.push(`Experience date range must use \`Mon YYYY – Mon YYYY\`: \`${dateRange}\`.`);
    }

    if (!role.lines.length || !/^\*.+\*$/.test(role.lines[0].trim())) {
      errors.push(`Experience role must include italic company line under \`${header}\`.`);
    }

    const bulletLines = role.lines.filter(line => line.startsWith("- "));
    if (!bulletLines.length) {
      errors.push(`Experience role must include bullets under \`${header}\`.`);
      continue;
    }

    for (const bulletLine of bulletLines) {
      validateExperienceBoldMarkers(bulletLine.slice(2).trim(), header, errors);
    }
  }
}

function validateExperienceBoldMarkers(text, header, errors) {
  const runs = parseBulletRuns(text);
  const nonemptyRuns = runs.filter(run => run.text.trim());

  if (nonemptyRuns.length > 0 && nonemptyRuns.every(run => run.bold)) {
    errors.push(`Experience bullet cannot have its entire text wrapped in bold under \`${header}\`: \`${text}\`.`);
  }

  for (const run of nonemptyRuns) {
    if (run.bold && countWords(run.text) > MAX_BOLD_SPAN_WORDS) {
      errors.push(
        `Experience bullet bold spans must be ${MAX_BOLD_SPAN_WORDS} words or fewer `
        + `under \`${header}\`: \`${run.text}\`.`
      );
    }
  }
}

function validateEducation(body, errors) {
  const degrees = splitH3Blocks(body);
  if (!degrees.length) {
    errors.push("Education must contain at least one `###` degree entry.");
    return;
  }

  for (const degree of degrees) {
    const header = degree.header;
    if (!header.includes("|")) {
      errors.push(`Education header must include degree and date range: \`${header}\`.`);
      continue;
    }
    const dateRange = header.slice(header.lastIndexOf("|") + 1).trim();
    if (!DATE_PATTERN.test(dateRange)) {
      errors.push(`Education date range must use \`Mon YYYY – Mon YYYY\`: \`${dateRange}\`.`);
    }

    if (!degree.lines.length || !/^\*.+\*$/.test(degree.lines[0].trim())) {
      errors.push(`Education entry must include italic institution line under \`${header}\`.`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SOFT WARNINGS (advisory — do not change exit code)
// ═══════════════════════════════════════════════════════════════

function getResumeStats(resume) {
  const sections = resume.sections || [];
  let totalBullets = 0;
  let roleCount = 0;
  let longBullets = [];
  let achievementCount = 0;
  let achievementRowWidths = [];
  let skillCategoryCount = 0;

  for (const section of sections) {
    if (section.type === "experience") {
      const roles = splitH3Blocks(section.body);
      roleCount = roles.length;
      for (const role of roles) {
        const bullets = role.lines.filter(l => l.startsWith("- "));
        totalBullets += bullets.length;
        for (const b of bullets) {
          const text = b.slice(2).trim();
          if (text.length > 200) longBullets.push(text);
        }
      }
    }
    if (section.type === "achievements") {
      const items = nonblankLines(section.body).filter(l => l.startsWith("- "));
      achievementCount = items.length;
      // Check row widths (4 items per row)
      for (let i = 0; i < items.length; i += 4) {
        const row = items.slice(i, i + 4);
        const rowLen = row.reduce((sum, item) => sum + item.slice(2).trim().length, 0)
          + (row.length - 1) * 9; // pipe separator overhead
        achievementRowWidths.push(rowLen);
      }
    }
    if (section.type === "skills") {
      skillCategoryCount = nonblankLines(section.body).filter(l => l.startsWith("- ")).length;
    }
  }

  return { totalBullets, roleCount, longBullets, achievementCount, achievementRowWidths, skillCategoryCount };
}

function emitWarnings(resume) {
  const stats = getResumeStats(resume);
  const warnings = [];

  if (stats.totalBullets > 22) {
    warnings.push(`WARNING [WARN_BULLET_COUNT_HIGH]: ${stats.totalBullets} bullets detected (recommended <=22).`);
  }
  for (const bullet of stats.longBullets) {
    warnings.push(`WARNING [WARN_BULLET_TOO_LONG]: Bullet exceeds 200 chars (${bullet.length}): "${bullet.slice(0, 60)}..."`);
  }
  if (stats.achievementCount > 8) {
    warnings.push(`WARNING [WARN_ACHIEVEMENTS_COUNT_HIGH]: ${stats.achievementCount} Key Achievement items (recommended <=8).`);
  }
  for (let i = 0; i < stats.achievementRowWidths.length; i++) {
    if (stats.achievementRowWidths[i] > 150) {
      warnings.push(`WARNING [WARN_ACHIEVEMENT_ROW_OVERFLOW]: Achievement row ${i + 1} combined width is ${stats.achievementRowWidths[i]} chars (recommended <=150).`);
    }
  }
  if (stats.skillCategoryCount > 4) {
    warnings.push(`WARNING [WARN_SKILL_CATEGORIES_HIGH]: ${stats.skillCategoryCount} skill categories (recommended <=4).`);
  }

  for (const w of warnings) {
    console.warn(w);
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════
// DOCX BUILDER
// ═══════════════════════════════════════════════════════════════

function buildDocx(resume, themeName) {
  const T = THEMES[themeName];
  if (!T) throw new Error(`Unknown theme: ${themeName}`);
  const C = T.colors;
  const S = T.sizes;
  const SP = T.spacing;
  const F = T.fonts.primary;

  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: String(resume.meta.name).toUpperCase(),
      bold: true,
      size: S.name,
      font: F,
      color: C.textDark
    })]
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: SP.titleBefore, after: SP.titleAfter },
    children: [new TextRun({
      text: resume.meta.title,
      size: S.title,
      font: F,
      color: C.textBody
    })]
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        color: T.borders.tagline.color,
        size: T.borders.tagline.size,
        space: T.borders.tagline.space
      }
    },
    children: [new TextRun({
      text: resume.meta.tagline,
      size: S.tagline,
      font: F,
      color: C.textSecondary
    })]
  }));

  const contact = resume.meta.contact || {};
  const standardKeys = ["phone", "email", "linkedin", "location"];
  const orderedContactParts = [];
  for (const key of standardKeys) {
    if (contact[key]) {
      orderedContactParts.push({ key, value: contact[key] });
    }
  }
  for (const [key, value] of Object.entries(contact)) {
    if (!standardKeys.includes(key) && !key.endsWith("_url") && value) {
      orderedContactParts.push({ key, value });
    }
  }

  const contactRuns = [];
  orderedContactParts.forEach((part, index) => {
    if (index > 0) {
      contactRuns.push(new TextRun({
        text: "  |  ",
        size: S.contact,
        font: F,
        color: C.textSecondary
      }));
    }
    if (part.key === "linkedin") {
      contactRuns.push(new ExternalHyperlink({
        link: contact.linkedin_url || `https://${contact.linkedin}`,
        children: [new TextRun({
          text: String(part.value),
          size: S.contact,
          font: F,
          color: C.textSecondary
        })]
      }));
    } else {
      contactRuns.push(new TextRun({
        text: String(part.value),
        size: S.contact,
        font: F,
        color: C.textSecondary
      }));
    }
  });

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: SP.contactBefore, after: SP.contactAfter },
    children: contactRuns
  }));

  for (const section of resume.sections) {
    children.push(makeSectionHeader(section.header, T));

    switch (section.type) {
      case "summary":
        children.push(new Paragraph({
          spacing: { before: 30, after: 40 },
          children: [new TextRun({
            text: section.text,
            size: S.body,
            font: F,
            color: C.textBody
          })]
        }));
        break;

      case "achievements":
        buildAchievements(children, section.items, T);
        break;

      case "skills":
        for (const cat of section.categories) {
          children.push(new Paragraph({
            spacing: { before: SP.skillBefore, after: SP.skillAfter },
            children: [
              new TextRun({
                text: `${cat.category} `,
                bold: true,
                size: S.body,
                font: F,
                color: C.textDark
              }),
              new TextRun({
                text: cat.items,
                size: S.body,
                font: F,
                color: C.textBody
              })
            ]
          }));
        }
        break;

      case "experience":
        for (const role of section.roles) {
          buildRole(children, role, T);
        }
        break;

      case "education":
        for (const deg of section.degrees) {
          buildEducation(children, deg, T);
        }
        break;

      case "certifications":
        for (const cert of section.items) {
          children.push(new Paragraph({
            numbering: { reference: "bullets", level: 0 },
            spacing: { before: SP.bulletBefore, after: SP.bulletAfter },
            children: [new TextRun({
              text: cert,
              size: S.certItem,
              font: F,
              color: C.textBody
            })]
          }));
        }
        break;

      default:
        children.push(new Paragraph({
          children: [new TextRun({
            text: section.text || "",
            size: S.body,
            font: F,
            color: C.textBody
          })]
        }));
    }
  }

  return new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: T.bullet.char,
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: F },
            paragraph: {
              indent: { left: T.bullet.indent, hanging: T.bullet.hanging }
            }
          }
        }]
      }]
    },
    sections: [{
      properties: {
        page: {
          size: { width: T.page.width, height: T.page.height },
          margin: {
            top: T.page.marginTop,
            bottom: T.page.marginBottom,
            left: T.page.marginLeft,
            right: T.page.marginRight
          }
        }
      },
      children
    }]
  });
}

function makeSectionHeader(text, T) {
  return new Paragraph({
    spacing: { before: T.spacing.sectionBefore, after: T.spacing.sectionAfter },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        color: T.borders.sectionHeader.color,
        size: T.borders.sectionHeader.size,
        space: T.borders.sectionHeader.space
      }
    },
    children: [new TextRun({
      text: text.toUpperCase(),
      bold: true,
      size: T.sizes.sectionHeader,
      font: T.fonts.primary,
      color: T.colors.textBody
    })]
  });
}

function buildAchievements(children, items, T) {
  const C = T.colors;
  const S = T.sizes;
  const F = T.fonts.primary;

  const rows = [];
  for (let i = 0; i < items.length; i += 4) {
    rows.push(items.slice(i, i + 4));
  }

  rows.forEach((row, rowIndex) => {
    const runs = [];
    row.forEach((item, index) => {
      if (index > 0) {
        runs.push(new TextRun({
          text: "    |    ",
          size: S.achievementContext,
          font: F,
          color: C.textSecondary
        }));
      }
      runs.push(new TextRun({
        text: item.metric,
        bold: true,
        size: S.achievementMetric,
        font: F,
        color: C.metric
      }));
      if (item.context) {
        runs.push(new TextRun({
          text: `  ${item.context}`,
          size: S.achievementContext,
          font: F,
          color: C.textSecondary
        }));
      }
    });

    const isFirst = rowIndex === 0;
    const isLast = rowIndex === rows.length - 1;
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: {
        before: isFirst ? T.spacing.achieveRow1Before : T.spacing.achieveRow2Before,
        after: isLast ? T.spacing.achieveRow2After : T.spacing.achieveRow1After
      },
      children: runs
    }));
  });
}

function buildRole(children, role, T) {
  const C = T.colors;
  const S = T.sizes;
  const F = T.fonts.primary;
  const SP = T.spacing;

  children.push(new Paragraph({
    spacing: { before: SP.jobTitleBefore, after: SP.jobTitleAfter },
    tabStops: [{ type: TabStopType.RIGHT, position: T.rightTabStop }],
    children: [
      new TextRun({
        text: role.jobTitle,
        bold: true,
        size: S.jobTitle,
        font: F,
        color: C.textDark
      }),
      new TextRun({ text: "\t", size: S.date, font: F }),
      new TextRun({
        text: role.dateRange,
        size: S.date,
        font: F,
        color: C.textSecondary
      })
    ]
  }));

  const companyRuns = [
    new TextRun({
      text: role.company,
      italics: true,
      size: S.companyName,
      font: F,
      color: C.textBody
    })
  ];
  if (role.location) {
    companyRuns.push(new TextRun({
      text: `  |  ${role.location}`,
      italics: true,
      size: S.companyLocation,
      font: F,
      color: C.textSecondary
    }));
  }
  children.push(new Paragraph({
    spacing: { before: SP.companyBefore, after: SP.companyAfter },
    children: companyRuns
  }));

  for (const bulletRuns of role.bullets) {
    const normalizedRuns = normalizeBoldRuns(bulletRuns);
    const docRuns = normalizedRuns.map(run => new TextRun({
      text: run.text,
      bold: run.bold,
      size: S.body,
      font: F,
      color: run.bold ? C.textDark : C.textBody
    }));

    children.push(new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { before: SP.bulletBefore, after: SP.bulletAfter },
      children: docRuns
    }));
  }
}

function buildEducation(children, deg, T) {
  const C = T.colors;
  const S = T.sizes;
  const F = T.fonts.primary;
  const SP = T.spacing;

  children.push(new Paragraph({
    spacing: { before: SP.eduDegreeBefore, after: SP.eduDegreeAfter },
    tabStops: [{ type: TabStopType.RIGHT, position: T.rightTabStop }],
    children: [
      new TextRun({
        text: deg.degree,
        bold: true,
        size: S.eduDegree,
        font: F,
        color: C.textDark
      }),
      new TextRun({ text: "\t", size: S.date, font: F }),
      new TextRun({
        text: deg.dateRange,
        size: S.date,
        font: F,
        color: C.textSecondary
      })
    ]
  }));

  if (deg.institution) {
    children.push(new Paragraph({
      spacing: { before: SP.eduInstBefore, after: SP.eduInstAfter },
      children: [new TextRun({
        text: deg.institution,
        italics: true,
        size: S.eduInstitution,
        font: F,
        color: C.textBody
      })]
    }));
  }
}

// ═══════════════════════════════════════════════════════════════
// HTML RENDERER + PDF BUILDER (Playwright + Chromium — single engine)
// ═══════════════════════════════════════════════════════════════
//
// PDF generation uses the HTML template at
// `resume-factory/templates/<theme-name>.html` and renders it to PDF via
// `scripts/render-pdf-playwright.mjs` (headless Chromium). There is no
// fallback engine: if Playwright or Chromium is missing, the render
// script exits 1 with a one-line install instruction and no PDF is
// written. See `SKILL.md` for the rationale.

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineBold(text) {
  // Convert `**span**` into `<strong>span</strong>`, escaping everything else.
  const parts = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(escapeHtml(text.slice(last, m.index)));
    }
    parts.push(`<strong>${escapeHtml(m[1])}</strong>`);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(escapeHtml(text.slice(last)));
  }
  return parts.join("");
}

function renderBulletRuns(runs) {
  const normalized = normalizeBoldRuns(runs);
  return normalized.map(run => {
    const escaped = escapeHtml(run.text);
    return run.bold ? `<strong>${escaped}</strong>` : escaped;
  }).join("");
}

function renderContactHtml(contact) {
  const standardKeys = ["phone", "email", "linkedin", "location"];
  const ordered = [];
  for (const key of standardKeys) {
    if (contact[key]) ordered.push({ key, value: contact[key] });
  }
  for (const [key, value] of Object.entries(contact)) {
    if (!standardKeys.includes(key) && !key.endsWith("_url") && value) {
      ordered.push({ key, value });
    }
  }

  const parts = [];
  ordered.forEach((part, index) => {
    if (index > 0) {
      parts.push(`<span class="sep">|</span>`);
    }
    if (part.key === "linkedin") {
      const href = escapeHtml(contact.linkedin_url || `https://${contact.linkedin}`);
      parts.push(`<a href="${href}">${escapeHtml(String(part.value))}</a>`);
    } else {
      parts.push(escapeHtml(String(part.value)));
    }
  });
  return parts.join("");
}

function renderAchievementsHtml(items) {
  const rows = [];
  for (let i = 0; i < items.length; i += 4) {
    rows.push(items.slice(i, i + 4));
  }
  const rowHtml = rows.map(row => {
    const cells = row.map(item => {
      const metric = `<span class="metric">${escapeHtml(item.metric)}</span>`;
      const context = item.context
        ? `<span class="context">${escapeHtml(item.context)}</span>`
        : "";
      return `${metric}${context}`;
    }).join(`<span class="pipe">|</span>`);
    return `<p class="row">${cells}</p>`;
  }).join("\n");
  return `<div class="achievements">\n${rowHtml}\n</div>`;
}

function renderSkillsHtml(categories) {
  const items = categories.map(cat => {
    const category = cat.category
      ? `<span class="category">${escapeHtml(cat.category)}</span> `
      : "";
    return `<li>${category}${escapeHtml(cat.items)}</li>`;
  }).join("\n");
  return `<ul class="skills-list">\n${items}\n</ul>`;
}

function renderExperienceHtml(roles) {
  return roles.map(role => {
    const head = `
      <div class="role-head">
        <span class="job-title">${escapeHtml(role.jobTitle)}</span>
        <span class="date">${escapeHtml(role.dateRange)}</span>
      </div>`;
    const location = role.location
      ? ` <span class="location">|  ${escapeHtml(role.location)}</span>`
      : "";
    const companyLine = `<p class="company-line">${escapeHtml(role.company)}${location}</p>`;
    const bullets = role.bullets.map(bulletRuns =>
      `<li>${renderBulletRuns(bulletRuns)}</li>`
    ).join("\n");
    return `<div class="role">${head}\n${companyLine}\n<ul class="bullets">\n${bullets}\n</ul>\n</div>`;
  }).join("\n");
}

function renderEducationHtml(degrees) {
  return degrees.map(deg => {
    const head = `
      <div class="degree-head">
        <span class="name">${escapeHtml(deg.degree)}</span>
        <span class="date">${escapeHtml(deg.dateRange)}</span>
      </div>`;
    const institution = deg.institution
      ? `<p class="institution">${escapeHtml(deg.institution)}</p>`
      : "";
    return `<div class="degree">${head}\n${institution}\n</div>`;
  }).join("\n");
}

function renderCertificationsHtml(items) {
  const lis = items.map(cert => `<li>${renderInlineBold(cert)}</li>`).join("\n");
  return `<ul class="bullets">\n${lis}\n</ul>`;
}

function renderSectionsHtml(resume) {
  const chunks = [];
  for (const section of resume.sections) {
    const header = `<h2 class="section-header">${escapeHtml(section.header.toUpperCase())}</h2>`;
    let body;
    switch (section.type) {
      case "summary":
        body = `<p class="summary">${renderInlineBold(section.text || "")}</p>`;
        break;
      case "achievements":
        body = renderAchievementsHtml(section.items || []);
        break;
      case "skills":
        body = renderSkillsHtml(section.categories || []);
        break;
      case "experience":
        body = renderExperienceHtml(section.roles || []);
        break;
      case "education":
        body = renderEducationHtml(section.degrees || []);
        break;
      case "certifications":
        body = renderCertificationsHtml(section.items || []);
        break;
      default:
        body = `<p>${renderInlineBold(section.text || "")}</p>`;
    }
    chunks.push(`<section>${header}\n${body}\n</section>`);
  }
  return chunks.join("\n");
}

function renderHtml(resume, themeName) {
  const T = THEMES[themeName];
  if (!T) throw new Error(`Unknown theme: ${themeName}`);

  const templatePath = path.join(__dirname, "..", "templates", `${themeName}.html`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`HTML template not found for theme "${themeName}": ${templatePath}`);
  }
  const template = fs.readFileSync(templatePath, "utf-8");

  const contactHtml = renderContactHtml(resume.meta.contact || {});
  const sectionsHtml = renderSectionsHtml(resume);

  const substitutions = {
    NAME: escapeHtml(String(resume.meta.name || "").toUpperCase()),
    TITLE: escapeHtml(resume.meta.title || ""),
    TAGLINE: escapeHtml(resume.meta.tagline || ""),
    CONTACT_HTML: contactHtml,
    SECTIONS_HTML: sectionsHtml,

    COLOR_ACCENT: `#${T.colors.accent}`,
    COLOR_METRIC: `#${T.colors.metric}`,
    COLOR_TEXT_DARK: `#${T.colors.textDark}`,
    COLOR_TEXT_BODY: `#${T.colors.textBody}`,
    COLOR_TEXT_SECONDARY: `#${T.colors.textSecondary}`,

    // Sizes: THEMES values are half-points → convert to pt for CSS
    SIZE_NAME: T.sizes.name / 2,
    SIZE_TITLE: T.sizes.title / 2,
    SIZE_TAGLINE: T.sizes.tagline / 2,
    SIZE_CONTACT: T.sizes.contact / 2,
    SIZE_SECTION: T.sizes.sectionHeader / 2,
    SIZE_JOB_TITLE: T.sizes.jobTitle / 2,
    SIZE_COMPANY: T.sizes.companyName / 2,
    SIZE_COMPANY_LOCATION: T.sizes.companyLocation / 2,
    SIZE_BODY: T.sizes.body / 2,
    SIZE_DATE: T.sizes.date / 2,
    SIZE_ACH_METRIC: T.sizes.achievementMetric / 2,
    SIZE_ACH_CONTEXT: T.sizes.achievementContext / 2,
    SIZE_EDU_DEGREE: T.sizes.eduDegree / 2,
    SIZE_EDU_INST: T.sizes.eduInstitution / 2,

    // DXA values (twentieths of a point) → inches for CSS
    BULLET_INDENT: (T.bullet.indent / 1440).toFixed(3),
    MARGIN_TOP: (T.page.marginTop / 1440).toFixed(3),
    MARGIN_RIGHT: (T.page.marginRight / 1440).toFixed(3),
    MARGIN_BOTTOM: (T.page.marginBottom / 1440).toFixed(3),
    MARGIN_LEFT: (T.page.marginLeft / 1440).toFixed(3)
  };

  let out = template;
  for (const [key, value] of Object.entries(substitutions)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

function buildPdfPlaywright(resume, themeName, outputBase) {
  const base = outputBase.replace(/\.docx$/i, "").replace(/\.pdf$/i, "");
  const pdfPath = `${base}.pdf`;
  const htmlPath = `${base}.tmp.html`;

  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  const html = renderHtml(resume, themeName);
  fs.writeFileSync(htmlPath, html, "utf-8");

  const renderer = path.join(__dirname, "render-pdf-playwright.mjs");
  try {
    execFileSync(
      process.execPath,
      [renderer, htmlPath, pdfPath, "--format=letter"],
      { stdio: "inherit" }
    );
  } finally {
    try { fs.unlinkSync(htmlPath); } catch { /* leave temp file on failure for debugging */ }
  }

  return pdfPath;
}

const MAX_RESUME_PAGES = 2;

/**
 * Count pages in a PDF by reading the file and counting /Type /Page entries
 * that are leaf pages (not /Type /Pages parent nodes). Falls back to pdfinfo
 * if the heuristic can't determine page count.
 */
function countPdfPages(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const text = buf.toString("binary");
  // Count /Type /Page (leaf pages) but not /Type /Pages (parent nodes)
  const matches = text.match(/\/Type\s*\/Page(?!s)\b/g);
  if (matches && matches.length > 0) {
    return matches.length;
  }
  // Fallback: try pdfinfo if available
  try {
    const result = execFileSync("pdfinfo", [pdfPath], { stdio: "pipe" }).toString();
    const line = result.split("\n").find(l => l.startsWith("Pages:"));
    if (line) return parseInt(line.split(":")[1].trim(), 10);
  } catch {
    // pdfinfo not available — skip page count check
  }
  return -1; // unknown
}

function parseCliArgs(argv) {
  const allowedFlags = new Set(["--pdf", "--validate-only"]);
  const flags = argv.filter(arg => arg.startsWith("--"));
  const positional = argv.filter(arg => !arg.startsWith("--"));
  const unknownFlags = flags.filter(flag => !allowedFlags.has(flag));
  if (unknownFlags.length) {
    throw new Error(`Unknown flag(s): ${unknownFlags.join(", ")}`);
  }
  if (positional.length < 3) {
    throw new Error("Usage: node build-resume.js <input.md> <theme-name> <output-name> [--pdf] [--validate-only]");
  }
  return {
    inputPath: positional[0],
    themeName: positional[1],
    outputName: positional[2],
    includePdf: flags.includes("--pdf"),
    validateOnly: flags.includes("--validate-only")
  };
}

async function main(argv = process.argv.slice(2)) {
  let cli;
  try {
    cli = parseCliArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error("Example: node build-resume.js resume.md executive-clean MyResume --pdf");
    return 1;
  }

  const { inputPath, themeName, outputName, includePdf, validateOnly } = cli;

  if (!THEMES[themeName]) {
    console.error(`Unknown theme: ${themeName}`);
    console.error(`Available themes: ${Object.keys(THEMES).join(", ")}`);
    return 1;
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    return 1;
  }

  const mdContent = fs.readFileSync(inputPath, "utf-8");
  const resume = parseResumeMd(mdContent);
  const errors = validateResume(resume);
  if (errors.length) {
    console.error("Resume markdown does not match the resume-factory spec:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }

  const resumeStats = emitWarnings(resume);

  console.log(`Validated: ${inputPath}`);
  if (validateOnly) {
    return 0;
  }

  const outputPath = outputName.endsWith(".docx") ? outputName : `${outputName}.docx`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const doc = buildDocx(resume, themeName);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  console.log(`Wrote DOCX: ${outputPath}`);

  if (includePdf) {
    const pdfPath = buildPdfPlaywright(resume, themeName, outputPath);
    const pages = countPdfPages(pdfPath);
    if (pages > MAX_RESUME_PAGES) {
      console.error(`WARNING: Resume is ${pages} pages (max ${MAX_RESUME_PAGES}).`);
      console.error(`  Roles: ${resumeStats.roleCount} | Bullets: ${resumeStats.totalBullets} | Target for 2 pages: ~18-20 bullets across 5-6 roles.`);
      return 1;
    }
    if (pages > 0) {
      console.log(`Page count: ${pages}`);
    }
  }

  return 0;
}

module.exports = {
  THEMES,
  SECTION_ORDER,
  REQUIRED_SECTIONS,
  DATE_PATTERN,
  MAX_ACHIEVEMENT_ITEM_CHARS,
  MAX_BOLD_SPAN_WORDS,
  parseResumeMd,
  parseAchievementItem,
  parseAchievements,
  parseSkills,
  parseExperienceRoles,
  parseEducation,
  parseCertifications,
  splitH3Blocks,
  nonblankLines,
  parseBulletRuns,
  achievementDisplayLength,
  countWords,
  looksLikeMetricText,
  normalizeBoldRuns,
  validateResume,
  validateAchievements,
  validateExperience,
  validateExperienceBoldMarkers,
  validateEducation,
  getResumeStats,
  emitWarnings,
  buildDocx,
  renderHtml,
  buildPdfPlaywright,
  countPdfPages,
  MAX_RESUME_PAGES,
  parseCliArgs,
  main
};

if (require.main === module) {
  main().then(code => process.exit(code)).catch(error => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
