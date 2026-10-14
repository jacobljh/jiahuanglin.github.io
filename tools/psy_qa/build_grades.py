#!/usr/bin/env python3
"""build_grades.py — harvest evidence grades from tools/psy_qa/facts/FACTS_*.md.

Writes facts/GRADES.json  (key -> 'A'|'B'|'C'|'D')   — read by verify.js (every <span class="ev" data-k="KEY"> must match)
       facts/GRADES.md    (human table: key | grade | where | what the key stands for) — writers pick keys from here.

Sources of grades in the FACTS files:
  1. blocks starting `- STUDY <name> — original: …`  followed by `GRADE X …` (the first GRADE is the key's grade;
     later `GRADE Y for …` mentions become `<key>~2`, `<key>~3` with the snippet so a writer can badge the exact sub-claim)
  2. any bullet carrying a `{A}`/`{B}`/`{C}`/`{D}` tag (the key comes from the bullet's opening clause)
Keys are slugs (lower-case ascii / CJK, hyphens). Duplicate slugs get -2, -3. Possible conflicts (same study graded
differently in two files) are printed so the lead can reconcile them in the FACTS files.

usage: python3 tools/psy_qa/build_grades.py [--check]    (--check: print the table summary, write nothing)
"""
import glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FACTS = os.path.join(HERE, 'facts')


def slug(s):
    s = re.sub(r'[*_`]', '', s)
    s = re.sub(r'\([^)]*\)', ' ', s)
    out = []
    for ch in s:
        if ch.isascii() and ch.isalnum():
            out.append(ch.lower())
        elif '一' <= ch <= '鿿':
            out.append(ch)
        elif ch in " -–—_/&,.:;'’ ":
            out.append('-')
    k = re.sub(r'-+', '-', ''.join(out)).strip('-')
    return k[:56].strip('-')


def clause(text):
    t = re.sub(r'^-\s*', '', text.strip())
    t = re.sub(r'[★☆]', '', t)
    t = re.sub(r'\[(?:V|~|def|✗)\]\s*', '', t).strip()
    t = re.sub(r'^\{[ABCD]\}\s*', '', t)
    m = re.split(r' — |: |\. | \(|; ', t, maxsplit=1)
    c = m[0]
    if len(c) < 6 and len(m) > 1:
        c = t[:60]
    return c[:70]


