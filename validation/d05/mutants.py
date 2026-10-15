#!/usr/bin/env python3
"""D05 mutation harness: do the PR #65 tests reject plausible wrong D05 implementations?

For the reference and for each mutant this script:
  1. makes its own detached scratch worktree of the pinned tests head BASE (0456fec),
     applies reference.diff and symlinks the repo's node_modules (run `npm ci` first);
  2. applies the mutant's small edit to PRODUCTION code only (anything under evals/ is
     refused, so the tests being judged are never touched);
  3. runs `node evals/discovery-readiness.mjs` and `npm run evals`;
  4. records whether any check fails that passes on the reference (rejected=true) and which;
  5. restores the reference files, checks `git diff` is byte-identical to the reference diff,
     reruns discovery-readiness on the restored tree, and removes the worktree.

The reference must pass discovery-readiness READINESS_COUNT/READINESS_COUNT (64 at 0456fec) and
all suites, or the run aborts. A mutant is rejected when discovery-readiness fails, when any suite
that passes on the reference does not pass, or when any suite shows a FAIL label the reference does not.

Usage:  python3 validation/d05/mutants.py [-j N] [--only ID,ID] [--keep] [--manifest]
Env:    FORGE (repo root; default: this checkout), BASE (default: the pinned SHA below),
        SCRATCH (default: a new temp dir), OUT (default: results.json beside this script).
Never pushes; never touches the checkout's branches (worktrees are detached and removed).
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, threading, time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
FORGE = os.environ.get("FORGE") or subprocess.run(["git", "-C", HERE, "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
BASE = os.environ.get("BASE", "0456fecfb37bec91ffe109df0561c58577cea330")
REF_DIFF = os.path.join(HERE, "reference.diff")
OUT = os.environ.get("OUT", os.path.join(HERE, "results.json"))
SCRATCH = os.environ.get("SCRATCH") or tempfile.mkdtemp(prefix="d05-mutants-")
READINESS_COUNT = int(os.environ.get("READINESS_COUNT", "64"))

REC = "discovery/record/index.mjs"
EXP = "discovery/export/index.mjs"
STO = "discovery/stories/index.mjs"
DES = "discovery/design/index.mjs"
PRO = "discovery/prototype/index.mjs"

# Reference lines the mutants edit (exact text in the reference).
GAP = "  const gap = agreementGap(prd, proto);\n"
AGR = '  if (gap) f(gap.rule, prd.id,'
STALE_S = 'if (badge.stories?.stale) f("stories-stale"'
STALE_D = 'if (badge.design?.stale && exit !== "team") f("design-stale"'
FIND = 'const f = (rule, subject, summary, evidence, remedy) => findings.push({ severity: "high", confidence: "certain", rule, subject, summary, evidence, remedy });'
JOIN = "  if (proto && stories && design) joins.push(checkDesign(proto, stories, design));"
EXH = "  const verdict = readinessOf({ prd, proto, stories, design, exit });"
KEY = 'createHash("sha256").update(saved).digest("hex").slice(0, 12)'
FS = 'import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";'
FS2 = 'import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";'
MKDIR = "  mkdirSync(join(root, HISTORY), { recursive: true });\n"
KEEP_S = '  keepOutgoing(root, "stories", STORIES_FILE);\n'
KEEP_D = '  keepOutgoing(root, "design", DESIGN_FILE);\n'
KEEP_P = '  keepOutgoing(root, "prototype", PROTOTYPE_FILE, HTML_FILE);\n'

S5, S7 = "design §5", "design §7"
M = [
 # ── the ready gate ──
 dict(id="A01", source=f"{S7} 'readiness ignores the prototype hash'",
      wrong_behavior="readiness counts an agreement to this PRD's hash as current whatever prototype it agreed to",
      patches=[(EXP, GAP, "  const gap = (prd.agreements ?? []).some((a) => a.prd_hash === prd.meta.content_hash) ? null : agreementGap(prd, proto);\n")]),
 dict(id="A02", source=f"{S5} table (stories-stale: 'trace another PRD or prototype'); task list",
      wrong_behavior="stories-stale compares only the PRD hash; a rebuilt prototype does not stale the stories",
      patches=[(EXP, STALE_S, 'if (badge.stories?.prd_moved) f("stories-stale"')]),
 dict(id="A20", source=f"{S5} table (stories-stale: 'trace another PRD or prototype')",
      wrong_behavior="stories-stale compares only the prototype hash; a moved PRD does not stale the stories",
      patches=[(EXP, STALE_S, 'if (badge.stories?.prototype_moved) f("stories-stale"')]),
 dict(id="A21", source=f"{S5} table (design-stale: 'traces other stories, prototype or PRD')",
      wrong_behavior="design-stale ignores the PRD trace (prototype and stories only)",
      patches=[(EXP, STALE_D, 'if ((badge.design?.prototype_moved || badge.design?.stories_moved) && exit !== "team") f("design-stale"')]),
 dict(id="A03", source=f"{S5} table (design-stale: 'traces other stories, prototype or PRD')",
      wrong_behavior="design-stale ignores the stories trace (PRD and prototype only)",
      patches=[(EXP, STALE_D, 'if ((badge.design?.prd_moved || badge.design?.prototype_moved) && exit !== "team") f("design-stale"')]),
 dict(id="A04", source=f"{S5} table (design-stale)",
      wrong_behavior="design-stale ignores the prototype trace (PRD and stories only)",
      patches=[(EXP, STALE_D, 'if ((badge.design?.prd_moved || badge.design?.stories_moved) && exit !== "team") f("design-stale"')]),
 dict(id="A05", source=f"{S5} 'Staleness compares content hashes only'; {S7} 'accepts unchanged ids as current'",
      wrong_behavior="stories/design freshness by version label: current while traces.prd.version equals the PRD's version",
      patches=[(EXP, STALE_S, 'if (stories && stories.traces.prd.version !== prd.meta.version) f("stories-stale"'),
               (EXP, STALE_D, 'if (design && design.traces.prd.version !== prd.meta.version && exit !== "team") f("design-stale"')]),
 dict(id="A06", source=f"{S5} 'Matching ids or labels never make an artifact current'",
      wrong_behavior="readiness matches an agreement by PRD version label instead of the PRD and prototype hashes",
      patches=[(EXP, GAP, "  const gap = (prd.agreements ?? []).some((a) => a.prd_version === prd.meta.version) ? null : agreementGap(prd, proto);\n")]),
 dict(id="A07", source=f"{S7} 'blocks the team exit on a stale design'",
      wrong_behavior="design-stale is reported for every exit, so a team cannot take a stale design",
      patches=[(EXP, STALE_D, 'if (badge.design?.stale) f("design-stale"')]),
 dict(id="A08", source=f"{S5} table ('only delivery and both')",
      wrong_behavior="design-stale blocks only delivery; the 'both' exit lets a stale design through",
      patches=[(EXP, STALE_D, 'if (badge.design?.stale && exit !== "team" && exit !== "both") f("design-stale"')]),
 dict(id="A09", source=f"{S5} table (Blocks column) — wiring",
      wrong_behavior="exportHandoff does not pass the exit to readinessOf, so a team is judged as Delivery",
      patches=[(EXP, EXH, "  const verdict = readinessOf({ prd, proto, stories, design });")]),
 dict(id="A10", source="reference observation 1 (readiness with no exit is unspecified by the design)",
      wrong_behavior="readiness(root) with no exit reads as the team's gate and omits design-stale",
      patches=[(EXP, STALE_D, 'if (badge.design?.stale && exit && exit !== "team") f("design-stale"')]),
 dict(id="A11", source=f"{S5} 'A stale design must still match, even for a team'",
      wrong_behavior="checkDesign is skipped for the team exit, so screen-undesigned no longer blocks a team",
      patches=[(EXP, JOIN, '  if (proto && stories && design && exit !== "team") joins.push(checkDesign(proto, stories, design));')]),
 dict(id="A12", source=f"{S5} 'Which agreement finding. It uses the same rule as write()'",
      wrong_behavior="readiness picks no-agreement whenever no agreement names this PRD hash (write() says agreement-stale)",
      patches=[(EXP, AGR, '  if (gap) f((prd.agreements ?? []).some((a) => a.prd_hash === prd.meta.content_hash) ? "agreement-stale" : "no-agreement", prd.id,')]),
 dict(id="A13", source=f"{S5} 'Each is high and certain'",
      wrong_behavior="freshness findings are medium severity (the verdict advises instead of blocking)",
      patches=[(EXP, FIND, FIND.replace('severity: "high"', 'severity: "medium"'))]),
 dict(id="A14", source=f"{S5} 'Each is high and certain'",
      wrong_behavior="freshness findings are high but only 'likely' (the verdict advises instead of blocking)",
      patches=[(EXP, FIND, FIND.replace('confidence: "certain"', 'confidence: "likely"'))]),
 dict(id="A15", source=f"{S5} 'its remedy names the next step'",
      wrong_behavior="every freshness remedy restates the problem (the summary) and names no next step",
      patches=[(EXP, FIND, FIND.replace("evidence, remedy });", "evidence, remedy: summary });"))]),
 dict(id="A16", source=f"{S5} table (remedy: 'rebuild the prototype if it traces an older PRD, then agree')",
      wrong_behavior="agreement remedy drops the rebuild step: 'Agree to the PRD and the prototype.'",
      patches=[(EXP, '"Rebuild the prototype if it traces an older PRD, then agree to the PRD and the prototype."', '"Agree to the PRD and the prototype."')]),
 dict(id="A17", source=f"{S5} table (When: 'a prototype exists and no agreement covers ...')",
      wrong_behavior="the agreement finding is raised only once stories exist; a prototype with no agreement and no stories reads as ready",
      patches=[(EXP, AGR, '  if (gap && stories) f(gap.rule, prd.id,')]),
 dict(id="A18", source=f"{S5} 'The one check is shared between the two'; {S7} 'ignores the prototype hash'",
      wrong_behavior="the shared agreement rule ignores the prototype hash (write() and readiness both accept an agreement to an older prototype)",
      patches=[(REC, "a.prd_hash === prd.meta.content_hash && a.prototype_hash === proto?.meta?.content_hash", "a.prd_hash === prd.meta.content_hash")]),
 dict(id="A19", source=f"{S5} table (agreement and stories rows block 'every exit')",
      wrong_behavior="a team exit skips the agreement and stories-stale checks too (team takes everything as it stands)",
      patches=[(EXP, GAP, '  const gap = exit === "team" ? null : agreementGap(prd, proto);\n'),
               (EXP, STALE_S, 'if (badge.stories?.stale && exit !== "team") f("stories-stale"')]),
 dict(id="A22", source=f"{S7} 'accepts unchanged ids as current'; {S5} 'Matching ids or labels never make an artifact current'",
      wrong_behavior="stories/design count as current while every screen id they reference still exists in the prototype (id joins, not hashes)",
      patches=[(EXP, STALE_S, 'if (badge.stories?.stale && stories.stories.some((s) => (s.screen_refs ?? []).some((r) => !proto.screens.some((p) => p.id === r)))) f("stories-stale"'),
               (EXP, STALE_D, 'if (badge.design?.stale && design.screens.some((s) => !proto.screens.some((p) => p.id === s.screen_ref)) && exit !== "team") f("design-stale"')]),
 dict(id="A23", source=f"{S5} 'Which agreement finding. It uses the same rule as write()'",
      wrong_behavior="readiness reports one code, agreement-stale, for every agreement gap (write() still says no-agreement when none was recorded)",
      patches=[(EXP, AGR, '  if (gap) f("agreement-stale", prd.id,')]),
 dict(id="A24", source=f"{S5} 'The one check is shared between the two' (write() side)",
      wrong_behavior="write() refuses agreement-stale for every gap, so the stories door and readiness disagree when no agreement was ever recorded",
      patches=[(STO, 'if (gap?.rule === "no-agreement") throw new Refused(gap.rule,', 'if (gap?.rule === "no-agreement") throw new Refused("agreement-stale",')]),
 dict(id="A25", source=f"{S5} 'carries the design marked stale'; 'a team takes a stale design as it stands'",
      wrong_behavior="a team export re-stamps the stale design's traces to the current record inside the handoff, hiding that it is stale",
      patches=[(EXP, "contract: compile(prd), prototype: proto, stories, design, items: [],",
                "contract: compile(prd), prototype: proto, stories, design: design && exit === \"team\" ? { ...design, traces: { prd: { version: prd.meta.version, content_hash: prd.meta.content_hash }, prototype: { content_hash: proto.meta.content_hash }, stories: { content_hash: stories.meta.content_hash } } } : design, items: [],")]),
 dict(id="A26", source=f"{S5} '`readinessOf()` gains findings' (the gate, not only the door)",
      wrong_behavior="freshness is checked only at the export door (an exit named); readiness(root), the console's gate view, omits it",
      patches=[(EXP, "  if (proto) joins.push(checkPrototype(prd, proto), checkFreshness({ prd, proto, stories, design, exit }));",
                "  if (proto) joins.push(checkPrototype(prd, proto));\n  if (proto && exit) joins.push(checkFreshness({ prd, proto, stories, design, exit }));")]),
 dict(id="A27", source=f"{S5} table (Subject: stories.id, design.id)",
      wrong_behavior="every freshness finding names prd.id as its subject, not the stale stories or design",
      patches=[(EXP, 'f("stories-stale", stories.id,', 'f("stories-stale", prd.id,'), (EXP, 'f("design-stale", design.id,', 'f("design-stale", prd.id,')]),
 dict(id="A28", source=f"{S5} table (design-stale remedy: 'regenerate the design')",
      wrong_behavior="design-stale remedy names the wrong next step: re-review and re-sign the design (a sign-off never changes its traces)",
      patches=[(EXP, '"Regenerate the design, then review and sign it."', '"Review the design again and sign it."')]),
 dict(id="A29", source=f"{S5} table (design-stale: 'the design traces other stories, prototype or PRD')",
      wrong_behavior="design-stale is keyed on the sign-off (signed on this exact version) instead of the design's traces",
      patches=[(EXP, STALE_D, 'if (badge.design && !badge.design.signed && exit !== "team") f("design-stale"')]),
 # ── the outgoing history ──
 dict(id="H01", source=f"{S7} 'a refresh destroys the old stories'",
      wrong_behavior="stories write keeps no history copy; a refresh destroys the old backlog",
      patches=[(STO, KEEP_S, ""), (STO, "freshVerdict, keepOutgoing, traceOf", "freshVerdict, traceOf")]),
 dict(id="H02", source=f"{S5} 'History. Before write or the design writer overwrites its record'",
      wrong_behavior="the design writer keeps no history copy",
      patches=[(DES, KEEP_D, ""), (DES, "freshVerdict, keepOutgoing, traceOf", "freshVerdict, traceOf")]),
 dict(id="H03", source=f"{S5} 'The key is the whole file, not the content hash'",
      wrong_behavior="history keyed by the document's content hash instead of the sha256 of the saved bytes",
      patches=[(REC, KEY, "JSON.parse(saved).meta.content_hash.slice(0, 12)"), (REC, 'import { createHash } from "node:crypto";\n', "")]),
 dict(id="H04", source=f"{S5} 'first 12 of the sha256'",
      wrong_behavior="history key uses the first 16 hex of the sha256, not 12",
      patches=[(REC, KEY, KEY.replace("slice(0, 12)", "slice(0, 16)"))]),
 dict(id="H05", source=f"{S5} 'sha256 of the saved file's bytes'",
      wrong_behavior="history copy is the record re-serialized as compact JSON, not the saved bytes",
      patches=[(REC, "  const saved = readFileSync(join(root, file));", '  const saved = Buffer.from(JSON.stringify(JSON.parse(readFileSync(join(root, file), "utf8"))));')]),
 dict(id="H06", source=f"{S5} 'copied as a pair before the builder call'",
      wrong_behavior="prototype JSON/HTML pair archived after the builder call, when the HTML is already overwritten",
      patches=[(PRO, KEEP_P, ""), (PRO, "  const target = resolve(root, HTML_FILE);", KEEP_P + "  const target = resolve(root, HTML_FILE);")]),
 dict(id="H07", source=f"{S5} 'the outgoing JSON and HTML are copied as a pair'",
      wrong_behavior="prototype history keeps the JSON only, not the HTML",
      patches=[(PRO, KEEP_P, '  keepOutgoing(root, "prototype", PROTOTYPE_FILE);\n')]),
 dict(id="H08", source=f"{S5} 'copied as a pair'; {S7} 'archived HTML matches the old record's file_hash'",
      wrong_behavior="the archived HTML is keyed by its own bytes rather than beside the record under the record's key",
      patches=[(REC, "copyFileSync(join(root, beside), join(root, `${key}${extname(beside)}`));",
                "copyFileSync(join(root, beside), join(root, HISTORY, `${kind}-${createHash(\"sha256\").update(readFileSync(join(root, beside))).digest(\"hex\").slice(0, 12)}${extname(beside)}`));")]),
 dict(id="H09", source=f"{S5} 'two refreshes ... keep both copies'; task list 'second refresh loses the first copy'",
      wrong_behavior="history keeps only the newest copy per kind; the second refresh deletes the first copy",
      patches=[(REC, FS, FS2), (REC, MKDIR, MKDIR + "  for (const f of readdirSync(join(root, HISTORY))) if (f.startsWith(`${kind}-`)) rmSync(join(root, HISTORY, f));\n")]),
 dict(id="H10", source=f"{S5} 'two refreshes ... keep both copies'",
      wrong_behavior="history keeps only the first copy per kind; later outgoing copies are dropped",
      patches=[(REC, FS, FS.replace("mkdirSync, ", "mkdirSync, readdirSync, ")), (REC, MKDIR, MKDIR + "  if (readdirSync(join(root, HISTORY)).some((f) => f.startsWith(`${kind}-`))) return key;\n")]),
 dict(id="H11", source="task list 'history copy overwrites an earlier copy with the same key' (equivalence probe)",
      wrong_behavior="a copy whose key already exists is never overwritten (reference overwrites); under whole-file keys the same key means the same bytes",
      patches=[(REC, "  writeFileSync(join(root, `${key}.json`), saved);", "  if (!existsSync(join(root, `${key}.json`))) writeFileSync(join(root, `${key}.json`), saved);")]),
 dict(id="H12", source=f"{S5} 'Before write ... overwrites its record, the outgoing file is copied'",
      wrong_behavior="stories history copy taken after saveDoc, so it archives the incoming backlog",
      patches=[(STO, KEEP_S + '  saveDoc(root, STORIES_FILE, "story", doc);\n', '  saveDoc(root, STORIES_FILE, "story", doc);\n' + KEEP_S)]),
 dict(id="H13", source=f"{S5} '<kind>' (unspecified; probe of test strictness)",
      wrong_behavior="stories history files are named by the schema id, discovery/history/story-<key>.json",
      patches=[(STO, KEEP_S, '  keepOutgoing(root, "story", STORIES_FILE);\n')]),
 dict(id="H14", source=f"{S5} 'two refreshes with equal content but different traces ... keep both copies'",
      wrong_behavior="stories history copy skipped when the backlog's content is unchanged (only traces moved)",
      patches=[(STO, KEEP_S, '  if (JSON.stringify(prior?.stories) !== JSON.stringify(doc.stories)) keepOutgoing(root, "stories", STORIES_FILE);\n')]),
 dict(id="H15", source=f"{S5} 'Before ... the design writer overwrites its record, the outgoing file is copied' (unconditional)",
      wrong_behavior="the design writer keeps the outgoing design only when it was signed; an unsigned draft is overwritten with no copy",
      patches=[(DES, KEEP_D, '  if (isSigned(prior)) keepOutgoing(root, "design", DESIGN_FILE);\n')]),
 dict(id="H16", source=f"{S5} 'Before write or the design writer overwrites its record, the outgoing file is copied' (unconditional)",
      wrong_behavior="stories and design keep the outgoing copy only when it is stale; a rewrite under the same PRD/prototype/stories loses the old one",
      patches=[(STO, KEEP_S, '  if (prior && (prior.traces.prd.content_hash !== prd.meta.content_hash || prior.traces.prototype?.content_hash !== proto.meta.content_hash)) keepOutgoing(root, "stories", STORIES_FILE);\n'),
               (DES, KEEP_D, '  if (prior && (prior.traces.prd.content_hash !== prd.meta.content_hash || prior.traces.prototype?.content_hash !== proto.meta.content_hash || prior.traces.stories?.content_hash !== stories.meta.content_hash)) keepOutgoing(root, "design", DESIGN_FILE);\n')]),
 dict(id="H17", source=f"{S5} 'Before ... the design writer overwrites its record, the outgoing file is copied'",
      wrong_behavior="design history copy taken after saveDoc, so it archives the incoming design",
      patches=[(DES, KEEP_D + '  saveDoc(root, DESIGN_FILE, "design", doc);\n', '  saveDoc(root, DESIGN_FILE, "design", doc);\n' + KEEP_D)]),
 dict(id="H18", source="task list 'history copy overwrites an earlier copy with the same key'",
      wrong_behavior="history keyed by kind only (discovery/history/<kind>.json), so every copy overwrites the one before",
      patches=[(REC, "${kind}-${" + KEY + "}", "${kind}")]),
]

ANSI = re.compile(r"\x1b\[[0-9;]*m")
GIT_LOCK = threading.Lock()
PRINT_LOCK = threading.Lock()


def sh(args, cwd=None, timeout=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def log(msg):
    with PRINT_LOCK:
        print(msg, flush=True)


def parse_suite_output(out):
    """Tally, PASS count, FAIL labels (with first detail line), and the error a throw left."""
    lines = ANSI.sub("", out).splitlines()
    tally = next((f"{m.group(1)}/{m.group(2)} passed" for l in lines if (m := re.match(r"^\s*(\d+)/(\d+) passed", l))), None)
    fails, details, passes = [], {}, 0
    for i, l in enumerate(lines):
        s = l.strip()
        if s.startswith("PASS "):
            passes += 1
        elif s.startswith("FAIL "):
            label = s[5:].strip()
            fails.append(label)
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if nxt.startswith("        ") and label not in details:
                details[label] = nxt.strip()[:240]
    error = None
    if tally is None:
        error = next((l.strip()[:240] for l in lines if re.search(r"\b(Error|TypeError|ReferenceError|Refused)\b", l)), "no tally")
        error = re.sub(r"forge-eval-[A-Za-z0-9]+", "forge-eval-*", error)  # temp roots differ per run
    return dict(tally=tally, passes=passes, fails=fails, details=details, error=error)


def run_readiness(wt):
    t0 = time.time()
    try:
        p = sh(["node", "evals/discovery-readiness.mjs"], cwd=wt, timeout=900)
        r = parse_suite_output(p.stdout + p.stderr)
        r["exit"] = p.returncode
    except subprocess.TimeoutExpired:
        r = dict(tally=None, passes=0, fails=[], details={}, error="TIMEOUT", exit=None)
    r["seconds"] = round(time.time() - t0, 1)
    return r


def run_evals(wt):
    t0 = time.time()
    try:
        p = sh(["npm", "run", "evals"], cwd=wt, timeout=2400)
    except subprocess.TimeoutExpired:
        return dict(summary="TIMEOUT", rows={}, seconds=round(time.time() - t0, 1))
    out = ANSI.sub("", p.stdout + p.stderr)
    rows = {}
    for l in out.splitlines():
        m = re.match(r"^\s{2}(PASS|FAIL|ABORT)\s{2}(\S+)\s+(.*?)\s+(\d+) ms\s*$", l)
        if m:
            rows[m.group(2)] = dict(status=m.group(1), note=m.group(3).strip(), ms=int(m.group(4)), passes=None, fails=[], error=None)
    # Failing suites' full output follows, each under "── <file>.mjs ──".
    parts = re.split(r"^\s*── (\S+)\.mjs ──\s*$", out, flags=re.M)
    for name, body in zip(parts[1::2], parts[2::2]):
        body = body.split("suites passed")[0]
        if name in rows:
            r = parse_suite_output(body)
            rows[name].update(passes=r["passes"], fails=r["fails"], details=r["details"], error=r["error"])
    summary = next((m.group(0) for l in out.splitlines() if (m := re.search(r"(\d+)/(\d+) suites passed", l))), "no summary")
    return dict(summary=summary, rows=rows, seconds=round(time.time() - t0, 1), exit=p.returncode)


def make_worktree(name):
    wt = os.path.join(SCRATCH, name)
    with GIT_LOCK:
        if os.path.exists(wt):
            sh(["git", "-C", FORGE, "worktree", "remove", "--force", wt])
        if os.path.exists(wt):
            shutil.rmtree(wt)
        sh(["git", "-C", FORGE, "worktree", "prune"])
        r = sh(["git", "-C", FORGE, "worktree", "add", "--detach", wt, BASE])
        if r.returncode:
            raise RuntimeError(f"worktree add failed: {r.stderr}")
    r = sh(["git", "apply", REF_DIFF], cwd=wt)
    if r.returncode:
        raise RuntimeError(f"reference diff did not apply: {r.stderr}")
    os.symlink(os.path.join(FORGE, "node_modules"), os.path.join(wt, "node_modules"))
    if sh(["git", "diff"], cwd=wt).stdout != open(REF_DIFF).read():
        raise RuntimeError("worktree diff is not the reference diff")
    return wt


def drop_worktree(wt):
    with GIT_LOCK:
        sh(["git", "-C", FORGE, "worktree", "remove", "--force", wt])
        if os.path.exists(wt):
            shutil.rmtree(wt)
        sh(["git", "-C", FORGE, "worktree", "prune"])


def apply(wt, patches):
    originals = {}
    for f, old, new in patches:
        if f.startswith("evals/") or "/evals/" in f:
            raise RuntimeError(f"refusing to edit a test file: {f}")
        path = os.path.join(wt, f)
        s = open(path).read()
        originals.setdefault(f, s)
        if s.count(old) != 1:
            raise RuntimeError(f"anchor occurs {s.count(old)} times in {f}: {old[:70]!r}")
        open(path, "w").write(s.replace(old, new))
    return originals


def run_one(m, keep=False):
    t0 = time.time()
    wt = make_worktree(f"d05-mut-{m['id']}")
    try:
        originals = apply(wt, m.get("patches", []))
        for f in originals:  # a mutant must load: a syntax error would "reject" for the wrong reason
            c = sh(["node", "--check", f], cwd=wt)
            if c.returncode:
                raise RuntimeError(f"mutant does not parse: {f}: {c.stderr.strip()[:200]}")
        changed = sh(["git", "diff", "--stat", "--", "evals"], cwd=wt).stdout.strip()
        if changed:
            raise RuntimeError(f"evals/ changed: {changed}")
        readiness = run_readiness(wt)
        evals = run_evals(wt)
        for f, s in originals.items():
            open(os.path.join(wt, f), "w").write(s)
        restored_diff = sh(["git", "diff"], cwd=wt).stdout == open(REF_DIFF).read()
        restored_readiness = run_readiness(wt)["tally"] if m.get("patches") else readiness["tally"]
    finally:
        if not keep:
            drop_worktree(wt)
    return dict(id=m["id"], readiness=readiness, evals=evals,
                restored=dict(diff_is_reference=restored_diff, readiness=restored_readiness),
                seconds=round(time.time() - t0, 1))


def judge(res, base):
    """Checks that pass on the reference and fail on the mutant."""
    failing = []
    rd = res["readiness"]
    if rd["error"] == "TIMEOUT":
        failing.append("discovery-readiness (standalone): TIMEOUT")
    for label in rd["fails"]:
        failing.append(f"discovery-readiness: {label}")
    if not rd["fails"] and rd["tally"] != f"{READINESS_COUNT}/{READINESS_COUNT} passed":
        failing.append(f"discovery-readiness: {rd['tally'] or 'ABORT'} ({rd['error']})")
    other = []
    if res["evals"]["summary"] == "TIMEOUT":
        other.append("npm run evals: TIMEOUT")
    for name, row in res["evals"]["rows"].items():
        if name == "discovery-readiness":
            continue  # judged above from its standalone run (npm run evals runs it too)
        b = base["evals"]["rows"].get(name)
        if not b:
            other.append(f"{name}: not in reference run")
            continue
        new = list((Counter(row["fails"]) - Counter(b["fails"])).elements())
        other += [f"{name}: {label}" for label in new]
        if new:
            continue
        if b["status"] == "PASS" and row["status"] != "PASS":
            other.append(f"{name}: PASS on reference -> {row['status']} ({row['note'] or row['error']})")
        elif row["status"] == "ABORT" and ((row["passes"] or 0) < (b["passes"] or 0) or row["error"] != b["error"]):
            other.append(f"{name}: aborts earlier or differently ({row['passes']} passes vs {b['passes']}; {row['error']})")
        # ABORT on the reference -> FAIL/PASS with no new FAIL label: the mutant got further
        # (e.g. an export the reference refuses goes through), which is not a rejection.
    rr = res["evals"]["rows"].get("discovery-readiness")
    gained = {name: list((Counter(b["fails"]) - Counter(res["evals"]["rows"].get(name, {}).get("fails", []))).elements())
              for name, b in base["evals"]["rows"].items() if b["fails"]}
    return failing + other, {k: v for k, v in gained.items() if v}, (rr or {}).get("note")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-j", type=int, default=3)
    ap.add_argument("--only", default="")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--manifest", action="store_true", help="print the mutant cases as JSON and exit")
    a = ap.parse_args()
    if a.manifest:
        json.dump([{k: v for k, v in m.items() if not callable(v)} for m in M], sys.stdout, indent=1, default=str)
        print()
        return
    if not os.path.isdir(os.path.join(FORGE, "node_modules")):
        sys.exit(f"{FORGE}/node_modules is missing: run `npm ci` in the repo first")
    os.makedirs(SCRATCH, exist_ok=True)
    head = sh(["git", "-C", FORGE, "rev-parse", BASE]).stdout.strip()
    todo = [m for m in M if not a.only or m["id"] in a.only.split(",")]

    log(f"base {BASE} = {head}; reference baseline first")
    base = run_one(dict(id="REF", patches=[]), keep=a.keep)
    log(f"REF  readiness [{base['readiness']['tally']}]  evals [{base['evals']['summary']}]  "
        + ", ".join(f"{n}={r['status']}" for n, r in base["evals"]["rows"].items() if r["status"] != "PASS")
        + f"  ({base['seconds']} s)")
    if base["readiness"]["tally"] != f"{READINESS_COUNT}/{READINESS_COUNT} passed":
        sys.exit("reference does not pass discovery-readiness; aborting")

    results = {}
    def work(m):
        try:
            r = run_one(m, keep=a.keep)
        except Exception as e:  # a harness failure is reported, never counted as a kill
            r = dict(id=m["id"], harness_error=str(e))
        results[m["id"]] = r
        if "harness_error" in r:
            log(f"ERROR     {m['id']}  {r['harness_error']}")
        else:
            failing, _, _ = judge(r, base)
            log(f"{'REJECTED' if failing else 'SURVIVED'}  {m['id']}  {m['wrong_behavior'][:70]}  "
                f"[readiness {r['readiness']['tally'] or 'ABORT'} · evals {r['evals']['summary']}]"
                + (f"  <- {failing[0][:90]}" if failing else "") + f"  ({r['seconds']} s)")
    with ThreadPoolExecutor(max_workers=a.j) as ex:
        list(ex.map(work, todo))

    rows = []
    for m in todo:
        r = results[m["id"]]
        row = dict(id=m["id"], wrong_behavior=m["wrong_behavior"], source=m["source"],
                   files=sorted({f for f, _, _ in m["patches"]}),
                   patches=[dict(file=f, old=o, new=n) for f, o, n in m["patches"]])
        if "harness_error" in r:
            row.update(rejected=None, failing=f"HARNESS ERROR: {r['harness_error']}")
        else:
            failing, gained, in_suite_tally = judge(r, base)
            row.update(rejected=bool(failing), failing="; ".join(failing) if failing else "none",
                       failing_checks=failing,
                       readiness=dict(tally=r["readiness"]["tally"], fails=r["readiness"]["fails"],
                                      details=r["readiness"]["details"], error=r["readiness"]["error"],
                                      tally_inside_npm_run_evals=in_suite_tally),
                       evals_summary=r["evals"]["summary"],
                       suites_not_pass={n: dict(status=x["status"], note=x["note"], fails=x["fails"], error=x["error"])
                                        for n, x in r["evals"]["rows"].items() if x["status"] != "PASS"},
                       reference_failures_now_passing=gained,
                       restored=r["restored"], seconds=r["seconds"])
        rows.append(row)
    out = dict(
        generated=time.strftime("%Y-%m-%dT%H:%M:%S%z"), base=BASE, base_commit=head,
        reference_diff=REF_DIFF, harness=os.path.abspath(__file__),
        rule="rejected = a check that passes on the reference fails on the mutant (discovery-readiness standalone run, or any suite of npm run evals compared with the reference run)",
        reference=dict(readiness=base["readiness"]["tally"], evals_summary=base["evals"]["summary"],
                       suites={n: dict(status=x["status"], note=x["note"], fails=x["fails"], error=x["error"])
                               for n, x in base["evals"]["rows"].items()},
                       seconds=base["seconds"]),
        totals=dict(mutants=len(rows), rejected=sum(1 for x in rows if x["rejected"]),
                    survived=[x["id"] for x in rows if x["rejected"] is False],
                    harness_errors=[x["id"] for x in rows if x["rejected"] is None]),
        mutants=rows)
    json.dump(out, open(OUT, "w"), indent=2)
    log(f"\n{out['totals']['rejected']}/{len(rows)} rejected; survived: {out['totals']['survived']}; "
        f"harness errors: {out['totals']['harness_errors']}\nwrote {OUT}")


if __name__ == "__main__":
    main()
