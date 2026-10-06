#!/usr/bin/env python3
"""Layout QA for the forced-chain series: canvas text overlaps, text off the canvas, NaN text, horizontal page overflow.

    python3 tools/chain/qa_layout.py --series wm [--dir world_models_new] [--widths 375,1100] [--only 05] [--index] [--dbg]

Starts its own static server on a free port (repo root) and drives headless Chrome through qa_layout.html.
Exit status 1 when any lesson is flagged.  Needs Google Chrome at the usual macOS path (override with $CHROME)."""
import argparse, html, http.server, json, os, re, socketserver, subprocess, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
DIRS = {"3d": "computer_vision_3d", "wm": "world_models", "rob": "robot_model_training", "syn": "synthetic_vision"}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--series", required=True, choices=sorted(DIRS))
    ap.add_argument("--dir", help="lesson directory under all_lessons (default: the series directory, or its *_new twin while that exists)")
    ap.add_argument("--widths", default="375,1100")
    ap.add_argument("--only", help="two-digit lesson number")
    ap.add_argument("--index", action="store_true", help="also check index.html")
    ap.add_argument("--dbg", action="store_true", help="print coordinates of the first overlaps")
    a = ap.parse_args()
    d = a.dir
    if not d:
        d = DIRS[a.series]
        if (ROOT / "all_lessons" / (d + "_new") / "index.html").exists():
            d += "_new"
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Quiet)
    srv.daemon_threads = True
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    bad = 0
    for w in a.widths.split(","):
        url = f"http://127.0.0.1:{port}/tools/chain/qa_layout.html?series={a.series}&dir={d}&w={w}"
        url += (f"&only={a.only}" if a.only else "") + ("&index=1" if a.index else "") + ("&dbg=1" if a.dbg else "")
        cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1200,1000",
               "--virtual-time-budget=900000", "--dump-dom", url]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1200)
        m = re.search(r'<pre id="out">RESULT(.*?)ENDRESULT</pre>', r.stdout, re.S)
        if not m:
            print(f"width {w}: NO RESULT", r.stdout[-300:], r.stderr[-300:])
            bad += 1
            continue
        rows = json.loads(html.unescape(m.group(1)))
        print(f"width {w} px, {d}: {len(rows)} page(s)")
        for x in rows:
            idx = x.get("f") == "in"
            flag = bool(x.get("fatal") or x.get("noverlap") or x.get("off") or x.get("bad") or x.get("errs")
                        or (x.get("hov") or 0) > 1 or (not idx and (x.get("n", 1) == 0 or x.get("canv", 1) < 1)))
            if flag:
                bad += 1
                print("  FLAG", json.dumps(x, ensure_ascii=False)[:500])
        if not any(True for _ in rows):
            bad += 1
    print("layout QA:", "FAILED" if bad else "clean")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
