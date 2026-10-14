#!/usr/bin/env python3
"""build_index.py KIT_DIR [plan.json] [meta.json] — render <series>/lessons/index.html from KIT_DIR/<plan> + KIT_DIR/<meta> (defaults lessons.json / index_meta.json).
index_meta.json: {title, pill, kicker, h1, subtitle, blocks:[{cls,label,html}], sums:{"00": "..."}, howto:[html,...]}
Adapted from tools/regimes_qa/build_index.py for tools/psy_qa (spine and sidecar). If meta has "psy": true the page loads psy.js (evidence-badge tooltips)."""
import json, sys, os, html
kit = sys.argv[1]
root = os.path.abspath(os.path.join(kit, '..', '..'))
plan = json.load(open(os.path.join(kit, sys.argv[2] if len(sys.argv) > 2 else 'lessons.json'), encoding='utf-8'))
meta = json.load(open(os.path.join(kit, sys.argv[3] if len(sys.argv) > 3 else 'index_meta.json'), encoding='utf-8'))
out = []
A = out.append
A('<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">')
A(f'<title>{meta["title"]}</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n')
A('<header class="topnav">\n  <div class="inner">\n    <a class="crumb-link" href="../../index.html">all_lessons</a>\n    <span class="crumb">/</span>')
A(f'    <span class="crumb">{plan["series"]} / lessons</span>\n    <span class="crumb">/</span>\n    <span class="crumb">index</span>\n    <span class="step-pill">{meta["pill"]}</span>\n  </div>\n</header>\n\n<main>')
A(f'<p class="kicker">{meta["kicker"]}</p>\n<h1>{meta["h1"]}</h1>\n<p class="subtitle">{meta["subtitle"]}</p>\n')
for b in meta['blocks']:
    A(f'<div class="callout{(" " + b["cls"]) if b.get("cls") else ""}">\n  <div class="label">{b["label"]}</div>\n  {b["html"]}\n</div>\n')
for part in plan['parts']:
    A(f'<h2>{part["name"]}</h2>\n<div class="toc-grid">')
    for l in plan['lessons'][part['from']:part['to'] + 1]:
        n = f'{l["n"]:02d}'
        A(f'<a class="toc-card" href="{l["slug"]}.html">\n  <div class="num">{n}</div>\n  <div>\n    <div class="ttl">{html.escape(l["h1"], quote=False)}</div>\n    <div class="sum">{meta["sums"].get(n, "")}</div>\n  </div>\n</a>')
    A('</div>\n')
A('<h2>怎么读这门课</h2>\n<ol>')
for h in meta['howto']:
    A(f'  <li>{h}</li>')
A('</ol>\n\n</main>')
if meta.get('psy'): A('<script src="psy.js"></script>')
A('</body>\n</html>\n')
dst = os.path.join(root, plan['dir'], 'index.html')
open(dst, 'w', encoding='utf-8').write('\n'.join(out))
print('wrote', dst, sum(1 for l in plan['lessons'] if meta['sums'].get(f'{l["n"]:02d}')), 'summaries')
