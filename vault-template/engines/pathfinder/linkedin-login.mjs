#!/usr/bin/env node

/**
 * linkedin-login.mjs — LinkedIn session authenticator
 *
 * Reads credentials from environment variables, logs into LinkedIn using
 * Playwright, and saves the browser session so subsequent runs (and the
 * apply mode) can reuse it without prompting for credentials again.
 *
 * Handles 2FA interactively: if LinkedIn shows a verification challenge,
 * the user completes it in the visible browser window, then presses Enter
 * in the terminal to continue.
 *
 * Usage:
 *   npm run linkedin-login            # uses .env file automatically
 *   node --env-file=.env linkedin-login.mjs
 *   node --env-file=.env linkedin-login.mjs --force   # ignore saved session
 *
 * Required environment variables (in .env):
 *   LINKEDIN_EMAIL     Your LinkedIn email address
 *   LINKEDIN_PASSWORD  Your LinkedIn password
 *
 * Session state saved to: .linkedin-session/storageState.json
 */

import { chromium } from 'playwright';
import { mkdir, writeFile, access, readFile } from 'fs/promises';
import { constants } from 'fs';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env file manually (compatible with all Node versions)
const __envPath = resolve(dirname(fileURLToPath(import.meta.url)), '.env');
try {
  const envContent = await readFile(__envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env not found — credentials must come from environment directly
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR  = resolve(__dirname, '.linkedin-session');
const SESSION_FILE = resolve(SESSION_DIR, 'storageState.json');

const LINKEDIN_LOGIN_URL = 'https://www.linkedin.com/login';
const LINKEDIN_FEED_URL  = 'https://www.linkedin.com/feed/';

const AUTHENTICATED_PATTERNS = [/\/feed\//, /\/mynetwork\//, /\/jobs\//, /\/messaging\//];
const CHALLENGE_PATTERNS      = [/\/checkpoint\//, /\/challenge\//, /\/verification\//];

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isAuthenticated(url) {
  return AUTHENTICATED_PATTERNS.some(p => p.test(url));
}

function isChallenge(url) {
  return CHALLENGE_PATTERNS.some(p => p.test(url));
}

async function waitForEnter(message) {
  console.log(`\n${message}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('Press Enter when done... ', resolve));
  rl.close();
}

async function saveSession(context) {
  await mkdir(SESSION_DIR, { recursive: true });
  const state = await context.storageState();
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
  console.log('Session saved to .linkedin-session/storageState.json');
}

async function linkedinLogin() {
  const email    = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  const force    = process.argv.includes('--force');

  // Validate credentials are set
  if (!email || !password) {
    console.error('Error: LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set.');
    console.error('');
    console.error('Setup:');
    console.error('  cp .env.example .env');
    console.error('  # edit .env with your LinkedIn credentials');
    console.error('  npm run linkedin-login');
    process.exit(1);
  }

  // Try reusing saved session (unless --force)
  if (!force && await fileExists(SESSION_FILE)) {
    console.log('Found saved session, checking if still valid...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: SESSION_FILE });
    const page    = await context.newPage();

    await page.goto(LINKEDIN_FEED_URL, { waitUntil: 'domcontentloaded' });
    const url = page.url();
    await browser.close();

    if (isAuthenticated(url)) {
      console.log('Session is still valid. No login needed.');
      console.log('Run with --force to re-authenticate anyway.');
      return;
    }

    console.log('Session expired. Starting fresh login...');
  }

  // Fresh login with visible browser (avoids bot detection)
  console.log('Opening LinkedIn login...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  await page.goto(LINKEDIN_LOGIN_URL, { waitUntil: 'domcontentloaded' });

  // Fill credentials with realistic pacing
  await page.waitForSelector('#username', { timeout: 10000 });
  await page.type('#username', email,    { delay: 80 });
  await page.waitForTimeout(400 + Math.random() * 300);
  await page.type('#password', password, { delay: 80 });
  await page.waitForTimeout(300 + Math.random() * 200);

  // Submit — try stable data attribute first, fall back to type=submit
  const submitBtn = page.locator('[data-litms-control-urn="login-submit"]').first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
  } else {
    await page.click('button[type="submit"]');
  }

  // Poll for authenticated state or 2FA challenge (up to 120s)
  let authenticated = false;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const url = page.url();

    if (isAuthenticated(url)) {
      authenticated = true;
      break;
    }

    if (isChallenge(url)) {
      await waitForEnter(
        'LinkedIn is showing a verification challenge.\n' +
        'Complete it in the browser window (SMS code, CAPTCHA, etc.).'
      );
      // After user confirms, check one more time
      const postUrl = page.url();
      if (isAuthenticated(postUrl)) {
        authenticated = true;
      }
      break;
    }
  }

  if (!authenticated) {
    console.error('Login timed out or failed. Please check your credentials and try again.');
    await browser.close();
    process.exit(1);
  }

  await saveSession(context);
  await browser.close();
  console.log('Done. LinkedIn session is ready for use with the apply mode.');
}

linkedinLogin().catch(err => {
  console.error('LinkedIn login failed:', err.message);
  process.exit(1);
});
