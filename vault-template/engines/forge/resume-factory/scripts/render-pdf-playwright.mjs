#!/usr/bin/env node

/**
 * render-pdf-playwright.mjs — HTML → PDF via headless Chromium (Playwright)
 *
 * Usage:
 *   node resume-factory/scripts/render-pdf-playwright.mjs <input.html> <output.pdf> [--format=letter|a4]
 *
 * This is the ONLY supported PDF engine for resume-factory. If Playwright
 * or its Chromium browser is missing, the script exits 1 with a one-line
 * install instruction. There is no fallback: a silent downgrade to a
 * lower-fidelity engine would hide quality regressions from the user.
 *
 * The `normalizeTextForATS` helper is adapted from career-ops/generate-pdf.mjs
 * and strips em/en-dashes, smart quotes, zero-width chars, and NBSPs from
 * body text (preserving CSS, JS, tag attributes, and URLs) for ATS safety.
 */

import { resolve, dirname, join } from 'path';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const INSTALL_HINT =
  'PDF generation requires Playwright + Chromium. Run: ' +
  'npm install --prefix resume-factory && npx --prefix resume-factory playwright install chromium';

/**
 * Normalize text for ATS compatibility by converting problematic Unicode.
 *
 * ATS parsers and legacy systems often fail on em-dashes, smart quotes,
 * zero-width characters, and non-breaking spaces. These cause mojibake,
 * parsing errors, or display issues.
 *
 * Only touches body text — preserves CSS, JS, tag attributes, and URLs.
 * Returns { html, replacements } so the caller can log what was changed.
 */
function normalizeTextForATS(html) {
  const replacements = {};
  const bump = (key, n) => { replacements[key] = (replacements[key] || 0) + n; };

  const masks = [];
  const masked = html.replace(
    /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (match) => {
      const token = `\u0000MASK${masks.length}\u0000`;
      masks.push(match);
      return token;
    }
  );

  let out = '';
  let i = 0;
  while (i < masked.length) {
    const lt = masked.indexOf('<', i);
    if (lt === -1) { out += sanitizeText(masked.slice(i)); break; }
    out += sanitizeText(masked.slice(i, lt));
    const gt = masked.indexOf('>', lt);
    if (gt === -1) { out += masked.slice(lt); break; }
    out += masked.slice(lt, gt + 1);
    i = gt + 1;
  }

  const restored = out.replace(/\u0000MASK(\d+)\u0000/g, (_, n) => masks[Number(n)]);
  return { html: restored, replacements };

  function sanitizeText(text) {
    if (!text) return text;
    let t = text;
    t = t.replace(/\u2014/g, () => { bump('em-dash', 1); return '-'; });
    t = t.replace(/\u2013/g, () => { bump('en-dash', 1); return '-'; });
    t = t.replace(/[\u201C\u201D\u201E\u201F]/g, () => { bump('smart-double-quote', 1); return '"'; });
    t = t.replace(/[\u2018\u2019\u201A\u201B]/g, () => { bump('smart-single-quote', 1); return "'"; });
    t = t.replace(/\u2026/g, () => { bump('ellipsis', 1); return '...'; });
    t = t.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, () => { bump('zero-width', 1); return ''; });
    t = t.replace(/\u00A0/g, () => { bump('nbsp', 1); return ' '; });
    return t;
  }
}

async function loadPlaywright() {
  try {
    const mod = await import('playwright');
    return mod.chromium;
  } catch (err) {
    console.error(`ERROR: Playwright is not installed.\n${INSTALL_HINT}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  let inputPath, outputPath, format = 'letter';
  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node render-pdf-playwright.mjs <input.html> <output.pdf> [--format=letter|a4]');
    process.exit(1);
  }

  const validFormats = ['letter', 'a4'];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format "${format}". Use: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  let html = await readFile(inputPath, 'utf-8');

  // Rewrite ./fonts/* references to absolute file:// URLs so Chromium can load them.
  const fontsDir = resolve(__dirname, '..', 'fonts');
  const fontsBaseUrl = `${pathToFileURL(fontsDir).href}/`;
  html = html.replace(
    /url\(['"]?\.\/fonts\/([^'")]+)['"]?\)/g,
    (_, fileName) => `url('${fontsBaseUrl}${fileName}')`
  );

  // ATS Unicode normalization.
  const normalized = normalizeTextForATS(html);
  html = normalized.html;
  const totalReplacements = Object.values(normalized.replacements).reduce((a, b) => a + b, 0);
  if (totalReplacements > 0) {
    const breakdown = Object.entries(normalized.replacements).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`ATS normalization: ${totalReplacements} replacements (${breakdown})`);
  }

  const chromium = await loadPlaywright();

  let browser;
  let renderDir;
  try {
    renderDir = await mkdtemp(join(tmpdir(), 'resume-pdf-'));
    const renderPath = join(renderDir, 'index.html');
    await writeFile(renderPath, html, 'utf-8');

    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      throw new Error(`Chromium could not be launched.\n${INSTALL_HINT}\nUnderlying error: ${err.message}`);
    }

    const page = await browser.newPage();
    await page.goto(pathToFileURL(renderPath).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: '0.40in',
        right: '0.50in',
        bottom: '0.40in',
        left: '0.50in',
      },
    });

    await writeFile(outputPath, pdfBuffer);

    // Approximate page count from PDF structure (same heuristic as build-resume.js countPdfPages).
    const pdfString = pdfBuffer.toString('latin1');
    const pageCount = (pdfString.match(/\/Type\s*\/Page(?!s)\b/g) || []).length;

    console.log(`Wrote PDF: ${outputPath}`);
    console.log(`Pages: ${pageCount}`);
    console.log(`Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (renderDir) await rm(renderDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(`PDF render failed: ${err.message}`);
  process.exit(1);
});
