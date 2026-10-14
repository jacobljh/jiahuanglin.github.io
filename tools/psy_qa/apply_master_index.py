#!/usr/bin/env python3
"""apply_master_index.py — replace the 心理学 card in all_lessons/index.html (#grp-tongshi) with the rebuilt series,
and fold the practice sidecar 《从零学会用脑》 into the same card as a trailing 「实践篇」 block (same pattern as the
cooking_play / *_play tracks, which are listed inside their theory card).

Surgical: re-reads the file at run time (another session may be editing it), replaces only the
<article class="series" id="psychology"> … </article> span, keeps its old data-series keywords (search still matches the
old terms) and appends new ones, and bumps the counters it can parse (header meta lessons, hero read-time).
Refuses to run twice. Run at the swap, after psychology_new has been renamed to psychology (see swap.py).
usage: python3 tools/psy_qa/apply_master_index.py [--dry]
"""
import json, os, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
IDX = pathlib.Path(os.environ.get('IDX_OVERRIDE') or ROOT / 'all_lessons' / 'index.html')
KIT = ROOT / 'tools' / 'psy_qa'
SPINE = json.load(open(KIT / 'lessons.json', encoding='utf-8'))
PLAY = json.load(open(KIT / 'lessons_play.json', encoding='utf-8'))
N, M = len(SPINE['lessons']), len(PLAY['lessons'])
OLD_N, OLD_H = 17, 6                      # what the old card advertised
NEW_H = 8 + 3                             # spine ~8 h + sidecar ~3 h
DRY = '--dry' in sys.argv

s = IDX.read_text(encoding='utf-8')
if 'psychology_play/lessons/' in s:
    sys.exit('already applied (psychology_play is listed in the master index)')
i = s.find('<article class="series" id="psychology"')
if i < 0:
    sys.exit('psychology card not found')
j = s.index('</article>', i) + len('</article>')
old = s[i:j]
m = re.search(r'data-series="([^"]*)"', old)
old_series = m.group(1) if m else ''
m = re.search(r'data-tags="([^"]*)"', old)
tags = m.group(1) if m else 'psychology mind brain cognition popular-science humanities'
tags = tags if 'how-to-use-your-mind' in tags else tags + ' how-to-use-your-mind evidence-based replication'

new_series = ('心理学 A Bounded Inference Machine xinlixue psychology popular science kepu linear thinking causal chain '
              'bounded rationality Simon Gigerenzer less-is-more bias variance resource-rational Lieder Griffiths evidence grades '
              'replication crisis Open Science Collaboration p-hacking file drawer prediction error value affect '
              'Barrett constructed emotion Rescorla Wagner dopamine wanting liking Berridge Lally habit formation twin studies '
              'Saffran statistical learning WEIRD Henrich choice blindness Libet Schurger Big Five MBTI Barnum intelligence Flynn effect '
              'p factor network psychopathology exposure inhibitory learning behavioural activation Cipriani antidepressants '
              'Harvard Study of Adult Development Kahneman Deaton income happiness 从零学会用脑 retrieval practice spacing testing effect '
              'Dunlosky calibration Brier superforecasting pre-mortem checklist sleep two-process model CBT-I habits implementation intentions '
              'self-determination theory overjustification growth mindset emotion regulation reappraisal mindfulness N-of-1 self-experiment '
              '实践篇 检索练习 间隔重复 校准 事前验尸 睡眠 习惯 动机 情绪调节')
series_attr = (old_series + ' ' + new_series).strip()

