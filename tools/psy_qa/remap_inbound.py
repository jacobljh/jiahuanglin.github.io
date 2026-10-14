#!/usr/bin/env python3
"""remap_inbound.py — after the swap, repoint lesson-specific links INTO the psychology series from other series.

The old 17 lessons were renumbered/renamed (see MAP). Only links that name a specific old lesson need changing;
links to psychology/lessons/index.html and to lessons whose slug+title did not change (00, 01, 03, 04, 05, 06) stay.
Rewrites, in every all_lessons/**/*.html outside the psychology folders:
  - href="…/psychology/lessons/<old slug>.html"  ->  <new slug>.html
  - the visible pattern 「第 NN 课《old title》」 (and 「第 NN 课」 directly after a psychology link) -> new number/title
usage: python3 tools/psy_qa/remap_inbound.py [--dry]
"""
import glob, os, re, sys, json
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DRY = '--dry' in sys.argv
# old slug -> (new slug, old no, new no, old title, new title)
OLD = {
 '00_orientation': '导览：你的现实，是大脑造出来的',
 '01_psychology_as_science': '心理学如何成为科学：从内省到行为，再到看不见的心智',
 '02_biology': '大脑这台硬件：神经元、信号与可塑性',
 '03_perception': '感觉与知觉：大脑如何「造」出一个世界',
 '04_attention': '注意与意识：你只看见你注意的',
 '05_memory': '记忆：不是录像，是每次重新建构的故事',
 '06_thinking_biases': '思维与判断：捷径、偏误与两个系统',
 '07_learning': '学习：联结、强化，与「预测错了就更新」',
 '08_development': '发展：一台机器如何从零搭起',
 '09_emotion': '情绪：身体的信号，还是大脑的解释？',
 '10_motivation': '动机与奖赏：什么在推着我们',
 '11_personality': '人格与个体差异：稳定的「我」从哪来',
 '12_self': '自我：大脑编给自己的故事',
 '13_social': '社会心理：他人如何重塑你的现实',
 '14_disorders': '心理障碍：当建构系统性地出错',
 '15_therapy': '心理治疗：如何重写不良的建构',
 '16_looking_back': '回望整条链：把这台机器用好，与幸福',
}
TO = {  # old slug -> new slug
 '00_orientation': '00_orientation', '01_psychology_as_science': '01_psychology_as_science', '02_biology': '08_hardware',
 '03_perception': '03_perception', '04_attention': '04_attention', '05_memory': '05_memory', '06_thinking_biases': '06_thinking_biases',
 '07_learning': '09_learning', '08_development': '11_development', '09_emotion': '07_emotion', '10_motivation': '10_wanting_habits',
 '11_personality': '16_persons', '12_self': '15_self', '13_social': '12_social', '14_disorders': '17_disorders',
 '15_therapy': '18_therapy', '16_looking_back': '19_looking_back',
}
# plain-text citations by number (no 《》 title) that the generic patterns above do not catch: (file, old text, new text)
TEXT_FIXES = [
 ('computational_mind/lessons/04_rl_dopamine.html', '回扣心理学第 07 课「学习＝预测错了才更新」', '回扣心理学第 09 课「学习＝预测错了才更新」'),
 ('computational_mind/lessons/04_rl_dopamine.html', '这条由心理学第 07 课就埋下的「想要 ≠ 喜欢」之分', '这条由心理学第 10 课就埋下的「想要 ≠ 喜欢」之分'),
 ('computational_mind/lessons/04_rl_dopamine.html', '这一课其实是在给心理学第 07 课那句直觉', '这一课其实是在给心理学第 09 课那句直觉'),
]
# 计算心智/05 cites 心理学 第 06 课 「系统 1 / 系统 2」: lesson 06 is unchanged and keeps that section, so nothing to rewrite.
plan = json.load(open(os.path.join(ROOT, 'tools', 'psy_qa', 'lessons.json'), encoding='utf-8'))
NEW = {l['slug']: l for l in plan['lessons']}
changed = 0
for f in sorted(glob.glob(os.path.join(ROOT, 'all_lessons', '**', '*.html'), recursive=True)):
    rel = os.path.relpath(f, os.path.join(ROOT, 'all_lessons'))
    if re.match(r'(psychology|psychology_new|psychology_play)/', rel) or rel == 'index.html':
        continue
    t = open(f, encoding='utf-8').read()
    t2 = t
    def sub_href(m):
        old = m.group(2)
        if old not in TO or TO[old] == old:
            return m.group(0)
        return m.group(1) + TO[old] + '.html'
    t2 = re.sub(r'(psychology/lessons/)([0-9]{2}_[a-z_]+)\.html', lambda m: sub_href(m) if m.group(2) in TO else m.group(0), t2)
    # visible 「《心理学》第 NN 课《old title》」 forms
    def sub_text(m):
        pre, num, ttl = m.group(1), m.group(2), m.group(3)
        for old, ot in OLD.items():
            if ttl == ot and int(num) == int(old[:2]):
                n = NEW[TO[old]]
                return f'{pre}第 {n["n"]:02d} 课《{n["h1"]}》'
        return m.group(0)
    t2 = re.sub(r'(《心理学》)第\s*(\d{1,2})\s*课《([^》]+)》', sub_text, t2)
    if t2 != t:
        changed += 1
        print(('would change ' if DRY else 'changed ') + rel)
        if not DRY:
            open(f, 'w', encoding='utf-8').write(t2)
for rel, old, new in TEXT_FIXES:
    f = os.path.join(ROOT, 'all_lessons', rel)
    t = open(f, encoding='utf-8').read()
    if old in t:
        assert t.count(old) == 1, (rel, old, t.count(old))
        print(('would fix ' if DRY else 'fixed ') + rel + ': ' + old[:30])
        changed += 1
        if not DRY:
            open(f, 'w', encoding='utf-8').write(t.replace(old, new))
    elif new in t:
        print('already fixed ' + rel)
    else:
        print('WARNING: text not found in ' + rel + ': ' + old)
print('files', 'to change' if DRY else 'changed', changed)
