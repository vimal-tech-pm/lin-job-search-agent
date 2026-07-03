/**
 * lib/canonical.mjs — the single definition of "the same job".
 *
 * Extracted from lin-discovery-append.mjs so every layer (discovery, promotion,
 * dashboard render, and the dedup backfill) keys identity the same way. Keeping
 * one source means a job can't be "the same" to the scanner but "different" to
 * the dashboard. Pure functions, no deps, no side effects.
 *
 *   canonicalKey(company, role)  → "instacart::senior-product-manager-retailer-platform"
 *   canonicalizeUrl(rawUrl)      → board-normalized URL string (id-stable)
 */

export function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Strip parenthetical location lists, trailing separators, collapse whitespace.
export function normalizeTitle(title) {
  return String(title ?? "")
    .replace(/\([^)]*\)/g, " ")        // "(San Francisco, CA | NYC)" → " "
    .replace(/\s+/g, " ")
    .replace(/[-–—,|]+\s*$/g, "")
    .trim()
    .toLowerCase();
}

export function canonicalKey(company, role) {
  return `${slugify(company)}::${slugify(normalizeTitle(role))}`;
}

// True when a canonical key carries real identity on BOTH sides. A key with an
// empty company or empty role ("::", "acme::", "::pm") must never be used to
// merge rows — callers fall back to per-row uniqueness instead.
export function hasCanonicalIdentity(key) {
  const [co, role] = String(key ?? "").split("::");
  return !!(co && role);
}

// Work-arrangement + geography vocabulary. A parenthetical built ONLY from these
// tokens is location noise (safe to drop); anything else is a meaningful qualifier
// that must be preserved when deciding identity for a DESTRUCTIVE merge.
// NOTE: deliberately EXCLUDES words that read as location in a phrase but as a
// meaningful qualifier when alone — "global", "office", "first", "time". On the
// destructive path it is safer to treat "(Global)" / "(Office)" / "(First)" as
// meaningful (→ leave distinct) than to risk merging two different roles.
const LOCATION_WORDS = new Set([
  "remote","hybrid","onsite","on","site","in","wfh","anywhere","worldwide",
  "flexible","optional","preferred","based","or","and","the","of","to",
  "us","usa","u","s","united","states","america","north","americas","canada","canadian",
  "uk","england","britain","ireland","emea","apac","latam","eu","europe","mexico",
  "ny","nyc","sf","la","dc","atx","bay","area",
  "toronto","ontario","vancouver","montreal","quebec","ottawa","calgary","waterloo",
  "london","dublin","berlin","paris","amsterdam","india","bengaluru","bangalore","singapore",
  "austin","seattle","boston","chicago","denver","portland","atlanta","dallas","houston",
  "miami","phoenix","raleigh","nashville","new","york","san","francisco","jose","angeles",
  "diego","los","california","texas","washington","oregon","colorado","massachusetts",
  "illinois","virginia","georgia","florida","arizona","carolina","ca","tx","wa","co","ma",
  "il","va","ga","fl","az","nc","bc","ab","qc","zones","est","pst","cst","gmt","utc",
]);

// A parenthetical is "location only" when every word in it is location/arrangement
// vocabulary (e.g. "(Remote)", "(Remote - Canada)", "(San Francisco, CA)"). Empty
// parens count as location-only. Anything with a non-location word ("(AI Builder)",
// "(Practice Nexus)", "(Growth)") is meaningful and returns false.
export function isLocationOnly(inner) {
  const tokens = String(inner ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((t) => LOCATION_WORDS.has(t));
}

// Strict identity for the DESTRUCTIVE backfill: like canonicalKey but only LOCATION
// parentheticals are dropped — meaningful qualifiers stay in the key, so
// "Staff PM (AI Builder)" and "Staff PM" do NOT collapse, while
// "Sr PM (Remote)" and "Sr PM" do.
export function strictTitleKey(title) {
  const kept = String(title ?? "").replace(/\(([^)]*)\)/g, (_m, inner) =>
    isLocationOnly(inner) ? " " : ` ${inner} `);
  return slugify(kept);
}

// Source-specific canonical URL. The board is detected from the URL itself so
// old rows (whose source we don't know) canonicalize identically to new ones.
// Indeed → jk= job key; LinkedIn → /jobs/view/<id>; Greenhouse/Lever/Ashby and
// everything else → host+path with query/hash dropped (their id lives in path).
export function canonicalizeUrl(rawUrl) {
  const s = String(rawUrl ?? "").trim();
  if (!s) return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    // Not a parseable URL — fall back to a trimmed lowercase string.
    return s.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  if (host.includes("indeed.")) {
    const jk = u.searchParams.get("jk") || /\/viewjob\/([A-Za-z0-9]+)/.exec(u.pathname)?.[1];
    if (jk) return `indeed.com/viewjob?jk=${jk}`;
  }
  if (host.includes("linkedin.")) {
    const id =
      /\/jobs\/view\/(\d+)/.exec(u.pathname)?.[1] ||
      u.searchParams.get("currentJobId");
    if (id) return `linkedin.com/jobs/view/${id}`;
  }
  // Greenhouse: collapse boards.greenhouse.io / job-boards.greenhouse.io.
  let normHost = host.replace(/^job-boards\.greenhouse\.io$/, "boards.greenhouse.io");
  const cleanPath = u.pathname.replace(/\/+$/, "");
  return `${normHost}${cleanPath}`.toLowerCase();
}
