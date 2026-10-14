#!/usr/bin/env python3
"""errata_guard.py — fail if any lesson (spine or sidecar) still quotes a number that a publisher correction superseded.
Every pattern below was found in a FACTS file as the ORIGINALLY PRINTED value and replaced after reading the correction notice
(see STATE.md 'ERRATA / RETRACTION SWEEP'). Run before the swap and again at the end:  python3 tools/psy_qa/errata_guard.py"""
import glob, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PATTERNS = [
    ('Szucs & Ioannidis 2017 (corrected power 0.12/0.46/0.78)', r'0\.12[、,，/ 和]+0\.44|0\.44[、,，/ 和]+(?:和 )?0\.73'),
    ('Macnamara 2014 (corrigendum: 24/23/20/5/1%, overall 14%)', r'26%（游戏|游戏 ?26%|21%（音乐|不到 ?1%（职业|解释.{0,6}12%'),
    ('Gawronski 2017 (corrected IAT stability .53 / racial .39)', r'(?:内隐|IAT)[^。]{0,60}r ?[=＝] ?\.54'),
    ('Mertens 2022 (corrected: 447 effects / 212 publications / d = 0.43)', r'214 篇|455 个效应量|2,149,683|合并 d ?[=＝] ?0\.45|−0\.48 到 1\.39|62\.5%'),
    ('Buyalskaya 2023 (corrected: 68–78 d)', r'122.{0,3}226|4 到 7 个月|4–7 个月'),
    ('Fredrickson & Losada correction (text now read)', r'全文没找到|更正声明（'),
    ('Sellier 2019 corrigendum (text now read)', r'没读到内容'),
]
bad = 0
files = sorted(glob.glob(os.path.join(ROOT, 'all_lessons', 'psychology*', 'lessons', '[0-9][0-9]_*.html')))
for f in files:
    t = open(f, encoding='utf-8').read()
    t = re.sub(r'<script.*?</script>', '', t, flags=re.S)
    t = re.sub(r'<[^>]+>', '', t)
    for name, pat in PATTERNS:
        for m in re.finditer(pat, t):
            bad += 1
            print(f'{os.path.relpath(f, ROOT)}: {name}: …{t[max(0, m.start()-40):m.end()+40]!r}')
# sentence-level net for the Macnamara 2014 range, whatever the phrasing (old: 26/21/18/4/<1% and overall 12%; corrected: 24/23/20/5/1% and 14%)
MAC_KEYS = ('Macnamara', '刻意练习', '练习解释', '练习只能解释', '练习能解释')
MAC_OLD = re.compile(r'26 ?%|21 ?%|18 ?%|12 ?%|不到 ?1 ?%|<\s?1 ?%|少于 ?1 ?%|低于 ?1 ?%')
for f in files:
    t = open(f, encoding='utf-8').read()
    t = re.sub(r'<script.*?</script>', '', t, flags=re.S)
    t = re.sub(r'<[^>]+>', ' ', t)
    for sent in re.split(r'[。；\n]', t):
        if any(k in sent for k in MAC_KEYS) and MAC_OLD.search(sent):
            bad += 1
            print(f'{os.path.relpath(f, ROOT)}: Macnamara 2014 sentence mentions a superseded number: …{sent.strip()[:160]!r}')
print(f'errata_guard: {len(files)} lessons scanned, {bad} superseded-number hit(s)')
sys.exit(1 if bad else 0)
