#!/usr/bin/env python3
"""Validate a "forced chain" lesson series: 3D Vision (computer_vision_3d), World Models (world_models), Training a Robot Model (robot_model_training) and Synthetic Vision Data (synthetic_vision).

What it checks, cheapest first
  structure  tag balance, unescaped & / <, step-pill == "lesson N / TOTAL", exactly one widget + one canvas,
             the required sections, 6-8 interview prompts, nav chain, links that resolve, no LaTeX leaks,
             no leaked source-note vocabulary (FACTS, [VERIFIED] ...), page-size budget
  batons     the linearization spine.  Lesson N's "Forces next" and lesson N+1's "Forced by" carry the SAME
             problem sentence (<span class="baton" data-seam="Sn-m">), it equals the series' baton file, the row
             in the index's derivation table, and the last sentence of "Where this points next".  The 3D series'
             last baton is the World Models series' first.
  numbers    (--oracles) every <span data-n="key">12.3</span> in a lesson must equal oracle fact `key`, rounded to
             the digits shown.  The oracle is tools/chain/verify/<series>_<NN>.js: an independent computation that
             prints {"facts": {...}} as its last stdout line.  Prose, oracle and widget therefore agree by test.
  widgets    (--widgets) every page runs under a DOM/canvas stub (tools/chain/dom_probe.js); each control is driven;
             no Math.random/Date; the first slider must change something visible; two runs print the same text.
  core JS    every code line of "Show the core JS" is a line of an engine file or of the page's own script.

Usage
  python3 tools/chain/validate_chain.py --series 3d                 # structure + batons + sizes + core JS
  python3 tools/chain/validate_chain.py --series wm --only 01,05 --widgets --oracles
  python3 tools/chain/validate_chain.py --all --final               # both series, release gate
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LESSON_ROOT = ROOT / "all_lessons"
HERE = Path(__file__).resolve().parent

SERIES = {
    "3d": dict(json="batons_3d.json", dirname="computer_vision_3d", engines=["flatland.js"],
               next_last="../world_models/01_what_is_a_world_model.html"),
    "wm": dict(json="batons_wm.json", dirname="world_models", engines=["courtyard.js"],
               next_last="../robot_model_training/01_the_policy_contract.html"),
    "rob": dict(json="batons_rob.json", dirname="robot_model_training", engines=["bench.js"],
                next_last="index.html"),
    "syn": dict(json="batons_syn.json", dirname="synthetic_vision", engines=["street.js"],
                next_last="index.html"),
}

NAME_RE = re.compile(r"^(\d\d)_[a-z0-9_]+\.html$")
VOID = {"meta", "link", "br", "hr", "input", "img", "path", "rect", "circle", "line", "ellipse", "polygon", "polyline",
        "stop", "use", "wbr", "col"}
KNOWN = {"html", "head", "body", "title", "header", "footer", "main", "section", "article", "div", "span", "a", "h1", "h2",
         "h3", "h4", "p", "strong", "em", "b", "i", "code", "pre", "kbd", "small", "sup", "sub", "abbr", "ul", "ol", "li",
         "dl", "dt", "dd", "table", "thead", "tbody", "tr", "th", "td", "details", "summary", "figure", "figcaption",
         "canvas", "button", "label", "select", "option", "textarea", "script", "style", "svg", "g", "text", "defs",
         "marker", "tspan"} | VOID
PAIRED = KNOWN - VOID

BAD_ENTITY = re.compile(r"&(?![A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#x[0-9A-Fa-f]+;)")
LATEX = re.compile(r"\\(text|texttt|frac|sqrt|cdot|times|to|mathbb|mathrm|alpha|beta|sigma|theta)\b|\$\$")
LEAK = re.compile(r"\bFACTS\b|\[VERIFIED\]|\[LIKELY\]|UNVERIFIED|DISCREPANCY|\bTODO\b|\bFIXME\b|(?i:lorem ipsum)")
NUM = re.compile(r"[-\u2212+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?")


# ───────────────────────────── HTML parsing ─────────────────────────────
class Page(HTMLParser):
    def __init__(self, path: Path) -> None:
        super().__init__(convert_charrefs=True)
        self.path = path
        self.errors: list[str] = []
        self.stack: list[tuple[str, int]] = []
        self.hrefs: list[str] = []
        self.scripts: list[tuple[str | None, str]] = []
        self.h1 = ""
        self.h2: list[str] = []
        self.widgets = 0
        self.canvases = 0
        self.step_pill = ""
        self.title = ""
        self.text: list[str] = []
        self._script: list[str] | None = None
        self._script_src: str | None = None
        self._cap: str | None = None
        self._cap_buf: list[str] = []
        self._pill = False
        self._skip = 0

    def err(self, msg: str) -> None:
        self.errors.append(f"{self.path.name}:{self.getpos()[0]}: {msg}")

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = set((a.get("class") or "").split())
        if tag not in KNOWN:
            self.err(f"unknown tag <{tag}> (unescaped '<' in code or text?)")
        if tag == "a" and a.get("href"):
            self.hrefs.append(a["href"])
        if "widget" in cls:
            self.widgets += 1
        if tag == "canvas":
            self.canvases += 1
        if "step-pill" in cls:
            self._pill = True
        if tag == "script":
            self._script, self._script_src = [], a.get("src")
        if tag == "style":
            self._skip += 1
        if tag in ("h1", "title", "h2"):
            self._cap, self._cap_buf = tag, []
        if tag in VOID:
            return
        if tag in PAIRED:
            self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        if tag == "canvas":
            self.canvases += 1

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag == "script" and self._script is not None:
            self.scripts.append((self._script_src, "".join(self._script)))
            self._script = None
        if tag == "style":
            self._skip = max(0, self._skip - 1)
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
        if not self._skip:
            self.text.append(data)
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
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def last_sentence(t: str) -> str:
    parts = re.split(r"(?<=[.?!])\s+", t.strip())
    return parts[-1]


LIN = re.compile(r'<div class="callout"><div class="label">Linear position</div>(.*?)</div>', re.S)
BATON = re.compile(r'<span class="baton" data-seam="([^"]+)">(.*?)</span>', re.S)
DATA_N = re.compile(r'<span data-n="([A-Za-z0-9_]+)">(.*?)</span>', re.S)


class Series:
    def __init__(self, key: str) -> None:
        self.key = key
        cfg = SERIES[key]
        self.cfg = cfg
        self.data = json.loads((HERE / cfg["json"]).read_text(encoding="utf-8"))
        self.title = self.data["title"]
        self.total = self.data["total"]
        self.lessons = {x["n"]: x for x in self.data["lessons"]}
        self.batons = self.data["batons"]
        new = LESSON_ROOT / (cfg["dirname"] + "_new")
        self.dir = new if new.exists() else LESSON_ROOT / cfg["dirname"]
        self.slug = {n: x["slug"] + ".html" for n, x in self.lessons.items()}
        self.name = cfg["dirname"]

    def seam_in(self, n: int) -> str:
        return f"S{n - 1:02d}-{n:02d}"

    def seam_out(self, n: int) -> str:
        return f"S{n:02d}-{n + 1:02d}" if n < self.total else f"S{n:02d}-x"


# ───────────────────────────── structure ─────────────────────────────
def check_legacy(S: Series, f: Path, n: int) -> list[str]:
    """A lesson kept in the layout it was written in (batons file entry with "legacy": true): it has no baton spans, no oracle and no
    widget contract, so only its place in the series is checked: tag balance, step pill, title, navigation and links."""
    errs: list[str] = []
    raw = f.read_text(encoding="utf-8")
    page = parse(f)
    errs += page.errors
    want_pill = f"lesson {n} / {S.total}"
    if page.step_pill.strip() != want_pill:
        errs.append(f"{f.name}: step-pill is {page.step_pill.strip()!r}, want {want_pill!r}")
    if not page.title.startswith(f"{n:02d} ·") or not page.title.endswith("| " + S.title):
        errs.append(f"{f.name}: <title> should be 'NN · … | {S.title}' (got {page.title!r})")
    nav = re.search(r'<footer class="lesson-nav">(.*?)</footer>', raw, re.S)
    if not nav:
        errs.append(f"{f.name}: missing footer.lesson-nav")
    else:
        hrefs = re.findall(r'href="([^"]+)"', nav.group(1))
        prev_want = "index.html" if n == 1 else S.slug[n - 1]
        next_want = S.cfg["next_last"] if n == S.total else S.slug[n + 1]
        if len(hrefs) != 2 or hrefs[0] != prev_want or hrefs[1] != next_want:
            errs.append(f"{f.name}: nav footer hrefs {hrefs} != [{prev_want}, {next_want}]")
    for h in page.hrefs:
        if re.match(r"^(https?:|mailto:|#)", h):
            continue
        base = h.split("#")[0]
        if base and not ((f.parent / base).resolve().exists() or alt_exists((f.parent / base).resolve())):
            errs.append(f"{f.name}: dangling href {h}")
    return errs


def check_structure(S: Series, files: list[Path], final: bool) -> tuple[list[str], dict]:
    errs: list[str] = []
    info: dict[int, dict] = {}
    engines = S.cfg["engines"]
    for f in files:
        m = NAME_RE.match(f.name)
        if not m:
            errs.append(f"{f.name}: filename must look like NN_slug.html")
            continue
        n = int(m.group(1))
        if n not in S.lessons:
            errs.append(f"{f.name}: lesson number {n} is not in the plan (1..{S.total})")
            continue
        if f.name != S.slug[n]:
            errs.append(f"{f.name}: the plan calls lesson {n:02d} {S.slug[n]!r}")
        if S.lessons[n].get("legacy"):
            errs += check_legacy(S, f, n)
            continue
        raw = f.read_text(encoding="utf-8")
        page = parse(f)
        errs += page.errors
        body_wo_script = re.sub(r"<script\b.*?</script>", "", raw, flags=re.S)
        for mm in BAD_ENTITY.finditer(body_wo_script):
            line = body_wo_script.count("\n", 0, mm.start()) + 1
            ctx = body_wo_script[mm.start():mm.start() + 14].replace("\n", " ")
            errs.append(f"{f.name}:{line}: unescaped '&' ({ctx!r}) — write &amp;")
        if LATEX.search(body_wo_script):
            errs.append(f"{f.name}: LaTeX escape leaked into prose (this track has no MathJax; use Unicode and <sub>/<sup>)")
        vis = " ".join(page.text)
        lk = LEAK.search(vis)
        if lk:
            errs.append(f"{f.name}: working-note vocabulary leaked into reader prose: {lk.group(0)!r}")
        # ── head / pill / title
        want_pill = f"lesson {n} / {S.total}"
        if page.step_pill.strip() != want_pill:
            errs.append(f"{f.name}: step-pill is {page.step_pill.strip()!r}, want {want_pill!r}")
        if not page.title.startswith(f"{n:02d} ·") or not page.title.endswith("| " + S.title):
            errs.append(f"{f.name}: <title> should be 'NN · … | {S.title}' (got {page.title!r})")
        if not page.h1:
            errs.append(f"{f.name}: missing <h1>")
        if 'href="style.css"' not in raw:
            errs.append(f"{f.name}: must link style.css")
        for eng in engines:
            if f'src="{eng}"' not in raw:
                errs.append(f"{f.name}: must load {eng}")
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
                errs.append(f"{f.name}: widget script uses Math.random/Date — keep widgets deterministic (seeded rng)")
        if '<details><summary>Show the core JS' not in raw:
            errs.append(f"{f.name}: widget must ship <details><summary>Show the core JS</summary>")
        if '<div class="controls">' not in raw or 'type="range"' not in raw:
            errs.append(f"{f.name}: widget needs a .controls row with at least one range slider (the EPUB builder sweeps the first)")
        if not re.search(r"<p><strong>What to try\.?</strong>", raw):
            errs.append(f"{f.name}: missing a <p><strong>What to try.</strong> paragraph after the widget")
        # ── required sections
        h2 = " | ".join(page.h2)
        for need in ("Checkpoint", "Where this points next", "Interview prompts", "Common mistakes"):
            if need.lower() not in h2.lower():
                errs.append(f"{f.name}: missing <h2> '{need}'")
        if 'class="callout ok"' not in raw or ">Takeaway<" not in raw:
            errs.append(f"{f.name}: missing Takeaway callout ok")
        if '>The plan<' not in raw:
            errs.append(f"{f.name}: missing 'The plan' callout")
        if 'class="callout source-note"' not in raw:
            errs.append(f"{f.name}: missing the thesis callout (callout source-note)")
        if 'class="callout road"' not in raw:
            errs.append(f"{f.name}: needs at least one 'Road not taken' callout (callout road)")
        if not re.search(r'class="callout limit"><div class="label">What this lesson did not do', raw):
            errs.append(f"{f.name}: missing the 'What this lesson did not do' callout (callout limit)")
        # ── sections by h2
        secs = re.split(r"<h2>", raw)
        def section(prefix: str) -> str | None:
            for x in secs[1:]:
                if re.match(r"(?:\d+\s*·\s*)?" + prefix, x, re.I):
                    return x
            return None
        cp = section("Checkpoint")
        if cp is not None and "<em>Answer:" not in cp:
            errs.append(f"{f.name}: the Checkpoint needs its answer, written <em>Answer: …</em>")
        cm = section("Common mistakes")
        if cm is not None:
            k = cm.count('class="topic-card"')
            if not 4 <= k <= 8:
                errs.append(f"{f.name}: {k} topic-cards in Common mistakes (want 4-8)")
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
            for w in (S.seam_in(n), S.seam_out(n)):
                if w not in seams:
                    errs.append(f"{f.name}: Linear position lacks <span class=\"baton\" data-seam=\"{w}\">…</span>")
                elif seams[w] != S.batons[w]:
                    errs.append(f"{f.name}: baton {w} differs from {S.cfg['json']}:\n      page: {seams[w]!r}\n      file: {S.batons[w]!r}")
        wp = section("Where this points next")
        if wp is not None and S.seam_out(n) in S.batons:
            q = last_sentence(S.batons[S.seam_out(n)])
            if q not in strip_tags(wp.split("<h2>")[0]):
                errs.append(f"{f.name}: 'Where this points next' must end on the baton's question: {q!r}")
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
        if 'class="lesson-nav"' not in raw:
            errs.append(f"{f.name}: missing footer.lesson-nav")
        nums = DATA_N.findall(raw)
        if final and len(nums) < 6:
            errs.append(f"{f.name}: only {len(nums)} <span data-n> numbers; quote the worked-example and What-to-try numbers through oracle facts (want >= 6)")
        if final and "<!-- reviewed:v1 -->" not in raw:
            errs.append(f"{f.name}: missing <!-- reviewed:v1 --> marker (release gate)")
        info[n] = {"file": f, "page": page, "seams": seams, "raw": raw}

    # ── nav chain + links
    for n, d in sorted(info.items()):
        raw, f = d["raw"], d["file"]
        nav = re.search(r'<footer class="lesson-nav">(.*?)</footer>', raw, re.S)
        if nav:
            hrefs = re.findall(r'href="([^"]+)"', nav.group(1))
            prev_want = "index.html" if n == 1 else S.slug[n - 1]
            next_want = S.cfg["next_last"] if n == S.total else S.slug[n + 1]
            if len(hrefs) != 2 or hrefs[0] != prev_want or hrefs[1] != next_want:
                errs.append(f"{f.name}: nav footer hrefs {hrefs} != [{prev_want}, {next_want}]")
        for h in d["page"].hrefs:
            if re.match(r"^(https?:|mailto:|#)", h):
                continue
            base = h.split("#")[0]
            if not base:
                continue
            target = (f.parent / base).resolve()
            if target.exists() or alt_exists(target):
                continue
            if not final and base in S.slug.values():
                continue
            errs.append(f"{f.name}: dangling href {h}")
    return errs, info


def alt_exists(target: Path) -> bool:
    """During the rewrite the two series live in *_new directories; a link into the other series is fine if either exists."""
    s = str(target)
    for name in ("computer_vision_3d", "world_models", "robot_model_training", "synthetic_vision"):
        tag = f"/{name}/"
        if tag in s and Path(s.replace(tag, f"/{name}_new/")).exists():
            return True
        tagn = f"/{name}_new/"
        if tagn in s and Path(s.replace(tagn, tag)).exists():
            return True
    return False


def check_batons(S: Series, info: dict, strict_index: bool) -> list[str]:
    errs: list[str] = []
    for n in sorted(info):
        if n + 1 not in info:
            continue
        a = info[n]["seams"].get(S.seam_out(n))
        b = info[n + 1]["seams"].get(S.seam_in(n + 1))
        if a is not None and b is not None and a != b:
            errs.append(f"baton {S.seam_out(n)}: lesson {n:02d} says\n      {a!r}\n    but lesson {n + 1:02d} says\n      {b!r}")
    idx = S.dir / "index.html"
    if strict_index:
        if not idx.exists():
            return errs + [f"{S.name}: index.html missing"]
        raw = idx.read_text(encoding="utf-8")
        rows = re.findall(r'<tr data-lesson="(\d+)">(.*?)</tr>', raw, re.S)
        cells = {}
        for num, body in rows:
            tds = [strip_tags(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", body, re.S)]
            if len(tds) >= 4:
                cells[int(num)] = (tds, body)
        for n in sorted(k for k in S.lessons if not S.lessons[k].get("legacy")):
            if n not in cells:
                errs.append(f"index derivation table lacks a row for lesson {n:02d}")
                continue
            tds, body = cells[n]
            if tds[1] != S.batons[S.seam_in(n)]:
                errs.append(f"index row {n:02d} 'inherits' != baton {S.seam_in(n)}")
            if tds[3] != S.batons[S.seam_out(n)]:
                errs.append(f"index row {n:02d} 'creates' != baton {S.seam_out(n)}")
            if S.slug[n] not in body:
                errs.append(f"index row {n:02d} does not link {S.slug[n]}")
        cards = re.findall(r'<a class="toc-card" href="([^"]+)"', raw)
        if cards != [S.slug[n] for n in range(1, S.total + 1)]:
            errs.append(f"index toc-cards {cards} != the lesson list in order")
        if f"{S.total} lessons" not in raw:
            errs.append(f"index step-pill should say '{S.total} lessons'")
    return errs


def check_cross_series(sers: dict[str, Series]) -> list[str]:
    errs: list[str] = []
    if "3d" in sers and "wm" in sers:
        a, b = sers["3d"].batons["S14-x"], sers["wm"].batons["S00-01"]
        if a != b:
            errs.append(f"cross-series baton: 3D S14-x != World Models S00-01\n      {a!r}\n      {b!r}")
    # the last World Models lessons (17-31) are older lessons without baton spans; their two ends are still tied to the batons
    wmt = LESSON_ROOT / "world_models" / "17_two_seats_one_tuple.html"
    if "wm" in sers and wmt.exists():
        raw = wmt.read_text(encoding="utf-8")
        if sers["wm"].batons["S16-17"] not in strip_tags(raw):
            errs.append("world_models/17_two_seats_one_tuple.html does not open with lesson 16's closing baton (S16-17)")
    wmt14 = LESSON_ROOT / "world_models" / "31_capstone_recipe.html"
    if "rob" in sers and wmt14.exists():
        if sers["rob"].batons["S00-01"] not in strip_tags(wmt14.read_text(encoding="utf-8")):
            errs.append("world_models/31_capstone_recipe.html does not end on the Robot Model opening baton (S00-01)")
    return errs


# ───────────────────────────── core JS listings ─────────────────────────────
def check_core_js(S: Series, files: list[Path]) -> list[str]:
    norm = lambda t: re.sub(r"\s+", " ", t).strip()
    engine: set[str] = set()
    for js in S.dir.glob("*.js"):
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
        n_real = 0
        for raw in html.unescape(m.group(1)).splitlines():
            nl = norm(raw)
            if not nl or nl.startswith(("//", "/*", "*")) or "..." in nl:
                continue
            n_real += 1
            bare = norm(re.sub(r"\s//.*$", "", nl))
            if nl in known or bare in known:
                continue
            if len(bare) > 12 and any(k.startswith(bare) for k in known):
                continue
            errs.append(f"{f.name}: core-JS listing line is in no engine or page script: {nl[:110]!r}")
        if n_real < 6:
            errs.append(f"{f.name}: the core-JS listing is only {n_real} code lines; show the heart of the computation")
    return errs


# ───────────────────────────── widgets / oracles ─────────────────────────────
def check_widgets(files: list[Path]) -> list[str]:
    node = shutil.which("node")
    probe = HERE / "dom_probe.js"
    if not node:
        return ["node not found"]
    r = subprocess.run([node, str(probe)] + [str(f) for f in files], capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    print("  " + out.replace("\n", "\n  ") if out else "  (no output)")
    return [] if r.returncode == 0 else ["widget check failed (see above)"]


def parse_num(text: str) -> tuple[float, int, bool] | None:
    m = NUM.search(text.replace("\u2212", "-"))
    if not m:
        return None
    s = m.group(0).replace(",", "")
    sci = bool(re.search(r"[eE]", s))
    mant = re.split(r"[eE]", s)[0]
    dec = len(mant.split(".")[1]) if "." in mant else 0
    return float(s), dec, sci


def run_oracle(S: Series, n: int, final: bool) -> tuple[list[str], dict]:
    node = shutil.which("node")
    cands = sorted((HERE / "verify").glob(f"{S.key}_{n:02d}*.js"))
    if not cands:
        return ([f"{S.key} lesson {n:02d}: no oracle tools/chain/verify/{S.key}_{n:02d}_*.js"] if final else []), {}
    r = subprocess.run([node, str(cands[0])], capture_output=True, text=True, cwd=str(HERE / "verify"))
    if r.returncode != 0:
        tail = (r.stdout + r.stderr).strip().splitlines()[-12:]
        return [f"{cands[0].name}: oracle failed (exit {r.returncode})\n        " + "\n        ".join(tail)], {}
    lines = [ln for ln in r.stdout.strip().splitlines() if ln.strip().startswith("{")]
    if not lines:
        return [f"{cands[0].name}: oracle printed no JSON line"], {}
    try:
        facts = json.loads(lines[-1]).get("facts", {})
    except ValueError as e:
        return [f"{cands[0].name}: last JSON line unreadable: {e}"], {}
    return [], facts


def check_oracles(S: Series, info: dict, final: bool) -> list[str]:
    errs: list[str] = []
    total = 0
    for n, d in sorted(info.items()):
        e, facts = run_oracle(S, n, final)
        errs += e
        for key, inner in DATA_N.findall(d["raw"]):
            total += 1
            txt = strip_tags(inner)
            if key not in facts:
                errs.append(f"{d['file'].name}: data-n={key} is not an oracle fact")
                continue
            pn = parse_num(txt)
            if pn is None:
                errs.append(f"{d['file'].name}: data-n={key} shows {txt!r}, which has no number")
                continue
            x, dec, sci = pn
            v = float(facts[key])
            if sci:
                ok = float(f"{v:.{dec}e}") == x
            else:
                ok = abs(v - x) <= 0.5 * 10 ** (-dec) + 1e-9 * max(1.0, abs(v))
            if not ok:
                errs.append(f"{d['file'].name}: data-n={key} shows {txt!r} but the oracle computes {v!r}")
    print(f"  {total} quoted numbers checked against oracle facts")
    return errs


def check_engine_tests() -> list[str]:
    node = shutil.which("node")
    errs: list[str] = []
    for t in sorted((HERE / "verify" / "engine").glob("test_*.js")):
        r = subprocess.run([node, str(t)], capture_output=True, text=True, cwd=str(t.parent))
        if r.returncode != 0:
            errs.append(f"engine test {t.name} failed:\n        " + "\n        ".join((r.stdout + r.stderr).strip().splitlines()[-8:]))
    return errs


# ───────────────────────────── main ─────────────────────────────
def run_series(key: str, a, sers: dict[str, Series]) -> list[str]:
    S = Series(key)
    sers[key] = S
    files = sorted(p for p in S.dir.glob("[0-9][0-9]_*.html"))
    if a.only:
        keep = {int(x) for x in a.only.split(",")}
        files = [f for f in files if int(f.name[:2]) in keep]
    print(f"== {S.name}: {len(files)} lesson file(s) in {S.dir.relative_to(ROOT)}")
    failures: list[str] = []
    print("structure:")
    errs, info = check_structure(S, files, a.final)
    failures += errs
    print(f"  {len(errs)} problem(s)")
    print("batons:")
    berrs = check_batons(S, info, strict_index=(a.final or a.index))
    failures += berrs
    print(f"  {len(berrs)} problem(s)")
    if a.batons:
        for n in sorted(info):
            for sid, txt in info[n]["seams"].items():
                if sid.startswith(f"S{n:02d}-"):
                    print(f"  {sid}  {txt}")
    print("page sizes:")
    zerrs = [f"{d['file'].name}: {d['file'].stat().st_size} bytes is outside the 20-48 KB page budget"
             for _, d in sorted(info.items()) if not 20_000 <= d["file"].stat().st_size <= 48 * 1024]
    failures += zerrs
    print(f"  {len(zerrs)} problem(s)")
    print("core JS listings:")
    cerrs = check_core_js(S, [d["file"] for _, d in sorted(info.items())])
    failures += cerrs
    print(f"  {len(cerrs)} problem(s)")
    if a.widgets:
        print("widgets:")
        failures += check_widgets([d["file"] for _, d in sorted(info.items())])
    if a.oracles:
        print("oracles (prose numbers = independent computation):")
        failures += check_oracles(S, info, a.final)
    return failures


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--series", choices=sorted(SERIES), help="3d or wm")
    ap.add_argument("--all", action="store_true", help="both series, widgets and oracles on")
    ap.add_argument("--widgets", action="store_true")
    ap.add_argument("--oracles", action="store_true")
    ap.add_argument("--engines", action="store_true", help="also run the engine regression tests")
    ap.add_argument("--index", action="store_true", help="check the index page and derivation table")
    ap.add_argument("--final", action="store_true", help="release gate: reviewed marker, oracles for every lesson, index")
    ap.add_argument("--only", help="comma list of lesson numbers, e.g. 05,07")
    ap.add_argument("--batons", action="store_true", help="print every baton sentence")
    a = ap.parse_args()
    if a.all:
        a.widgets = a.oracles = a.engines = True
    keys = sorted(SERIES) if a.all or not a.series else [a.series]
    if a.all:  # a series whose plan (batons file) is not in this checkout is simply not there yet
        keys = [k for k in keys if (HERE / SERIES[k]["json"]).exists()]
    sers: dict[str, Series] = {}
    failures: list[str] = []
    for k in keys:
        failures += run_series(k, a, sers)
    if len(keys) > 1:
        print("cross-series:")
        c = check_cross_series(sers)
        failures += c
        print(f"  {len(c)} problem(s)")
    if a.engines:
        print("engine tests:")
        e = check_engine_tests()
        failures += e
        print(f"  {len(e)} problem(s)")
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