topics = ['有边界的推断机器', '证据徽章 A–D', '先押注再读', '预测误差', '捷径何时够用', '想要与喜欢', '统计学习', 'WEIRD 样本', '选择盲视', '暴露与抑制性学习', '检索与间隔', '校准与清单']
desc_em = '一条从「同一张照片，你和我看到了两种颜色」走到「怎样把这台机器用好」的中文心理学通识推理线。'
desc = (f'<em>{desc_em}</em>{N} 课全程线性思维，并且只追一台机器：<strong>心智是一台有边界的推断机器，替一具必须活下去的身体，在一群同类中间，用有限的算力、时间和能量，做出「够用」的猜测。</strong>'
        '每个被点名的研究都带一枚证据徽章（A 稳健 · B 成立但有限定 · C 有争议 · D 站不住），每课先押一注再读，最后一课把你的押注收成校准记分板。'
        '第一部分（00–02）方法：内省为什么不行、怎样用行为给看不见的过程留指纹、怎样给证据称重（运气、挑选与重复）；'
        '第二部分（03–06）输入端：知觉是先验约束的推断、注意是窄闸、记忆是重构、判断的捷径在什么条件下够用；'
        '第三部分（07–11）价值与学习：情绪是身体的价值信号、大脑的能量预算与可塑性、预测误差学习、想要与喜欢、发展；'
        '第四部分（12–14）他人：从众与服从哪些重复得出来、语言把一个脑子里的模型传进另一个脑子、WEIRD 样本问题；'
        '第五部分（15–16）自我与差异：大脑编给自己的故事、人格与智力（智力部分以一份签名声明为基准）；'
        '第六部分（17–19）失灵、修复与收官：当推断掉进自我维持的回路、在安全的关系里送去推翻旧预测的证据、活得好有多少证据可说。'
        f'<strong>实践篇 · 《从零学会用脑》（{M} 课）</strong>把站得住的办法一次一件地用到自己身上：检索与间隔、校准、事前验尸与清单、睡眠、习惯、动机设计、情绪调节，每课一个「本周实验」。'
        '每课配一个真正「算」出机制的可交互小实验。')

def lesson_a(folder, l):
    return (f'        <a class="lesson" href="{folder}/lessons/{l["slug"]}.html"><span class="num">{l["n"]:02d}</span>'
            f'<span><span class="lesson-title">{l["h1"]}</span><span class="path">{folder}/lessons/{l["slug"]}.html</span></span></a>')

PART = ('<div class="lesson-part" style="padding:10px 14px 6px;font-weight:700;font-size:13px;color:var(--muted,#9aa);'
        'border-top:1px solid var(--border,rgba(255,255,255,.08))">{}</div>')
lessons = '\n'.join([
    '        ' + PART.format(f'理论篇 · 心理学（{N} 课）'),
    *[lesson_a('psychology', l) for l in SPINE['lessons']],
    '        ' + PART.format(f'实践篇 · 从零学会用脑（{M} 课）'),
    *[lesson_a('psychology_play', l) for l in PLAY['lessons']],
])
card = f'''<article class="series" id="psychology" data-tags="{tags}" data-series="{series_attr}">
      <header class="series-head">
        <div>
          <span class="series-tag">new</span>
          <h2>心理学 · The Constructed Mind</h2>
          <p class="series-desc">{desc}</p>
          <div class="topic-row">
            {''.join(f'<span class="topic">{t}</span>' for t in topics)}
          </div>
        </div>
        <div class="series-actions">
          <span class="series-count">{N + M} lessons</span>
          <span class="series-time">~{NEW_H} h</span>
          <a class="series-link primary" href="psychology/lessons/index.html">Open series →</a>
          <button class="series-toggle" type="button" aria-expanded="false" aria-controls="lessons-psychology">Show all</button>
        </div>
      </header>
      <div class="lesson-list" id="lessons-psychology" hidden>
{lessons}
      </div>
    </article>'''
s2 = s[:i] + card + s[j:]

def bump(pat, f, txt):
    mm = re.search(pat, txt)
    if not mm:
        print('WARN: counter not found:', pat); return txt
    return txt[:mm.start(1)] + f(mm.group(1)) + txt[mm.end(1):]

delta_lessons = (N + M) - OLD_N
s2 = bump(r'<div class="meta">\d+ areas · \d+ tracks · ~([\d,]+) lessons</div>', lambda v: f'{int(v.replace(",", "")) + delta_lessons:,}', s2)
s2 = bump(r'<span class="value">~(\d+)h</span><span class="label">read time</span>', lambda v: str(int(v) + (NEW_H - OLD_H)), s2)
if DRY:
    print('dry run: would replace', len(old), '->', len(card), 'chars; lessons +', delta_lessons, '; hours +', NEW_H - OLD_H)
else:
    IDX.write_text(s2, encoding='utf-8')
    print('master index updated: psychology card now', N, '+', M, 'lessons; counters bumped (+', delta_lessons, 'lessons, +', NEW_H - OLD_H, 'h)')
