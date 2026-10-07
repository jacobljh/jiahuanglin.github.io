#!/usr/bin/env python3
"""sync_batons.py — keep the baton sentences of the Synthetic Vision series identical everywhere.

    python3 tools/chain/syn_notes/sync_batons.py                       re-apply every baton of tools/chain/batons_syn.json to the lesson files that exist
    python3 tools/chain/syn_notes/sync_batons.py S03-04 "new text"     set one baton in the JSON, then re-apply it
    python3 tools/chain/syn_notes/sync_batons.py S03-04 @file.txt      the same, reading the text from a file

A baton is <span class="baton" data-seam="S03-04">…</span> at the end of lesson 3 (Forces next) and at the start of lesson 4 (Forced by); this script rewrites both spans from the JSON
(the single source), under a lock, so two writers do not lose each other's edits.  It does NOT touch the prose of "Where this points next": that paragraph must still end on the baton's
last sentence (the validator checks it).  It prints what it changed.  The JSON text is HTML-escaped when written into a page and compared unescaped by the validator."""
import fcntl, html, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
JSON = ROOT / "tools" / "chain" / "batons_syn.json"
LOCK = Path("/tmp/syn_batons.lock")


def lesson_dir() -> Path:
    d = ROOT / "all_lessons" / "synthetic_vision_new"
    return d if d.exists() else ROOT / "all_lessons" / "synthetic_vision"


def main() -> int:
    LOCK.touch()
    with open(LOCK, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        data = json.loads(JSON.read_text(encoding="utf-8"))
        if len(sys.argv) >= 3:
            seam, text = sys.argv[1], sys.argv[2]
            if text.startswith("@"):
                text = Path(text[1:]).read_text(encoding="utf-8").strip()
            if seam not in data["batons"]:
                print(f"unknown seam {seam}; known: {', '.join(data['batons'])}")
                return 1
            data["batons"][seam] = text.strip()
            JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"{seam} set in {JSON.name}")
        slugs = {x["n"]: x["slug"] for x in data["lessons"]}
        d = lesson_dir()
        changed = 0
        for seam, text in data["batons"].items():
            m = re.match(r"S(\d\d)-(\d\d|x)$", seam)
            if not m:
                continue
            a = int(m.group(1))
            ends = [a] + ([a + 1] if m.group(2) != "x" else [])
            for n in ends:
                if n not in slugs:
                    continue
                f = d / (slugs[n] + ".html")
                if not f.exists():
                    continue
                raw = f.read_text(encoding="utf-8")
                pat = re.compile(r'(<span class="baton" data-seam="' + re.escape(seam) + r'">)(.*?)(</span>)', re.S)
                if not pat.search(raw):
                    continue
                new = pat.sub(lambda mm: mm.group(1) + html.escape(text, quote=False) + mm.group(3), raw, count=1)
                if new != raw:
                    f.write_text(new, encoding="utf-8")
                    changed += 1
                    print(f"  rewrote {seam} in {f.name}")
        print(f"{changed} lesson file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
