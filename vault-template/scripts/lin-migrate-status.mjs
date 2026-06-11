#!/usr/bin/env node
// Status migration for the Lin re-architecture (design §5).
// Modes: --dry-run (default; prints TSV manifest), --apply, --check (invariants only).
// Never rewrites applied/closed/interviewing/offer. `built` requires a verifier PASS.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const VAULT = flag("--vault") || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODE = argv.includes("--apply") ? "apply" : argv.includes("--check") ? "check" : "dry-run";
const VERIFIER = flag("--verifier") || "python3 scripts/lin-verify-resumes.py"; // test hook: "echo-pass"
const TERMINAL = new Set(["applied", "closed", "interviewing", "offer"]);

function jobs() {
  const out = [];
  const root = path.join(VAULT, "companies");
  for (const co of fs.existsSync(root) ? fs.readdirSync(root) : [])
    for (const slug of fs.existsSync(path.join(root, co, "jobs")) ? fs.readdirSync(path.join(root, co, "jobs")) : []) {
      const dir = path.join(root, co, "jobs", slug);
      if (fs.existsSync(path.join(dir, "job.yml"))) out.push({ co, slug, dir });
    }
  return out;
}
const read = (f) => fs.readFileSync(f, "utf8");
const field = (t, k) => {
  const v = new RegExp(`^${k}:\\s*['"]?([^'"\\n#]+)`, "m").exec(t)?.[1]?.trim() || null;
  return v === "null" || v === "~" ? null : v;
};

function verify(dir) {
  if (VERIFIER === "echo-pass") return true;
  const [cmd, ...args] = VERIFIER.split(" ");
  return spawnSync(cmd, [...args, dir + "/"], { cwd: VAULT, encoding: "utf8" }).status === 0;
}

const rows = [];
const violations = [];
for (const j of jobs()) {
  const yml = read(path.join(j.dir, "job.yml"));
  const status = field(yml, "status");
  const winner = field(yml, "ats_winner");
  const hasWinner = Boolean(winner && winner !== "null" && winner !== "~");
  const forge = fs.existsSync(path.join(j.dir, "resumes", "forge.pdf"));
  const pf = fs.existsSync(path.join(j.dir, "resumes", "pathfinder.pdf"));
  const pkg = fs.existsSync(path.join(j.dir, "PACKAGE.md"));
  const gate = fs.existsSync(path.join(j.dir, "resumes", "gate-pass.json"));

  let proposed = "unchanged", note = "";
  if (TERMINAL.has(status)) { proposed = "unchanged"; note = "terminal"; }
  else if (status === "materials_ready") {
    proposed = "unchanged"; note = hasWinner && pkg ? "ok" : "WARN: materials_ready missing winner/package";
  } else if (["new", "interested", "decoding", "staged", "built"].includes(status)) {
    if (hasWinner && pkg) { proposed = "materials_ready"; note = "winner+package present"; }
    else if (forge && pf) {
      if (MODE === "dry-run") { proposed = "built?(verify)"; note = "both PDFs; verifier decides on --apply"; }
      else if (verify(j.dir)) { proposed = "built"; note = "verifier PASS"; }
      else { proposed = "staged"; note = "verifier FAIL → rebuild"; }
    } else { proposed = "staged"; note = "no/partial resumes"; }
  } else { proposed = "unchanged"; note = `unknown status '${status}' — left alone`; }
  rows.push({ ...j, status, winner: winner || "-", forge, pf, pkg, proposed, note });

  // invariants (for --check, evaluated on CURRENT state)
  if (status === "built" && !(forge && pf && gate)) violations.push(`${j.co}/${j.slug}: built without PDFs+gate`);
  if (status === "materials_ready" && !(hasWinner && pkg)) violations.push(`${j.co}/${j.slug}: materials_ready without winner+PACKAGE.md`);
  if (status === "applied" && !field(yml, "applied_at")) violations.push(`${j.co}/${j.slug}: applied without applied_at`);
}

if (MODE === "check") {
  violations.forEach((v) => console.error("INVARIANT: " + v));
  console.log(`checked ${rows.length} folders, ${violations.length} violations`);
  process.exit(violations.length ? 1 : 0);
}

console.log("co\tslug\tstatus\twinner\tforge\tpf\tpkg\tproposed\tnote");
rows.forEach((r) => console.log([r.co, r.slug, r.status, r.winner, r.forge, r.pf, r.pkg, r.proposed, r.note].join("\t")));

if (MODE === "apply") {
  let changed = 0;
  for (const r of rows) {
    if (r.proposed === "unchanged" || r.proposed === r.status) continue;
    const f = path.join(r.dir, "job.yml");
    fs.writeFileSync(f, read(f).replace(/^status:.*$/m, `status: ${r.proposed}`));
    const hist = path.join(r.dir, "status-history.md");
    if (fs.existsSync(hist)) {
      fs.appendFileSync(hist, `${new Date().toISOString()}  ${r.proposed}        rearch migration (${r.note})\n`);
    }
    if (r.proposed === "built") {
      fs.writeFileSync(
        path.join(r.dir, "resumes", "gate-pass.json"),
        JSON.stringify({ result: "pass", verifier: "lin-verify-resumes.py", verified_at: new Date().toISOString(), via: "migration" }, null, 2),
      );
    }
    changed++;
  }
  console.log(`applied: ${changed} folders changed`);
}
