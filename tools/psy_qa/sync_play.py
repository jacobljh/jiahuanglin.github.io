#!/usr/bin/env python3
"""sync_play.py — keep the sidecar's copy of psy.js identical to the spine's (the sidecar pages load ./psy.js).
Run after any edit to psychology_new/lessons/psy.js (or psychology/lessons/psy.js after the swap)."""
import os, shutil, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
src = None
for d in ('psychology_new', 'psychology'):
    p = os.path.join(ROOT, 'all_lessons', d, 'lessons', 'psy.js')
    if os.path.exists(p): src = p; break
if not src: sys.exit('no psy.js found')
dst = os.path.join(ROOT, 'all_lessons', 'psychology_play', 'lessons', 'psy.js')
shutil.copyfile(src, dst)
print('copied', os.path.relpath(src, ROOT), '->', os.path.relpath(dst, ROOT))