def main():
    entries = []   # (key, grade, where, snippet)
    seen = {}
    for path in sorted(glob.glob(os.path.join(FACTS, 'FACTS_*.md'))):
        fn = os.path.basename(path)
        sec = ''
        lines = open(path, encoding='utf-8').read().split('\n')
        i = 0
        while i < len(lines):
            ln = lines[i]
            if ln.startswith('## '):
                sec = ln[3:].split(' ')[0] + ' ' + ' '.join(ln[3:].split(' ')[1:3])
            # form 3 (FACTS_T4a): a stand-alone line `- GRADE X: STUDY <name> — original …` or `- GRADE D for "<claim>" …; GRADE B for …`
            if re.match(r'-\s+GRADE\s+[ABCD]\b', ln):
                for seg in re.split(r';\s*(?=GRADE\s+[ABCD]\b)', re.sub(r'^-\s+', '', ln)):
                    m3 = re.match(r'GRADE\s+([ABCD])\b[:\s]*(?:for\s+)?(.*)$', seg.strip())
                    if not m3:
                        continue
                    rest = re.sub(r'^STUDY\s+', '', m3.group(2).strip())
                    if rest.startswith('"'):
                        q = rest[1:].split('"', 1)
                        rest = q[0] + (q[1] if len(q) > 1 else '')
                    name3 = re.split(r' — | \{| \(|; |: ', rest)[0][:80]
                    k3 = slug(name3)
                    if k3:
                        entries.append([k3, m3.group(1), f'{fn} §{sec}', (name3 + ' || ' + seg.strip())[:200].replace('|', '/')])
                i += 1
                continue
            m = re.match(r'-\s+\**STUDY\**\s+(.*)$', ln)
            if m:
                # gather the block (until next bullet / header / blank)
                blk = [ln]
                j = i + 1
                while j < len(lines) and lines[j].strip() and not lines[j].startswith('- ') and not lines[j].startswith('#'):
                    blk.append(lines[j]); j += 1
                text = ' '.join(b.strip() for b in blk)
                name = re.split(r' — original| — |: original|\. original', m.group(1), maxsplit=1)[0]
                base = slug(name) or 'study'
                gs = [(g.group(1), g.start()) for g in re.finditer(r'GRADE[:\s]+\**([ABCD])\b', text)]
                if not gs:
                    gs = [(g.group(1), g.start()) for g in re.finditer(r'\{([ABCD])\}', text)]
                for n, (g, pos) in enumerate(gs):
                    k = base if n == 0 else f'{base}~{n + 1}'
                    snippet = text[max(0, pos - 10): pos + 130].replace('|', '/')
                    if n == 0:
                        snippet = (name + ' || ' + text[pos: pos + 120]).replace('|', '/')
                    entries.append([k, g, f'{fn} §{sec}', snippet])
                i = j
                continue
            m = re.search(r'\{([ABCD])\}', ln)
            if m and ln.lstrip().startswith('- ') and 'STUDY' not in ln[:12]:
                name = clause(ln)
                k = slug(name) or 'item'
                entries.append([k, m.group(1), f'{fn} §{sec}', name + ' || ' + ln.strip()[:130].replace('|', '/')])
            i += 1
    # unique keys
    out, count = {}, {}
    rows = []
    for k, g, where, snip in entries:
        kk = k
        if kk in count:
            count[k] += 1
            kk = f'{k}-{count[k]}'
        else:
            count[k] = 1
        out[kk] = g
        rows.append((kk, g, where, snip))
    # conflicts: same first 28 chars of slug, different grade
    pref = {}
    for kk, g, where, snip in rows:
        pref.setdefault(kk[:28], []).append((kk, g, where))
    conflicts = [v for v in pref.values() if len({x[1] for x in v}) > 1 and len(v) > 1]
    if '--check' in sys.argv:
        print(len(rows), 'graded entries;', len(conflicts), 'possible conflicts')
        for v in conflicts:
            print('  CONFLICT?', ' | '.join(f'{k}={g} ({w})' for k, g, w in v))
        return
    # short aliases (lead-maintained, facts/ALIASES.json: {"alias": "auto-key"}) — what writers actually type in data-k
    aliases = {}
    ap = os.path.join(FACTS, 'ALIASES.json')
    if os.path.exists(ap):
        aliases = json.load(open(ap, encoding='utf-8'))
    byalias = {}
    for al, target in sorted(aliases.items()):
        if target in ('A', 'B', 'C', 'D'):          # literal grade (legend badges etc.)
            out[al] = target
            if not al.startswith('legend-'):
                print('  PENDING literal alias (no FACTS backing yet):', al, '=', target)
            continue
        if target not in out:
            print('  ALIAS TARGET MISSING:', al, '->', target)
            continue
        out[al] = out[target]
        byalias.setdefault(target, []).append(al)
    json.dump(out, open(os.path.join(FACTS, 'GRADES.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0, sort_keys=True)
    with open(os.path.join(FACTS, 'GRADES.md'), 'w', encoding='utf-8') as f:
        f.write('# GRADES — keys for `<span class="ev ev-X" data-k="KEY">X</span>`\n\nGenerated by build_grades.py from the FACTS files — do not edit. '
                'The key must exist here and the letter must equal the grade. A: 稳健 · B: 成立但有限定 · C: 有争议 · D: 站不住.\n\n'
                '| key (use the alias if there is one) | grade | where | what it stands for |\n|---|---|---|---|\n')
        for kk, g, where, snip in sorted(rows, key=lambda r: (r[2], r[0])):
            al = byalias.get(kk)
            keycell = ' / '.join(f'**`{a}`**' for a in al) + f' (= `{kk}`)' if al else f'`{kk}`'
            f.write(f'| {keycell} | {g} | {where} | {snip} |\n')
    print('wrote GRADES.json / GRADES.md:', len(rows), 'entries;', len(conflicts), 'possible conflicts')
    for v in conflicts:
        print('  CONFLICT?', ' | '.join(f'{k}={g} ({w})' for k, g, w in v))


if __name__ == '__main__':
    main()
