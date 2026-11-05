#!/usr/bin/env python3
"""Register 《法律的逻辑》 in all_lessons/index.html (#grp-tongshi), surgically (adapted from econ_qa/apply_master_index.py).
Inserts one <article class="series" id="law"> right AFTER the criminal_psychology card, refuses to run twice,
bumps the counters it can parse. Run only after all 21 lessons exist and tools/law_qa/verify.js is clean."""
import json, os, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
IDX = pathlib.Path(os.environ.get('IDX_OVERRIDE') or ROOT / 'all_lessons' / 'index.html')
PLAN = json.load(open(ROOT / 'tools' / 'law_qa' / 'lessons.json'))
N = len(PLAN['lessons']); HOURS = 7
s = IDX.read_text()
if 'id="law"' in s:
    sys.exit('already registered')
lessons = '\n'.join(
    f'        <a class="lesson" href="law/lessons/{l["slug"]}.html"><span class="num">{l["n"]:02d}</span>'
    f'<span><span class="lesson-title">{l["h1"]}</span><span class="path">law/lessons/{l["slug"]}.html</span></span></a>'
    for l in PLAN['lessons'])
topics = ['没有人在审判', '第三方', '规则与标准', '权利', '财产与登记', '合同', '侵权', '罪与罚', '边际威慑', '程序',
          '证明标准', '法律推理', '诉讼的账', '两大法系', '公司', '知识产权', '隐私与同意', '行政法', '宪法与司法审查', '国际法', '读懂法律新闻']
card = f'''    <article class="series" id="law" data-tags="law social-science politics popular-science" data-series="法律的逻辑 The Logic of Law falu de luoji law legal system popular science kepu linear thinking causal chain third party adjudication hawk dove self-help rules standards Kaplow Hohfeld right in rem in personam numerus clausus property registry Torrens good faith acquisition bona fide purchaser nemo dat contract expectation damages reliance efficient breach Hadley v Baxendale Carlill tort negligence Hand formula strict liability activity level criminal law nulla poena sine lege mens rea judgment proof optimal fine marginal deterrence Stigler Beccaria procedure due process Mathews v Eldridge audi alteram partem standard of proof beyond reasonable doubt Blackstone ratio preponderance base rate prosecutor fallacy Sally Clark exclusionary rule legal reasoning precedent stare decisis Hart vehicles in the park litigation settlement Priest Klein selection shadow of the law civil law common law Napoleonic code BGB 民法典 corporation limited liability asset partitioning Salomon veil piercing intellectual property patent copyright Statute of Anne TRIPS privacy consent GDPR 个人信息保护法 administrative law judicial review Marbury v Madison constitutional court proportionality international law treaty ICJ reciprocity dispute pyramid 法律 法院 法官 判例 民法典 刑法 诉讼 证据 证明标准 程序 合同 侵权 财产 公司 知识产权 隐私 行政法 宪法 国际法 新闻">
      <header class="series-head">
        <div>
          <span class="series-tag">new</span>
          <h2>法律的逻辑 · The Logic of Law</h2>
          <p class="series-desc"><em>一条从「没有人在审判，争端却能了结」走到「读懂任何一条法律新闻」的中文法律通识推理线——补齐《政治的逻辑》《政体的逻辑》《犯罪心理学的逻辑》默认你已经懂的那层底座。</em>{N} 课全程用线性思维：人人都想要同一些东西，又谁也不能完全信谁，所以需要一个不是当事人的第三方；第三方要按事先公开的规则判，于是有硬条文与软标准之分；规则最常写权利与责任——财产、合同、侵权，以及哪些错要由国家来罚；无论民事刑事，最后都要在不确定里下判决，于是有程序、证明标准与推理；官司贵，所以多数争议在法庭之外了结；同一台装置在中国、英美、欧陆有不同的走法，还造出了公司、知识产权、隐私这些新东西；最后装置要接受自己的约束：行政法、宪法与司法审查、国际法。课文把三个法律传统并列作为例子，只陈述可核实的事实；有争议的问题把证据都摆出来，不站队；这门课讲的是法律的逻辑，不是法律意见。</p>
          <div class="topic-row">
            {''.join(f'<span class="topic">{t}</span>' for t in topics)}
          </div>
        </div>
        <div class="series-actions">
          <span class="series-count">{N} lessons</span>
          <span class="series-time">~{HOURS} h</span>
          <a class="series-link primary" href="law/lessons/index.html">Open series →</a>
          <button class="series-toggle" type="button" aria-expanded="false" aria-controls="lessons-law">Show all</button>
        </div>
      </header>
      <div class="lesson-list" id="lessons-law" hidden>
{lessons}
      </div>
    </article>
'''
a0 = s.index('<article class="series" id="criminal_psychology"')
a1 = s.index('    <article class="series" id=', a0 + 10)
s = s[:a1] + card + s[a1:]
def bump(pat, f, txt):
    m = re.search(pat, txt)
    if not m:
        print('WARN: counter not found:', pat); return txt
    return txt[:m.start(1)] + f(m.group(1)) + txt[m.end(1):]
g0 = s.index('id="grp-tongshi"')
head = s[g0:g0 + 600]
head2 = bump(r'<span class="group-count">(\d+) tracks</span>', lambda v: str(int(v) + 1), head)
s = s[:g0] + head2 + s[g0 + 600:]
s = bump(r'<div class="meta">\d+ areas · (\d+) tracks', lambda v: str(int(v) + 1), s)
s = bump(r'tracks · ~([\d,]+) lessons</div>', lambda v: f'{int(v.replace(",", "")) + N:,}', s)
s = bump(r'<span class="value">(\d+)</span><span class="label">tracks</span>', lambda v: str(int(v) + 1), s)
s = bump(r'<span class="value">~(\d+)h</span><span class="label">read time</span>', lambda v: str(int(v) + HOURS), s)
IDX.write_text(s)
print('registered law:', N, 'lessons')
