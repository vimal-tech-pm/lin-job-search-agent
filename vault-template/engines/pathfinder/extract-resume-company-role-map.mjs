#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { load as loadYaml } from 'js-yaml';

const root = process.cwd();
const cvPath = resolve(root, 'cv.md');
const profilePath = resolve(root, 'config/profile.yml');
const outputPath = resolve(root, 'output/resume-company-role-map.md');

const cv = await readFile(cvPath, 'utf8');
const profile = await readProfile(profilePath);
const mappingConfig = profile.resume_mapping ?? {};
const shouldSwapWorkArrangements = mappingConfig.swap_when_company_is_work_arrangement !== false;
const workArrangementCompanyLabels = mappingConfig.work_arrangement_companies ?? [];
const workArrangementCompanies = new Set(
  workArrangementCompanyLabels
    .map((value) => normalizeKey(String(value)))
    .filter(Boolean)
);

const entries = parseExperience(cv).map((entry) => {
  if (
    shouldSwapWorkArrangements &&
    workArrangementCompanies.has(normalizeKey(entry.company))
  ) {
    return {
      ...entry,
      company: entry.role,
      role: entry.company,
    };
  }

  return entry;
});

const output = [
  '# Resume Company Role Map',
  '',
  'Source: `cv.md`',
  '',
  mappingRuleText(),
  '',
  '| # | Company | Role | Dates | Location |',
  '|---|---------|------|-------|----------|',
  ...entries.map((entry, index) => {
    return `| ${index + 1} | ${cell(entry.company)} | ${cell(entry.role)} | ${cell(entry.dates)} | ${cell(entry.location)} |`;
  }),
  '',
].join('\n');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, 'utf8');
console.log(`Wrote ${outputPath}`);

async function readProfile(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return loadYaml(raw) ?? {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function parseExperience(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## PROFESSIONAL EXPERIENCE');

  if (start === -1) return [];

  const entries = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith('## ') && line !== '## PROFESSIONAL EXPERIENCE') break;
    if (!line.startsWith('### ')) continue;

    const heading = line.slice(4).trim();
    const [role, dates = ''] = splitOnce(heading, '|').map((part) => normalizeText(part));
    const metaLine = nextContentLine(lines, index + 1);
    const [company, location = ''] = parseCompanyLine(metaLine).map((part) => normalizeText(part));

    entries.push({ company, role, dates, location });
  }

  return entries;
}

function parseCompanyLine(line) {
  const clean = line.trim().replace(/^\*+|\*+$/g, '').trim();
  return splitOnce(clean, '|');
}

function nextContentLine(lines, start) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim()) return lines[index];
  }
  return '';
}

function splitOnce(value, separator) {
  const index = value.indexOf(separator);
  if (index === -1) return [value.trim()];
  return [value.slice(0, index).trim(), value.slice(index + separator.length).trim()];
}

function normalizeText(value) {
  return value
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mappingRuleText() {
  if (!shouldSwapWorkArrangements || workArrangementCompanies.size === 0) {
    return 'Mapping rule: role comes from each `###` heading; company comes from the italic line below it.';
  }

  const labels = workArrangementCompanyLabels.join(', ');
  return `Mapping rule: role comes from each \`###\` heading; company comes from the italic line below it. If the extracted company is a configured work-arrangement label (${labels}), the row is swapped.`;
}

function cell(value) {
  return normalizeText(value).replace(/\|/g, '\\|');
}
