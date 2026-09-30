#!/usr/bin/env python3
"""Validate the Rust lesson track: all_lessons/rust/lessons.

What it checks, cheapest first
  structure  tag balance, unescaped & / <, step-pill == file number + 1, exactly one
             widget + canvas, the required sections, 6-8 interview prompts, nav chain,
             links that resolve, no Math.random()/Date in widget scripts, no LaTeX leaks
  batons     the linearization spine.  Lesson N's "Forces next" and lesson N+1's
             "Forced by" must carry the SAME problem sentence (a <span class="baton"
             data-seam="Sn-m">), and that sentence must equal the row in the index's
             derivation table.  A chain you can diff is a chain that cannot drift.
  snippets   (--snippets)  every <pre data-rs="..."> is compiled with the real rustc
             and must produce exactly the verdict on its badge:
               ok | E0502 | E0499,E0502 | error | panic | skip
             <pre class="diag" data-for="id"> blocks must quote lines the compiler
             really printed; <pre class="out" data-for="id"> blocks must match stdout.
  widgets    (--widgets)  run every inline <script> (and the shared engines) under a
             DOM/canvas stub in Node and fire input/change/click on every control.

Usage
  python3 tools/validate_rust_lessons.py                  # structure + batons
  python3 tools/validate_rust_lessons.py --snippets       # + rustc on every snippet
  python3 tools/validate_rust_lessons.py --all --final    # everything, release gate
  python3 tools/validate_rust_lessons.py --only 05,07 --snippets
Set RUSTC=/path/to/rustc if it is not on PATH (falls back to ~/.cargo/bin/rustc).
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LESSONS = ROOT / "all_lessons" / "rust" / "lessons"
TOTAL = 23
SERIES = "Rust from the Contract Up"
NAME_RE = re.compile(r"^(\d\d)_[a-z0-9_]+\.html$")
PLANNED = [
    "00_orientation.html",
    "01_the_promise.html",
    "02_places_values_stack.html",
    "03_ownership_drop.html",
    "04_move_semantics.html",
    "05_borrowing_the_law.html",
    "06_lifetimes_regions.html",
    "07_borrow_checker_liveness.html",
    "08_lifetimes_signatures.html",
    "09_enums_option_match.html",
    "10_errors_result_panic.html",
    "11_traits_contracts.html",
    "12_generics_monomorphization.html",
    "13_trait_objects_dyn.html",
    "14_closures_iterators.html",
    "15_smart_pointers_interior_mutability.html",
    "16_send_sync.html",
    "17_concurrent_programs.html",
    "18_async_state_machines.html",
    "19_unsafe_obligations.html",
    "20_safe_abstraction.html",
    "21_crates_cargo_privacy.html",
    "22_capstone_honest_costs.html",
]

DEFAULT_EDITION = "2024"
CHECKER_VERSION = 2   # bump when snippet-checking logic changes (part of the cache key)

VOID = {"meta", "link", "br", "hr", "input", "img", "path", "rect", "circle", "line",
        "ellipse", "polygon", "polyline", "stop", "use", "wbr", "col"}
KNOWN = {"html", "head", "body", "title", "header", "footer", "main", "section", "article",
         "div", "span", "a", "h1", "h2", "h3", "h4", "p", "strong", "em", "b", "i", "code",
         "pre", "kbd", "small", "sup", "sub", "abbr", "ul", "ol", "li", "dl", "dt", "dd",
         "table", "thead", "tbody", "tr", "th", "td", "details", "summary", "figure",
         "figcaption", "canvas", "button", "label", "select", "option", "textarea", "script",
         "style", "svg", "g", "text", "defs", "marker", "tspan"} | VOID
PAIRED = KNOWN - VOID

BAD_ENTITY = re.compile(r"&(?![A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#x[0-9A-Fa-f]+;)")
LATEX = re.compile(r"\\(text|texttt|frac|sqrt|cdot|times|to|mathbb|mathrm)\b|\$\$")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


# ───────────────────────────── HTML parsing ─────────────────────────────
class Page(HTMLParser):
    def __init__(self, path: Path) -> None:
        super().__init__(convert_charrefs=True)
        self.path = path
        self.errors: list[str] = []
        self.stack: list[tuple[str, int]] = []
        self.hrefs: list[str] = []
        self.scripts: list[tuple[str | None, str]] = []   # (src, body)
        self.pres: list[dict] = []
        self.h1 = ""
        self.h2: list[str] = []
        self.widgets = 0
        self.canvases = 0
        self.step_pill = ""
        self.title = ""
        self.ids: list[str] = []
        self._pre: dict | None = None
        self._script: list[str] | None = None
        self._script_src: str | None = None
        self._cap: str | None = None
        self._cap_buf: list[str] = []
        self._pill = False

    def err(self, msg: str) -> None:
        self.errors.append(f"{self.path.name}:{self.getpos()[0]}: {msg}")

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = set((a.get("class") or "").split())
        if tag not in KNOWN:
            self.err(f"unknown tag <{tag}> (unescaped '<' in code or text?)")
        if a.get("id"):
            self.ids.append(a["id"])
        if tag == "a" and a.get("href"):
            self.hrefs.append(a["href"])
        if "widget" in cls:
            self.widgets += 1
        if tag == "canvas":
            self.canvases += 1
        if "step-pill" in cls:
            self._pill = True
        if tag == "pre":
            self._pre = {"attrs": a, "text": [], "line": self.getpos()[0]}
        if tag == "script":
            self._script, self._script_src = [], a.get("src")
        if tag in ("h1", "title", "h2"):
            self._cap, self._cap_buf = tag, []
        if tag in VOID:
            return
        if tag in PAIRED:
            self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        # <path .../> style; treated as void regardless
        if tag == "canvas":
            self.canvases += 1

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag == "pre" and self._pre is not None:
            self._pre["text"] = "".join(self._pre["text"])
            self.pres.append(self._pre)
            self._pre = None
        if tag == "script" and self._script is not None:
            self.scripts.append((self._script_src, "".join(self._script)))
            self._script = None
        if tag == self._cap:
            text = "".join(self._cap_buf).strip()
            if tag == "h1":
                self.h1 = text
            elif tag == "title":
                self.title = text
            else:
                self.h2.append(text)
            self._cap = None
        if tag in PAIRED:
            if self.stack and self.stack[-1][0] == tag:
                self.stack.pop()
            else:
                opened = [t for t, _ in self.stack]
                if tag in opened:
                    top = self.stack[-1]
                    self.err(f"</{tag}> closes over unclosed <{top[0]}> opened at line {top[1]}")
                    while self.stack and self.stack[-1][0] != tag:
                        self.stack.pop()
                    if self.stack:
                        self.stack.pop()
                else:
                    self.err(f"stray </{tag}> with no matching open tag")
        if tag == "span" and self._pill:
            self._pill = False

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)
            return
        if self._pre is not None:
            self._pre["text"].append(data)
        if self._cap:
            self._cap_buf.append(data)
        if self._pill:
            self.step_pill += data

    def close(self):
        super().close()
        for tag, line in self.stack:
            self.errors.append(f"{self.path.name}:{line}: <{tag}> never closed")


def parse(path: Path) -> Page:
    p = Page(path)
    p.feed(path.read_text(encoding="utf-8"))
    p.close()
    return p


def strip_tags(s: str) -> str:
    import html as _h
    return re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", "", s))).strip()


# ───────────────────────────── structure ─────────────────────────────
LIN = re.compile(r'<div class="callout"><div class="label">Linear position</div>(.*?)</div>', re.S)
BATON = re.compile(r'<span class="baton" data-seam="([^"]+)">(.*?)</span>', re.S)


def check_structure(files: list[Path], final: bool) -> tuple[list[str], dict]:
    errs: list[str] = []
    info: dict[int, dict] = {}
    for f in files:
        m = NAME_RE.match(f.name)
        if not m:
            errs.append(f"{f.name}: filename must look like NN_slug.html")
            continue
        n = int(m.group(1))
        raw = f.read_text(encoding="utf-8")
        page = parse(f)
        errs += page.errors
        # ── entities / latex / scripts
        body_wo_script = re.sub(r"<script\b.*?</script>", "", raw, flags=re.S)
        for mm in BAD_ENTITY.finditer(body_wo_script):
            line = body_wo_script.count("\n", 0, mm.start()) + 1
            ctx = body_wo_script[mm.start():mm.start() + 14].replace("\n", " ")
            errs.append(f"{f.name}:{line}: unescaped '&' ({ctx!r}) — write &amp; (browsers decode '&not', '&copy'... even without ';')")
        if LATEX.search(body_wo_script):
            errs.append(f"{f.name}: LaTeX escape leaked into prose (this track has no MathJax)")
        # ── head / pill / title
        want_pill = f"lesson {n + 1} / {TOTAL}"
        if page.step_pill.strip() != want_pill:
            errs.append(f"{f.name}: step-pill is {page.step_pill.strip()!r}, want {want_pill!r}")
        if not page.title.startswith(f"{n:02d} ·") or not page.title.endswith(SERIES):
            errs.append(f"{f.name}: <title> should be 'NN · … | {SERIES}' (got {page.title!r})")
        if not page.h1:
            errs.append(f"{f.name}: missing <h1>")
        if 'href="style.css"' not in raw:
            errs.append(f"{f.name}: must link style.css")
        # ── widget
        if page.widgets != 1:
            errs.append(f"{f.name}: needs exactly 1 .widget (found {page.widgets})")
        if page.canvases != 1:
            errs.append(f"{f.name}: needs exactly 1 <canvas> (found {page.canvases}) — the EPUB builder captures canvases")
        inline = [b for s, b in page.scripts if not s]
        if not inline:
            errs.append(f"{f.name}: no inline <script> for the widget")
        for s, b in page.scripts:
            code = re.sub(r"//[^\n]*|/\*.*?\*/", "", b, flags=re.S)
            if re.search(r"Math\.random\(|Date\.now\(|new Date\(", code):
                errs.append(f"{f.name}: widget script uses Math.random/Date — keep widgets deterministic (LCG)")
        if 'class="widget"' in raw and '<details><summary>Show the core JS' not in raw and '<details>' not in raw:
            errs.append(f"{f.name}: widget should ship a <details> 'Show the core JS'")
        # ── required sections
        h2 = " | ".join(page.h2)
        for need in ("Checkpoint", "Where this points next", "Interview prompts"):
            if need.lower() not in h2.lower():
                errs.append(f"{f.name}: missing <h2> '{need}'")
        if "common mistakes" not in h2.lower() and "misconceptions" not in h2.lower():
            errs.append(f"{f.name}: missing <h2> 'Common mistakes' (or 'Misconceptions to drop now' in lesson 00)")
        if 'class="callout ok"' not in raw or ">Takeaway<" not in raw:
            errs.append(f"{f.name}: missing Takeaway callout ok")
        if '>The plan<' not in raw:
            errs.append(f"{f.name}: missing 'The plan' callout")
        # ── Linear position
        lm = LIN.search(raw)
        seams: dict[str, str] = {}
        if not lm:
            errs.append(f"{f.name}: missing 'Linear position' callout")
        else:
            block = lm.group(1)
            order = [block.find("Forced by:"), block.find("New idea:"), block.find("Forces next:")]
            if min(order) < 0 or order != sorted(order):
                errs.append(f"{f.name}: Linear position needs Forced by → New idea → Forces next, in that order")
            for sid, txt in BATON.findall(block):
                seams[sid] = strip_tags(txt)
            want_in = "S-1-0" if n == 0 else f"S{n - 1:02d}-{n:02d}"
            want_out = f"S{n:02d}-{n + 1:02d}" if n < TOTAL - 1 else f"S{n:02d}-x"
            for w in (want_in, want_out):
                if w not in seams:
                    errs.append(f"{f.name}: Linear position lacks <span class=\"baton\" data-seam=\"{w}\">…</span>")
        # ── interview prompts
        pm = re.search(r'<ul class="prompt-list">(.*?)</ul>', raw, re.S)
        if pm:
            lis = re.findall(r"<li>(.*?)</li>", pm.group(1), re.S)
            if not 6 <= len(lis) <= 8:
                errs.append(f"{f.name}: {len(lis)} interview prompts (want 6-8)")
            for i, li in enumerate(lis, 1):
                if "<em>(§" not in li:
                    errs.append(f"{f.name}: prompt {i} lacks the <em>(§…)</em> answer pointer")
        else:
            errs.append(f"{f.name}: missing <ul class=\"prompt-list\">")
        # ── common-mistakes grid
        if final:
            secs = re.split(r"<h2>", raw)
            sec = next((x for x in secs if re.match(r"(?:\d+\s*·\s*)?(Common mistakes|Misconceptions)", x)), None)
            cm = sec.count('class="topic-card"') if sec else 0
            if not 4 <= cm <= 8:
                errs.append(f"{f.name}: {cm} topic-cards in the common-mistakes section (want 4-8)")
        if 'class="lesson-nav"' not in raw:
            errs.append(f"{f.name}: missing footer.lesson-nav")
        if final and "<!-- reviewed:v1 -->" not in raw:
            errs.append(f"{f.name}: missing <!-- reviewed:v1 --> marker (release gate)")
        info[n] = {"file": f, "page": page, "seams": seams, "raw": raw}

    # ── nav chain + links (neighbours that are planned but not yet written are fine unless --final)
    for n, d in sorted(info.items()):
        raw, f = d["raw"], d["file"]
        nav = re.search(r'<footer class="lesson-nav">(.*?)</footer>', raw, re.S)
        if nav:
            hrefs = re.findall(r'href="([^"]+)"', nav.group(1))
            prev_want = "index.html" if n == 0 else PLANNED[n - 1]
            next_want = "index.html" if n == TOTAL - 1 else PLANNED[n + 1]
            if len(hrefs) != 2 or hrefs[0] != prev_want or hrefs[1] != next_want:
                errs.append(f"{f.name}: nav footer hrefs {hrefs} != [{prev_want}, {next_want}]")
        for h in d["page"].hrefs:
            if re.match(r"^(https?:|mailto:|#)", h):
                continue
            base = h.split("#")[0]
            target = (f.parent / base).resolve()
            if target.exists():
                continue
            if not final and base in PLANNED:
                continue   # a planned sibling that has not been written yet
            errs.append(f"{f.name}: dangling href {h}")
    return errs, info


def check_batons(info: dict, strict_index: bool) -> list[str]:
    errs: list[str] = []
    for n in sorted(info):
        if n + 1 not in info:
            continue
        a = info[n]["seams"].get(f"S{n:02d}-{n + 1:02d}")
        b = info[n + 1]["seams"].get(f"S{n:02d}-{n + 1:02d}")
        if a is None or b is None:
            continue
        if a != b:
            errs.append(f"baton S{n:02d}-{n + 1:02d}: lesson {n:02d} says\n      {a!r}\n    but lesson {n + 1:02d} says\n      {b!r}")
    # index derivation table
    idx = LESSONS / "index.html"
    if idx.exists() and strict_index:
        raw = idx.read_text(encoding="utf-8")
        rows = re.findall(r'<tr data-lesson="(\d+)">(.*?)</tr>', raw, re.S)
        cells = {}
        for num, body in rows:
            tds = [strip_tags(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", body, re.S)]
            if len(tds) >= 4:
                cells[int(num)] = tds
        for n in sorted(info):
            if n not in cells:
                errs.append(f"index derivation table lacks a row for lesson {n:02d}")
                continue
            inherits, creates = cells[n][1], cells[n][3]
            wi = info[n]["seams"].get("S-1-0" if n == 0 else f"S{n - 1:02d}-{n:02d}")
            wo = info[n]["seams"].get(f"S{n:02d}-{n + 1:02d}" if n < TOTAL - 1 else f"S{n:02d}-x")
            if wi is not None and inherits != wi:
                errs.append(f"index row {n:02d} 'inherits' != lesson's Forced-by baton")
            if wo is not None and creates != wo:
                errs.append(f"index row {n:02d} 'creates' != lesson's Forces-next baton")
    return errs


def print_batons(info: dict) -> None:
    for n in sorted(info):
        for sid, txt in info[n]["seams"].items():
            if sid.startswith(f"S{n:02d}-"):
                print(f"  {sid}  {txt}")


# ───────────────────────────── snippets ─────────────────────────────
def find_rustc() -> str | None:
    for cand in (os.environ.get("RUSTC"), shutil.which("rustc"), str(Path.home() / ".cargo/bin/rustc")):
        if cand and Path(cand).exists():
            return cand
    return None


ITEM = re.compile(r"^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:async\s+)?(?:const\s+)?(?:extern\b|use\b|struct\b|enum\b|trait\b|impl\b|fn\b|type\b|mod\b|static\b|const\b|union\b|macro_rules!)|^#!?\[|^//|^/\*|^\*|^\s*$")


def classify(text: str, attrs: dict) -> str:
    if attrs.get("data-rs-kind"):
        return attrs["data-rs-kind"]
    if re.search(r"\bfn\s+main\s*\(", text):
        return "program"
    tops = [ln for ln in text.splitlines() if ln and not ln[0].isspace() and ln[0] not in "})]"]
    if tops and all(ITEM.match(ln) for ln in tops):
        return "items"
    return "stmts"


def build_source(text: str, kind: str) -> str:
    if kind == "stmts":
        return "fn main() {\n" + text + "\n}\n"
    return text if text.endswith("\n") else text + "\n"


def run_snippet(job: dict) -> dict:
    rustc = job["rustc"]
    kind, src, expect = job["kind"], job["src"], job["expect"]
    need_run = expect == "panic" or job.get("out") is not None or job.get("want_run")
    with tempfile.TemporaryDirectory(prefix="rslesson_") as td:
        p = Path(td) / "snippet.rs"
        p.write_text(src, encoding="utf-8")
        crate = "lib" if kind == "items" else "bin"
        cmd = [rustc, "--edition", job["edition"], "--crate-type", crate, "--error-format=json",
               "--crate-name", "snippet", "--cap-lints", "warn"]
        if need_run:
            cmd += ["-C", "opt-level=0", "-C", "debuginfo=0", "-o", str(Path(td) / "exe"), str(p)]
        else:
            cmd += ["--emit=metadata", "-o", str(Path(td) / "snippet.rmeta"), str(p)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        codes, headlines, rendered = [], [], []
        for line in r.stderr.splitlines():
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("$message_type") != "diagnostic":
                continue
            rendered.append(ANSI.sub("", d.get("rendered") or ""))
            msg = d.get("message", "")
            if d.get("level") == "error" and not re.match(r"aborting due to|could not compile|\d+ warnings? emitted", msg):
                c = (d.get("code") or {}).get("code")
                codes.append(c if c else "_")
                headlines.append(d.get("message", ""))
        res = {"codes": sorted(set(codes)), "n_err": len(codes), "rendered": "\n".join(rendered),
               "compiled": r.returncode == 0, "stdout": None, "panicked": None, "rc": None}
        if r.returncode == 0 and need_run and crate == "bin":
            try:
                e = subprocess.run([str(Path(td) / "exe")], capture_output=True, text=True, timeout=10)
                res.update(stdout=e.stdout, rc=e.returncode, panicked=("panicked" in e.stderr))
            except subprocess.TimeoutExpired:
                res.update(stdout="", rc=-1, panicked=False)
        return res


def check_snippets(info: dict, jobs_n: int, final: bool) -> list[str]:
    rustc = find_rustc()
    if not rustc:
        return ["rustc not found (set RUSTC or install via rustup)"]
    ver = subprocess.run([rustc, "--version"], capture_output=True, text=True).stdout.strip()
    print(f"  compiler: {ver}")
    cache_dir = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "rust-lessons-check"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / "cache.json"
    try:
        cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    except (ValueError, OSError):
        cache = {}
    errs: list[str] = []
    jobs: list[dict] = []
    per_lesson: dict[int, dict[str, int]] = {}
    ids: dict[tuple[int, str], dict] = {}
    for n, d in sorted(info.items()):
        stats = per_lesson.setdefault(n, {"ok": 0, "err": 0, "panic": 0, "skip": 0, "diag": 0})
        for pre in d["page"].pres:
            a, text = pre["attrs"], pre["text"]
            cls = set((a.get("class") or "").split())
            where = f"{d['file'].name}:{pre['line']}"
            if "diag" in cls or "out" in cls:
                continue
            exp = a.get("data-rs")
            looks_rust = bool(re.search(r"\b(fn |let |impl |struct |enum |trait |use std|match |println!)", text))
            if exp is None:
                if looks_rust and not (cls & {"ascii", "cpp", "go", "sh", "asm"}) and not a.get("data-lang"):
                    errs.append(f"{where}: Rust-looking <pre> without data-rs (mark ok / E0xxx / panic / skip+data-why)")
                continue
            if exp == "skip":
                stats["skip"] += 1
                if not (a.get("data-lang") or a.get("data-why")):
                    errs.append(f"{where}: data-rs=skip needs data-lang (C++/Go/pseudo) or data-why")
                continue
            kind = classify(text, a)
            job = {"rustc": rustc, "kind": kind, "src": build_source(text, kind), "expect": exp,
                   "edition": a.get("data-edition", DEFAULT_EDITION), "where": where,
                   "out": a.get("data-out"), "id": a.get("id"), "lesson": n, "text": text}
            key = hashlib.sha256(json.dumps([CHECKER_VERSION, ver, job["kind"], job["src"], job["edition"],
                                             job["expect"], job["out"] is not None]).encode()).hexdigest()
            job["key"] = key
            jobs.append(job)
            if job["id"]:
                ids[(n, job["id"])] = job
    todo = [j for j in jobs if j["key"] not in cache]
    print(f"  snippets: {len(jobs)} ({len(jobs) - len(todo)} cached, {len(todo)} to compile)")
    if todo:
        with cf.ThreadPoolExecutor(max_workers=jobs_n) as ex:
            for j, res in zip(todo, ex.map(run_snippet, todo)):
                cache[j["key"]] = res
        try:   # merge with whatever other runs wrote meanwhile, then replace atomically
            disk = json.loads(cache_file.read_text()) if cache_file.exists() else {}
        except (ValueError, OSError):
            disk = {}
        disk.update({j["key"]: cache[j["key"]] for j in todo})
        tmp = cache_file.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps(disk))
        os.replace(tmp, cache_file)
    for j in jobs:
        res = cache[j["key"]]
        exp, where = j["expect"], j["where"]
        st = per_lesson[j["lesson"]]
        if exp == "ok":
            st["ok"] += 1
            if res["codes"]:
                errs.append(f"{where}: badge says ok but rustc says {res['codes']}\n{indent(res['rendered'], 8, 14)}")
            elif not res["compiled"]:
                errs.append(f"{where}: did not compile (no error code)\n{indent(res['rendered'], 8, 14)}")
        elif exp == "panic":
            st["panic"] += 1
            if not res["compiled"]:
                errs.append(f"{where}: badge says panic but it does not compile: {res['codes']}")
            elif not res["panicked"]:
                errs.append(f"{where}: badge says panic but the run exited rc={res['rc']} without panicking")
        else:
            st["err"] += 1
            want = sorted(x.strip() for x in exp.split(",")) if exp != "error" else None
            if res["compiled"]:
                errs.append(f"{where}: badge says {exp} but it COMPILES")
            elif want is not None and res["codes"] != want:
                errs.append(f"{where}: badge says {want} but rustc says {res['codes']}\n{indent(res['rendered'], 8, 14)}")
        if j["out"] is not None and res.get("stdout") is not None:
            if res["stdout"].split() != j["out"].split():
                errs.append(f"{where}: data-out {j['out']!r} != stdout {res['stdout']!r}")
    # diag / out blocks tied to a snippet id
    for n, d in sorted(info.items()):
        for pre in d["page"].pres:
            a, text = pre["attrs"], pre["text"]
            cls = set((a.get("class") or "").split())
            if not ({"diag", "out"} & cls):
                continue
            tid = a.get("data-for")
            where = f"{d['file'].name}:{pre['line']}"
            job = ids.get((n, tid)) if tid else None
            if job is None:
                errs.append(f"{where}: <pre class=diag/out> needs data-for=<id of a checked snippet in this lesson>")
                continue
            res = cache[job["key"]]
            if "diag" in cls:
                per_lesson[n]["diag"] += 1
                hay = res["rendered"]
                hay_lines = [h.strip() for h in hay.splitlines()]
                for ln in text.splitlines():
                    s = ln.strip()
                    if not s or s == "...":
                        continue
                    if s.startswith("--> "):          # the path differs by design: compare line:col only
                        pos = re.search(r"(\d+:\d+)$", s)
                        if not (pos and any(h.startswith("--> ") and h.endswith(pos.group(1)) for h in hay_lines)):
                            errs.append(f"{where}: quoted position not produced by rustc: {s!r}")
                        continue
                    if s.lstrip("= ") not in hay and s not in hay:   # every other line: headline, note, help, source, label, gutter
                        errs.append(f"{where}: quoted compiler line not produced by rustc: {s!r}")
            else:
                if res.get("stdout") is None:
                    errs.append(f"{where}: class=out refers to a snippet that was not run (add data-out)")
                elif res["stdout"].split() != text.split():
                    errs.append(f"{where}: quoted output {text.split()!r} != real {res['stdout'].split()!r}")
    tot = {k: sum(v[k] for v in per_lesson.values()) for k in ("ok", "err", "panic", "skip", "diag")}
    print(f"  verdicts verified: ok={tot['ok']} rejected={tot['err']} panic={tot['panic']} skipped={tot['skip']} diag-blocks={tot['diag']}")
    return errs


def indent(s: str, n: int, maxlines: int) -> str:
    lines = s.strip().splitlines()[:maxlines]
    return "\n".join(" " * n + ln for ln in lines)


# ─────────────── "Show the core JS" listings must be real engine code ───────────────
def check_core_js(files: list[Path]) -> list[str]:
    """Every code line of a lesson's core-JS listing must be a line (whitespace-normalised, trailing // comment
    ignored) of an engine file next to the lessons or of the page's own inline script. A line holding `...`
    is an explicit elision and is skipped. Catches listings that drifted from the code they claim to excerpt."""
    norm = lambda t: re.sub(r"\s+", " ", t).strip()
    engine: set[str] = set()
    for js in LESSONS.glob("*.js"):
        engine |= {norm(l) for l in js.read_text().splitlines() if norm(l)}
    errs: list[str] = []
    for f in files:
        t = f.read_text()
        m = re.search(r"<summary>Show the core JS</summary>\s*<pre[^>]*><code>(.*?)</code></pre>", t, re.S)
        if not m:
            continue
        page = set()
        for sc in re.findall(r"<script>(.*?)</script>", t, re.S):
            page |= {norm(l) for l in sc.splitlines() if norm(l)}
        known = engine | page
        for raw in html.unescape(m.group(1)).splitlines():
            nl = norm(raw)
            if not nl or nl.startswith(("//", "/*", "*")) or "..." in nl:
                continue
            bare = norm(re.sub(r"\s//.*$", "", nl))
            if nl in known or bare in known:
                continue
            if len(bare) > 12 and any(k.startswith(bare) for k in known):
                continue
            errs.append(f"{f.name}: core-JS listing line is in no engine or page script: {nl[:110]!r}")
    return errs


# ───────────────────────────── widgets (node) ─────────────────────────────
def check_widgets(files: list[Path]) -> list[str]:
    checker = ROOT / "tools" / "rust_widget_check.js"
    node = shutil.which("node")
    if not node or not checker.exists():
        return [f"widget check unavailable (node={node}, {checker.name} exists={checker.exists()})"]
    r = subprocess.run([node, str(checker)] + [str(f) for f in files], capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    print("  " + out.replace("\n", "\n  ") if out else "  (no output)")
    return [] if r.returncode == 0 else ["widget check failed (see above)"]


# ───────────────────────────── main ─────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--snippets", action="store_true")
    ap.add_argument("--widgets", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--final", action="store_true", help="release gate: reviewed marker, mistakes grid, index table")
    ap.add_argument("--only", help="comma list of lesson numbers, e.g. 05,07")
    ap.add_argument("--batons", action="store_true", help="print every baton sentence")
    ap.add_argument("--jobs", type=int, default=max(2, (os.cpu_count() or 4)))
    a = ap.parse_args()
    if a.all:
        a.snippets = a.widgets = True

    files = sorted(p for p in LESSONS.glob("[0-9][0-9]_*.html"))
    if a.only:
        keep = {int(x) for x in a.only.split(",")}
        files = [f for f in files if int(f.name[:2]) in keep]
    if not files:
        print("no lesson files found in", LESSONS)
        return 1
    print(f"{len(files)} lesson file(s) in {LESSONS.relative_to(ROOT)}")

    failures: list[str] = []
    print("structure:")
    errs, info = check_structure(files, a.final)
    failures += errs
    print(f"  {len(errs)} problem(s)")
    print("batons:")
    berrs = check_batons(info, strict_index=True)
    failures += berrs
    print(f"  {len(berrs)} problem(s)")
    if a.batons:
        print_batons(info)
    print("page sizes:")
    zerrs = [f"{d['file'].name}: {d['file'].stat().st_size} bytes is outside the 20-48 KB page budget"
             for _, d in sorted(info.items()) if not 20_000 <= d["file"].stat().st_size <= 48 * 1024]
    failures += zerrs
    print(f"  {len(zerrs)} problem(s)")
    print("core JS listings:")
    cerrs = check_core_js([d["file"] for _, d in sorted(info.items())])
    failures += cerrs
    print(f"  {len(cerrs)} problem(s)")
    if a.snippets:
        print("snippets:")
        failures += check_snippets(info, a.jobs, a.final)
    if a.widgets:
        print("widgets:")
        failures += check_widgets([d["file"] for _, d in sorted(info.items())])
    print()
    if failures:
        print(f"FAILED — {len(failures)} problem(s):")
        for f in failures:
            print(" •", f)
        return 1
    print("OK — all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
