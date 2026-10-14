#!/usr/bin/env python3
"""swap.py — put the rebuilt series live: psychology_new -> psychology (old series backed up OUTSIDE all_lessons).

Preconditions (checked): all 20 spine lessons + 8 sidecar lessons exist, verify.js errors=0 for both plans.
Steps: back up all_lessons/psychology to tools/psy_qa/old_series_backup/ (untracked, git still has the committed copy),
replace it with psychology_new, rewrite the sidecar's style.css @import (psychology_new -> psychology), write the SWAPPED marker,
regenerate the plans, remap inbound links from other series, apply the master-index card, sync psy.js, re-verify.
usage: python3 tools/psy_qa/swap.py [--dry]
"""
import os, shutil, subprocess, sys, re, json
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
KIT = os.path.join(ROOT, 'tools', 'psy_qa')
AL = os.path.join(ROOT, 'all_lessons')
DRY = '--dry' in sys.argv

def run(*a, check=True):
    print('$', ' '.join(a))
    r = subprocess.run(a, cwd=ROOT, capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    print('\n'.join(out.split('\n')[-12:]))
    if check and r.returncode != 0:
        sys.exit(f'FAILED: {a}')
    return r

if os.path.exists(os.path.join(KIT, 'SWAPPED')):
    sys.exit('already swapped')
new, old, play = (os.path.join(AL, d) for d in ('psychology_new', 'psychology', 'psychology_play'))
spine = json.load(open(os.path.join(KIT, 'lessons.json'), encoding='utf-8'))
playp = json.load(open(os.path.join(KIT, 'lessons_play.json'), encoding='utf-8'))
for pl, d in ((spine, new), (playp, play)):
    miss = [l['slug'] for l in pl['lessons'] if not os.path.exists(os.path.join(d, 'lessons', l['slug'] + '.html'))]
    if miss: sys.exit(f'missing lessons in {d}: {miss}')
for extra in ('index.html', 'style.css', 'psy.js'):
    for d in (new, play):
        if not os.path.exists(os.path.join(d, 'lessons', extra)): sys.exit(f'missing {extra} in {d}')
run('node', 'tools/psy_qa/verify.js')
run('node', 'tools/psy_qa/verify.js', '--plan', 'lessons_play.json')
run('python3', 'tools/psy_qa/errata_guard.py')
if DRY:
    sys.exit('dry run OK — verify passed; nothing moved')
bk = os.path.join(KIT, 'old_series_backup')
if os.path.exists(bk): sys.exit('backup dir already exists: ' + bk)
shutil.copytree(old, bk)
print('backed up old series ->', os.path.relpath(bk, ROOT))
shutil.rmtree(old)
os.rename(new, old)
css = os.path.join(play, 'lessons', 'style.css')
t = open(css, encoding='utf-8').read().replace('../../psychology_new/lessons/style.css', '../../psychology/lessons/style.css')
open(css, 'w', encoding='utf-8').write(t)
open(os.path.join(KIT, 'SWAPPED'), 'w').write('psychology_new was renamed to psychology (see swap.py)\n')
run('python3', 'tools/psy_qa/make_plans.py')
run('python3', 'tools/psy_qa/sync_play.py')
run('python3', 'tools/psy_qa/remap_inbound.py')
run('python3', 'tools/psy_qa/apply_master_index.py')
run('node', 'tools/psy_qa/verify.js')
run('node', 'tools/psy_qa/verify.js', '--plan', 'lessons_play.json')
print('SWAP DONE. Next: update memory + STATE; EPUBs not rebuilt; nothing committed.')
