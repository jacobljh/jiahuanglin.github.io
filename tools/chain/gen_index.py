#!/usr/bin/env python3
"""Regenerate the machine-owned blocks of a chain series' index.html from its baton file.

The index page is hand-written prose plus two generated blocks, delimited by comments:

    <!-- GEN:TOC -->     ... part headings and one toc-card per lesson ...        <!-- /GEN:TOC -->
    <!-- GEN:DERIVE -->  ... the rows of the "whole derivation on one page" table  <!-- /GEN:DERIVE -->

so the baton sentences in the table are byte-identical to the ones in the lessons (the validator diffs them).

    python3 tools/chain/gen_index.py --series 3d
    python3 tools/chain/gen_index.py --series wm
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LESSON_ROOT = ROOT / "all_lessons"
SERIES = {"3d": ("batons_3d.json", "computer_vision_3d"), "wm": ("batons_wm.json", "world_models"),
          "rob": ("batons_rob.json", "robot_model_training"), "syn": ("batons_syn.json", "synthetic_vision")}
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def build(key: str) -> int:
    jname, dirname = SERIES[key]
    data = json.loads((HERE / jname).read_text(encoding="utf-8"))
    d = LESSON_ROOT / (dirname + "_new")
    if not d.exists():
        d = LESSON_ROOT / dirname
    idx = d / "index.html"
    if not idx.exists():
        print(f"{idx} does not exist; write the hand-written parts first (with the two GEN markers)")
        return 1
    raw = idx.read_text(encoding="utf-8")
    lessons = {x["n"]: x for x in data["lessons"]}
    total = data["total"]
    batons = data["batons"]

    toc = []
    for pi, part in enumerate(data["parts"]):
        a, b = part["lessons"]
        rng = f"lesson {a:02d}" if a == b else f"lessons {a:02d}–{b:02d}"
        toc.append(f'<h2>Part {ROMAN[pi]} · {esc(part["name"])} <span style="color:var(--text-mute);font-weight:400;font-size:14px;">({rng})</span></h2>')
        toc.append(f'<p style="color:var(--text-mute);margin:-2px 0 16px;">{esc(part["blurb"])}</p>')
        toc.append('<div class="toc-grid">')
        for n in range(a, b + 1):
            L = lessons[n]
            toc.append(f'  <a class="toc-card" href="{L["slug"]}.html">\n    <div class="num">{n:02d}</div>\n    <div>\n      <div class="ttl">{esc(L["title"])}</div>\n      <div class="sum">{esc(L["sum"])}</div>\n    </div>\n  </a>')
        toc.append('</div>\n')

    rows = []
    for pi, part in enumerate(data["parts"]):
        a, b = part["lessons"]
        rows.append(f'<tr class="part"><td colspan="4">Part {ROMAN[pi]} · {esc(part["name"])}</td></tr>')
        for n in range(a, b + 1):
            L = lessons[n]
            if L.get("legacy"):          # a lesson kept in the layout it was written in: no baton sentences, so no derivation row
                continue
            sin = f"S{n - 1:02d}-{n:02d}"
            sout = f"S{n:02d}-{n + 1:02d}" if n < total else f"S{n:02d}-x"
            rows.append(f'<tr data-lesson="{n:02d}"><td>{n:02d}</td><td>{esc(batons[sin])}</td>'
                        f'<td><a href="{L["slug"]}.html">{esc(L["title"])}</a>: {esc(L["move"])}</td><td>{esc(batons[sout])}</td></tr>')
        old = [n for n in range(a, b + 1) if lessons[n].get("legacy")]
        if old:
            rows.append(f'<tr class="legacy"><td colspan="4">Lessons {old[0]}–{old[-1]} keep the layout they were written in: each opens with a box that says what forced it and closes with a hand-off, '
                        f'but those sentences are not diffed against this table and their numbers are not re-derived by script.</td></tr>')

    def swap(text: str, name: str, body: str) -> str:
        pat = re.compile(rf"(<!-- GEN:{name} -->)(.*?)(<!-- /GEN:{name} -->)", re.S)
        if not pat.search(text):
            raise SystemExit(f"{idx}: marker <!-- GEN:{name} --> ... <!-- /GEN:{name} --> not found")
        return pat.sub(lambda m: m.group(1) + "\n" + body + "\n" + m.group(3), text, count=1)

    raw = swap(raw, "TOC", "\n".join(toc))
    raw = swap(raw, "DERIVE", "\n".join(rows))
    idx.write_text(raw, encoding="utf-8")
    print(f"wrote {idx.relative_to(ROOT)}: {total} cards, {sum(1 for r in rows if r.startswith('<tr data-lesson'))} derivation rows")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--series", choices=sorted(SERIES), required=True)
    sys.exit(build(ap.parse_args().series))
