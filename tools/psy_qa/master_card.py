#!/usr/bin/env python3
"""master_card.py — regenerate the 心理学 card in all_lessons/index.html (id="psychology") from lessons.json + lessons_play.json.
Idempotent: replaces only the <article class="series" id="psychology"> … </article> span; keeps the existing data-series keywords and
appends any new ones from EXTRA_KW that are missing.  --bump also raises the header counters (lessons, read time) by the difference
between the numbers the old card advertised (OLD_TOTAL/OLD_H, 20+8 lessons, 11 h) and the new ones — use ONCE (renumber.py does).
usage: python3 tools/psy_qa/master_card.py [--bump] [--dry]"""
import json, os, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
IDX = ROOT / 'all_lessons' / 'index.html'
KIT = ROOT / 'tools' / 'psy_qa'
SPINE = json.load(open(KIT / 'lessons.json', encoding='utf-8'))
PLAY = json.load(open(KIT / 'lessons_play.json', encoding='utf-8'))
N, M = len(SPINE['lessons']), len(PLAY['lessons'])
OLD_TOTAL, OLD_H = 28, 11     # what the card advertised before the insertion (20 + 8 lessons, ~11 h)
NEW_H = 14                    # spine ~11 h + sidecar ~3 h
EXTRA_KW = ('regression to the mean sophomore slump noise Kahneman Sibony Sunstein mechanical prediction Meehl crowd within pain neuroscience '
            'phantom limb nociception Brinjikji self-control Hofmann Milyavskaya temptation situation selection peak-end rule duration neglect '
            'affective forecasting impact bias spotlight effect illusion of transparency liking gap Epley ideal partner speed dating Eastwick Joel '
            'wisdom of crowds Galton Lorenz brainstorming social loafing hidden profile 回归均值 噪声 疼痛 自控 峰终定律 聚光灯效应 喜欢差距 理想型 群体智慧')
TOPICS = ['有边界的推断机器', '证据徽章 A–D', '先押注再读', '回归均值与噪声', '痛不等于伤', '想要与喜欢', '自控不是硬扛', '峰终与记忆', '聚光灯与喜欢差距', '群体何时聪明', 'WEIRD 样本', '检索与间隔', '校准与清单']
DESC_EM = '一条从「同一张照片，你和我看到了两种颜色」走到「怎样把这台机器用好」的中文心理学通识推理线。'
DESC = (f'<em>{DESC_EM}</em>{N} 课全程线性思维，并且只追一台机器：<strong>心智是一台有边界的推断机器，替一具必须活下去的身体，在一群同类中间，用有限的算力、时间和能量，做出「够用」的猜测。</strong>'
        '每个被点名的研究都带一枚证据徽章（A 稳健 · B 成立但有限定 · C 有争议 · D 站不住），每课先押一注再读，最后一课把你的押注收成校准记分板。'
        '第一部分（00–02）方法：内省为什么不行、怎样用行为给看不见的过程留指纹、怎样给证据称重（运气、挑选与重复）；'
        '第二部分（03–08）输入与判断：知觉是先验约束的推断、注意是窄闸、记忆是重构、判断的捷径在什么条件下够用，以及两个反直觉的统计事实——极端之后的「变好」不一定是你做了什么（回归均值），同一位专家换一天就换一个判断（噪声）；'
        '第三部分（09–16）价值与学习：情绪是身体的价值信号、痛不等于伤、大脑的能量预算与可塑性、预测误差学习、想要与喜欢、自控（靠的不是硬扛）、经历与记忆（你记得的不是你经历的）、发展；'
        '第四部分（17–22）他人：从众与服从哪些重复得出来、别人眼里的你、理想型与真正被吸引的人、群体什么时候聪明什么时候更笨、语言把一个脑子里的模型传进另一个脑子、WEIRD 样本问题；'
        '第五部分（23–24）自我与差异：大脑编给自己的故事、人格与智力（智力部分以一份签名声明为基准）；'
        '第六部分（25–27）失灵、修复与收官：当推断掉进自我维持的回路、在安全的关系里送去推翻旧预测的证据、活得好有多少证据可说。'
        f'<strong>实践篇 · 《从零学会用脑》（{M} 课）</strong>把站得住的办法一次一件地用到自己身上：检索与间隔、校准、事前验尸与清单、睡眠、习惯、动机设计、情绪调节，每课一个「本周实验」。'
        '每课配一个真正「算」出机制的可交互小实验。')
PART = ('<div class="lesson-part" style="padding:10px 14px 6px;font-weight:700;font-size:13px;color:var(--muted,#9aa);'
        'border-top:1px solid var(--border,rgba(255,255,255,.08))">{}</div>')

def lesson_a(folder, l):
    return (f'        <a class="lesson" href="{folder}/lessons/{l["slug"]}.html"><span class="num">{l["n"]:02d}</span>'
            f'<span><span class="lesson-title">{l["h1"]}</span><span class="path">{folder}/lessons/{l["slug"]}.html</span></span></a>')

def main():
    dry, bump = '--dry' in sys.argv, '--bump' in sys.argv
    s = IDX.read_text(encoding='utf-8')
    i = s.find('<article class="series" id="psychology"')
    if i < 0:
        sys.exit('psychology card not found')
    j = s.index('</article>', i) + len('</article>')
    old = s[i:j]
    tags = re.search(r'data-tags="([^"]*)"', old).group(1)
    series = re.search(r'data-series="([^"]*)"', old).group(1)
    have = set(series.split())
    add = [w for w in EXTRA_KW.split() if w not in have]
    series = (series + ' ' + ' '.join(add)).strip()
    lessons = '\n'.join([
        '        ' + PART.format(f'理论篇 · 心理学（{N} 课）'),
        *[lesson_a('psychology', l) for l in SPINE['lessons']],
        '        ' + PART.format(f'实践篇 · 从零学会用脑（{M} 课）'),
        *[lesson_a('psychology_play', l) for l in PLAY['lessons']],
    ])
    card = f'''<article class="series" id="psychology" data-tags="{tags}" data-series="{series}">
      <header class="series-head">
        <div>
          <span class="series-tag">new</span>
          <h2>心理学 · The Constructed Mind</h2>
          <p class="series-desc">{DESC}</p>
          <div class="topic-row">
            {''.join(f'<span class="topic">{t}</span>' for t in TOPICS)}
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
    if bump:
        def b(pat, f):
            nonlocal s2
            mm = re.search(pat, s2)
            if not mm:
                print('WARN: counter not found:', pat); return
            s2 = s2[:mm.start(1)] + f(mm.group(1)) + s2[mm.end(1):]
        b(r'<div class="meta">\d+ areas · \d+ tracks · ~([\d,]+) lessons</div>', lambda v: f'{int(v.replace(",", "")) + (N + M - OLD_TOTAL):,}')
        b(r'<span class="value">~(\d+)h</span><span class="label">read time</span>', lambda v: str(int(v) + (NEW_H - OLD_H)))
    if dry:
        print('dry: card', len(old), '->', len(card), 'chars; new keywords', len(add)); return
    IDX.write_text(s2, encoding='utf-8')
    print('master card regenerated:', N, '+', M, 'lessons;', 'counters bumped' if bump else 'counters untouched')

if __name__ == '__main__':
    main()
