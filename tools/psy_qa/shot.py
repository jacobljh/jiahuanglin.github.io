#!/usr/bin/env python3
"""shot.py — screenshot one block of a lesson at a given width (headless Chrome), for looking at layouts.

    python3 tools/psy_qa/shot.py 02 700 [height] [widget|bet|top|full] [--play]  -> $SCRATCH/shots/l02_w700_widget.png  (prints the path)

widget : the .widget block (plus the page's scripts)          bet : the 押注 box only
top    : kicker/h1/subtitle/.chain/路线/bet                    full: the whole page
--play : use all_lessons/psychology_play (default: psychology_new, or psychology after the swap)
It writes a temporary _shot_NN.html next to the lessons, serves the repo root on a free port, and removes the temp file.
Set SCRATCH to choose the output directory (default: /private/tmp/psy_shots). Click-through actions are not supported:
to see a preset state, set `PRESET=w02-p2` (the id of a button to click before the screenshot; several ids may be given comma-separated, e.g. PRESET=w07-start,w07-l1)."""
import http.server, os, re, socketserver, subprocess, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
OUT = Path(os.environ.get("SCRATCH", "/private/tmp/psy_shots")); OUT.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


def block(raw, start_pat):
    """return the full <div …> element starting at start_pat (balanced)"""
    a = raw.index(start_pat)
    depth, i = 0, a
    for m in re.finditer(r"<div\b|</div>", raw[a:]):
        depth += 1 if m.group(0).startswith("<div") else -1
        if depth == 0:
            return raw[a: a + m.end()]
    raise ValueError("unbalanced")


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    play = "--play" in sys.argv
    nn, width = args[0], int(args[1])
    height = int(args[2]) if len(args) > 2 else 1400
    what = args[3] if len(args) > 3 else "widget"
    sub = "psychology_play" if play else ("psychology" if (ROOT / "tools/psy_qa/SWAPPED").exists() else "psychology_new")
    d = ROOT / "all_lessons" / sub / "lessons"
    f = next(d.glob(f"{nn}_*.html"))
    raw = f.read_text(encoding="utf-8")
    head = raw[: raw.index("<body>") + 6]
    tail = raw[raw.index("</main>"):]
    if what == "widget":
        body = block(raw, '<div class="widget"')
    elif what == "bet":
        body = block(raw, '<div class="bet"')
    elif what == "top":
        a = raw.index("<main>") + 6
        b = raw.index('<div class="bet"')
        body = raw[a:b] + block(raw, '<div class="bet"')
    else:
        a = raw.index("<main>") + 6
        body = raw[a: raw.index("</main>")]
    preset = os.environ.get("PRESET")
    ids = [x for x in (preset or "").split(",") if x]                  # PRESET may be a comma-separated list of button ids, clicked in order
    click = ('<script>window.addEventListener("load",function(){' + ''.join(f'var b=document.getElementById("{i}");if(b)b.click();' for i in ids) + '});</script>') if ids else ""
    pjs = os.environ.get("PRESET_JS")                                   # arbitrary JS run on load (virtual time is on, so setTimeout works); TAG names the output file
    if pjs:
        click += '<script>window.addEventListener("load",function(){' + pjs + '});</script>'
    tmp = d / f"_shot_{nn}.html"
    tmp.write_text(head + "<main>" + body + "</main>" + tail.replace("</main>", "", 1).replace("</body>", click + "</body>"), encoding="utf-8")
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Quiet)
    srv.daemon_threads = True
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tag = os.environ.get("TAG") or (preset.replace(',', '_') if preset else '')
    out = OUT / f"l{nn}_w{width}_{what}{'_' + tag if tag else ''}.png"
    wrap = d / f"_shot_wrap_{nn}.html"
    narrow = width < 600                                   # headless Chrome has a minimum window width, so a phone width is shown as an iframe of that width
    if narrow:
        wrap.write_text(f'<!doctype html><body style="margin:0;background:#888"><iframe src="{tmp.name}" style="width:{width}px;height:{height}px;border:0;background:#fff"></iframe></body>', encoding="utf-8")
    try:
        url = f"http://127.0.0.1:{port}/all_lessons/{sub}/lessons/{(wrap if narrow else tmp).name}"
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", f"--window-size={max(width, 700)},{height}", "--virtual-time-budget=20000",
                        f"--screenshot={out}", url], capture_output=True, timeout=300)
    finally:
        tmp.unlink(missing_ok=True); wrap.unlink(missing_ok=True)
    print(out)


if __name__ == "__main__":
    main()
