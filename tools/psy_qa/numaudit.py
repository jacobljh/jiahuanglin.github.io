#!/usr/bin/env python3
"""numaudit.py — list the numbers in a lesson that appear in NONE of the FACTS files.

usage: python3 tools/psy_qa/numaudit.py LESSON.html [FACTS_T5.md ...]   (default: every facts/FACTS_*.md)

Every number token in the visible text (scripts/styles/tags removed) is searched, as a standalone token, in the FACTS text.
Unmatched tokens are printed with context: each one is either (a) a number the lesson derived itself (widget readout, a
percentile conversion, a sum) — then the prose must say so — or (b) a number with no source: cut or verify it.
Skipped: integers 0-9, lesson cross-references (第 NN 课), list numbering, years 1900-2030 are KEPT (they are checkable).
"""
import glob, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def visible_text(html):
    html = re.sub(r'<script.*?</script>', ' ', html, flags=re.S)
    html = re.sub(r'<style.*?</style>', ' ', html, flags=re.S)
    html = re.sub(r'<canvas.*?</canvas>', ' ', html, flags=re.S)
    html = re.sub(r'<!--.*?-->', ' ', html, flags=re.S)
    html = re.sub(r'<(input|button)[^>]*>', ' ', html)
    html = re.sub(r'<[^>]+>', ' ', html)
    html = html.replace('&gt;', '>').replace('&lt;', '<').replace('&amp;', '&').replace('&nbsp;', ' ')
    return re.sub(r'[ \t]+', ' ', html)


NUM = re.compile(r'(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?')


def tokens(text):
    out = []
    for m in NUM.finditer(text):
        whole = m.group(1) + (m.group(2) or '')
        s, e = m.start(), m.end()
        ctx = text[max(0, s - 24): e + 24].replace('\n', ' ')
        # skip cross refs "第 09 课", "第 17 课" and '课 NN'
        pre = text[max(0, s - 3): s]
        post = text[e: e + 3]
        if '第' in pre and '课' in post:
            continue
        if re.fullmatch(r'\d', whole):
            continue
        if re.fullmatch(r'0\d', whole) and '课' in text[e: e + 4]:
            continue
        out.append((whole, ctx))
    return out


def in_facts(tok, facts):
    plain = tok.replace(',', '')
    cands = {tok, plain}
    if '.' in plain and plain.startswith('0.'):
        cands.add(plain[1:])          # .278
    if ',' not in tok and '.' not in tok and len(plain) >= 4:
        cands.add('{:,}'.format(int(plain)))
    for c in cands:
        if re.search(r'(?<![\d.])' + re.escape(c) + r'(?![\d])', facts):
            return True
        if re.search(r'(?<![\d.,])' + re.escape(c) + r'(?![\d,]\d)', facts):
            return True
    return False


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    lesson = sys.argv[1]
    files = sys.argv[2:] or sorted(glob.glob(os.path.join(HERE, 'facts', 'FACTS_*.md')))
    files = [f if os.path.exists(f) else os.path.join(HERE, 'facts', f) for f in files]
    facts = '\n'.join(open(f, encoding='utf-8').read() for f in files)
    text = visible_text(open(lesson, encoding='utf-8').read())
    seen = set()
    miss = []
    for tok, ctx in tokens(text):
        if in_facts(tok, facts):
            continue
        key = (tok, ctx)
        if key in seen:
            continue
        seen.add(key)
        miss.append((tok, ctx))
    print('%s: %d unmatched number occurrences (facts: %s)' % (os.path.basename(lesson), len(miss), ', '.join(os.path.basename(f) for f in files)))
    for tok, ctx in miss:
        print('  %-10s …%s…' % (tok, ctx))


if __name__ == '__main__':
    main()
