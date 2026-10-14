#!/usr/bin/env python3
"""ledger.py — (re)build the evidence-ledger block of the finale lesson (27_looking_back) from the badges that are actually on the pages of all earlier lessons.

    python3 tools/psy_qa/ledger.py            # print the block and the totals
    python3 tools/psy_qa/ledger.py --write    # replace what sits between <!--LEDGER:begin--> and <!--LEDGER:end--> in 27_looking_back.html
    python3 tools/psy_qa/ledger.py --dir all_lessons/psychology/lessons --write      # after the swap

Counts every <span class="ev ev-X" data-k="…"> in the page body (scripts excluded), except the legend examples (keys starting 'legend-').
Run it again after any edit to lessons 00–26 (reviewer waves change badge counts), then re-run verify.js on 19.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
args = sys.argv[1:]
DIR = ROOT / (args[args.index('--dir') + 1] if '--dir' in args else 'all_lessons/psychology/lessons')
PLAN = json.load(open(ROOT / 'tools/psy_qa/lessons.json', encoding='utf-8'))
FINAL = len(PLAN['lessons']) - 1          # the finale lesson (27 after the 28-lesson insertion) holds the ledger
COL = {'A': '#15803d', 'B': '#2563eb', 'C': '#b45309', 'D': '#b91c1c'}


def short(h1):
    return re.split(r'[：:]', h1)[0]


def count(path):
    s = path.read_text(encoding='utf-8')
    s = re.sub(r'<script[\s\S]*?</script>', '', s)
    c = {'A': 0, 'B': 0, 'C': 0, 'D': 0}
    for g, k in re.findall(r'<span class="ev ev-([abcd])" data-k="([^"]+)"', s):
        if not k.startswith('legend-'):
            c[g.upper()] += 1
    return c


def main():
    rows, tot = [], {'A': 0, 'B': 0, 'C': 0, 'D': 0}
    for l in PLAN['lessons']:
        n = l['n']
        if n >= FINAL:
            continue
        p = DIR / (l['slug'] + '.html')
        if not p.exists():
            print('  (missing', p.name + ')', file=sys.stderr)
            continue
        c = count(p)
        rows.append((n, short(l['h1']), c))
        for g in tot:
            tot[g] += c[g]
    mx = max(sum(c.values()) for _, _, c in rows) or 1
    allN = sum(tot.values())
    out = [f'<p>整条链上，每个被点名的研究都挂着一枚徽章：A 稳健、B 成立但有限定、C 有争议、D 站不住（图例见第 02 课；级别按今天的证据给，不按名气给）。00–{rows[-1][0]:02d} 课一共 {allN} 枚：A {tot["A"]}、B {tot["B"]}、C {tot["C"]}、D {tot["D"]}。下表是每一课的分布：条长 = 该课的徽章数，颜色同徽章，右列依次是 A·B·C·D 的个数。</p>',
           '<table class="trade-table">', '<thead><tr><th>课</th><th>分布</th><th>A·B·C·D</th></tr></thead>', '<tbody>']
    for n, h, c in rows:
        segs = ''.join(f'<span style="flex:0 0 {c[g] / mx * 100:.1f}%;background:{COL[g]}"></span>' for g in 'ABCD' if c[g])
        out.append(f'<tr><td>{n:02d} {h}</td><td><div style="display:flex;height:10px">{segs}</div></td><td>{c["A"]}·{c["B"]}·{c["C"]}·{c["D"]}</td></tr>')
    out += ['</tbody>', '</table>']
    block = '\n'.join(out)
    print(f'lessons counted: {len(rows)} | totals {tot} = {allN} | max per lesson {mx}')
    if '--write' in args:
        f = DIR / (PLAN['lessons'][FINAL]['slug'] + '.html')
        t = f.read_text(encoding='utf-8')
        a, b = '<!--LEDGER:begin-->', '<!--LEDGER:end-->'
        if a not in t or b not in t:
            sys.exit('markers not found in ' + f.name)
        i, j = t.index(a) + len(a), t.index(b)
        f.write_text(t[:i] + '\n' + block + '\n' + t[j:], encoding='utf-8')
        print('wrote', f)
    else:
        print(block)


if __name__ == '__main__':
    main()
