#!/usr/bin/env node
// The judge for census: deterministic metrics, measured the same way in CI and locally. Ported from labit's gate.
//
//   collect <out.json>                          measure the current tree (built, with its node_modules)
//   compare <current.json> <reference.json>     exit 1 if the gate fails
//   types                                       list TypeScript errors with the judge's pinned TypeScript
//
// Fails closed: if a tool can't run, that's an error, never "0 problems".
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const OXLINT = "oxlint@1.93.0"; // pinned, so the count only changes when the code or the rules do
const TYPES = ["typescript@5.9.3", "@types/node@22.20.5"]; // pinned for the same reason, whatever package.json says
const LINTED = "src cli"; // what we write; dist/ is generated, test/ is fixtures
const TSCONFIGS = ["tsconfig.json", "tsconfig.cli.json"]; // src (strict TypeScript) and cli (its JavaScript, checked)
const PAGE_SCRIPT = "dist/census.js"; // what a capture puts in every page it reads

// ratchet: may never get worse. budget: may grow by perPr per PR, never past max.
// ALLOW_GROWTH=1 (the size-approved label) lifts perPr; raising max means editing this file.
const METRICS = {
  pageScriptGzipBytes: {
    kind: "budget", dir: "down", perPr: 2048, max: 48_000,
    hint: "Shrink what src/browser.ts bundles without changing what it reports: remove dead code and duplication.",
  },
  npmPackBytes: {
    kind: "budget", dir: "down", perPr: 4096, max: 140_000,
    hint: "Shrink the published package (npm pack): remove dead code from the shipped files.",
  },
  oxlintProblems: {
    kind: "ratchet", dir: "down", ideal: 0,
    hint: `Fix oxlint problems (npx --yes ${OXLINT} ${LINTED}), starting with the file that has the most.`,
  },
  typeErrors: {
    kind: "ratchet", dir: "down", ideal: 0,
    hint: "Fix TypeScript errors (node ci/metrics.mjs types lists them). In cli/, with JSDoc types.",
  },
  runtimeDependencies: {
    kind: "ratchet", dir: "down", ideal: 0,
    hint: "census promises no runtime dependencies. Remove the new one, or decide to drop the promise.",
  },
};

const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const write = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + "\n");
const fail = (msg) => { console.error(msg); process.exit(2); };
function run(cmd) {
  try {
    return { out: execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), err: "", status: 0 };
  } catch (e) {
    return { out: e.stdout ?? "", err: e.stderr ?? "", status: e.status ?? 1 };
  }
}

// Pinned TypeScript, installed once into a temp folder, so a PR can't change the judge by changing its own copy.
function typeCheck() {
  const dir = join(tmpdir(), `census-ci-${TYPES.join("_").replace(/[^\w.-]/g, "-")}`);
  const tsc = join(dir, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tsc)) {
    const i = run(`npm install --prefix "${dir}" --no-save --no-audit --no-fund --silent ${TYPES.join(" ")}`);
    if (!existsSync(tsc)) fail(`could not install ${TYPES.join(", ")}:\n${i.err}`);
  }
  let all = "";
  for (const cfg of TSCONFIGS.filter((c) => existsSync(c))) {
    const r = run(`node "${tsc}" -p ${cfg} --noEmit --pretty false --typeRoots "${join(dir, "node_modules", "@types")}"`);
    // tsc exits 2 when it finds errors; anything without error lines but a failure is a broken setup
    if (r.status !== 0 && !/error TS\d+/.test(r.out)) fail(`TypeScript did not run on ${cfg}:\n${r.out}${r.err}`);
    if (/error TS(2688|5\d{3}|6\d{3}):/.test(r.out)) fail(`TypeScript setup is broken (${cfg}):\n${r.out.split("\n").filter((l) => /error TS(2688|5\d{3}|6\d{3})/.test(l)).join("\n")}`);
    all += r.out;
  }
  return all;
}

function collect() {
  const m = {};
  if (!existsSync(PAGE_SCRIPT)) fail(`${PAGE_SCRIPT} is missing: build the tree first (npm ci runs the build)`);
  m.pageScriptGzipBytes = gzipSync(readFileSync(PAGE_SCRIPT), { level: 9 }).length;
  // what npm users download: the tree is built already, so pack without running the build again
  const pack = run("npm pack --dry-run --json --ignore-scripts");
  let packInfo;
  try { packInfo = JSON.parse(pack.out)[0]; } catch { fail(`npm pack did not run:\n${pack.err}`); }
  m.npmPackBytes = packInfo.size;
  m.npmPackFiles = packInfo.entryCount; // informational
  const pkg = read("package.json");
  m.runtimeDependencies = ["dependencies", "optionalDependencies", "peerDependencies"]
    .reduce((n, k) => n + Object.keys(pkg[k] ?? {}).length, 0);
  // oxlint, one line per diagnostic in unix format
  const ox = run(`npx --yes ${OXLINT} ${LINTED} --format unix`);
  const oxCount = ox.out.split("\n").filter((l) => /^.+:\d+:\d+: /.test(l)).length;
  if (ox.status !== 0 && oxCount === 0) fail(`oxlint did not run cleanly:\n${ox.out}${ox.err}`);
  m.oxlintProblems = oxCount;
  m.typeErrors = typeCheck().split("\n").filter((l) => /error TS\d+/.test(l)).length;
  return m;
}

const isBetter = (name, cur, ref) => (METRICS[name].dir === "down" ? cur < ref : cur > ref);
// null if the metric passes the gate, or the reason it fails
function gateProblem(name, cur, ref) {
  const def = METRICS[name];
  if (cur === undefined) return "missing";
  if (def.kind === "ratchet") return isBetter(name, ref, cur) ? `worse than ${ref}` : null;
  if (cur > def.max) return `over the hard cap of ${def.max}`;
  if (process.env.ALLOW_GROWTH !== "1" && cur > ref + def.perPr) return `grew ${cur - ref}, budget is +${def.perPr} per PR`;
  return null;
}

function compare(curFile, refFile) {
  const cur = read(curFile), ref = read(refFile);
  let ok = true;
  console.log("| metric | base | this PR | verdict |\n|---|---|---|---|");
  for (const name of Object.keys(METRICS)) {
    if (!(name in ref)) continue;
    const c = cur[name], problem = gateProblem(name, c, ref[name]);
    let verdict;
    if (problem) { verdict = `**FAIL**: ${problem}`; ok = false; }
    else if (isBetter(name, c, ref[name])) verdict = "better";
    else if (c === ref[name]) verdict = "same";
    else if (c - ref[name] > (METRICS[name].perPr ?? 0)) verdict = `approved growth (+${c - ref[name]})`;
    else verdict = `within budget (+${c - ref[name]})`;
    console.log(`| ${name} | ${ref[name]} | ${c ?? "missing"} | ${verdict} |`);
  }
  if (!ok) {
    console.log("\nTo fix:");
    for (const name of Object.keys(METRICS)) if (name in ref && gateProblem(name, cur[name], ref[name])) console.log(`- ${name}: ${METRICS[name].hint}`);
  }
  if (process.env.ALLOW_GROWTH === "1") console.log("\nPer-PR growth budgets lifted by the size-approved label. Hard caps still apply.");
  process.exit(ok ? 0 : 1);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "collect": write(args[0] ?? fail("usage: collect <out.json>"), collect()); break;
  case "compare": compare(args[0] ?? fail("usage: compare <current.json> <reference.json>"), args[1] ?? fail("usage: compare <current.json> <reference.json>")); break;
  case "types": { const out = typeCheck(); process.stdout.write(out || "No type errors.\n"); process.exit(/error TS\d+/.test(out) ? 1 : 0); }
  default: fail("commands: collect | compare | types");
}
