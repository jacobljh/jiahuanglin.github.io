# BIBLE — 《法律的逻辑 · The Logic of Law》

Series folder: `all_lessons/law/lessons/` (21 lessons, 00–20, Chinese, `lang="zh-CN"`).
Master table (slugs, h1s, parts, **verbatim batons**): `tools/law_qa/lessons.json` — the single source of truth for chrome and seams.
Facts (the **ONLY** permitted source, see §0): `tools/law_qa/facts/FACTS_foundations.md` (课 00–03) · `FACTS_private_law.md` (04–06) · `FACTS_criminal.md` (07–08) · `FACTS_procedure_evidence.md` (09–10) · `FACTS_reasoning_litigation.md` (11–13) · `FACTS_corp_ip_privacy.md` (14–16) · `FACTS_state_intl_finale.md` (17–20). Each file is sectioned by lesson; read your lesson's section, plus any section your spec points to.
Exemplars (read before writing): `00_orientation.html` (导览 mode) and `10_proof_standards.html` (model-simulation widget mode). Copy their house style exactly.
**When this BIBLE and a FACTS file disagree, FACTS wins** — the researchers corrected many of the premises written here (article numbers, years, quotations, who said what). The BIBLE's paraphrase of a fact is only a pointer to where to look, never a source.
Verifier: `node tools/law_qa/verify.js all_lessons/law/lessons/NN_slug.html` (from the repo root). KPI probe: `node tools/cooking_qa/kpi.js FILE click:ID set:ID=V …`. Layout probe: `node tools/cooking_qa/layout.js FILE 320 [actions]` and `… 700`.
Numeric spec checks (already run, see §5 for what they showed): `tools/law_qa/proto/spec_check*.js`.

Sibling series (cite, never re-teach) — exact titles in §7.

---

## §0 Red lines (read twice)

1. **Facts come only from the FACTS files.** Every number, date, case name, statute number, article number, study, quotation in prose must be a `[V]` item (or a `[~]` item phrased the way the file recommends). Anything under "COULD NOT VERIFY" is **banned**. If you need a fact that isn't there, write around it qualitatively — do not look it up and do not use memory. Legal facts are especially fragile: a wrong article number or year is worse than none.
2. **Jurisdiction tag on every legal statement.** Law is local. Whenever the prose states what "the law" says, name the jurisdiction and, for statutes, the version: 「中国《民法典》（2021-01-01 施行）第 311 条」「德国《民法典》第 892 条」「英国 Carlill v Carbolic Smoke Ball（1892/1893）」「美国多数州」. Never write "法律规定……" bare. The series sets **三个传统并列**作为例子——中国法、英美普通法、欧陆大陆法——**只陈述可核实的事实**，不排名、不评价任何国家的政治制度、不说哪套"更先进"。凡 FACTS 里只有一个国家的材料，就只写那一个，并说明"这是一个例子"。
3. **Math is allowed without a FACTS entry** when you derive it on the page (Hand formula B<PL as a definition; threshold t = C<sub>FC</sub>/(C<sub>FC</sub>+C<sub>FA</sub>); h/p optimal sanction; Bayes' rule; hawk–dove ESS; discounted annuities). Empirical magnitudes (deterrence elasticities, settlement rates, litigation costs, trial win rates) are NOT laws → FACTS.
4. **Widget numbers are model outputs, not facts.** Every widget is a deterministic toy; prose that quotes a widget number says it is the model's (示意) and must equal what the widget really prints (check with kpi.js). Never put a toy number next to a real statistic as if both were data.
5. **Models are maps, not territory.** Every lesson has ONE `<div class="callout warn"><div class="label">模型的边界</div>…</div>` stating what the model assumes away and where real law bites. Law is full of exactly such gaps: **this is where you say, in a sentence, "这门课讲法律的逻辑，不是法律意见；具体案件请找执业律师"** (once per lesson is plenty; in 00 and 20 say it in full).
6. **实然 vs 应然.** Always separate "法律是怎样的 / 研究发现了什么"（positive）from "法律应该怎样"（normative）. Contested questions (威慑效果、法系与经济表现、知识产权期限、隐私与创新、违宪审查的民主正当性) — put the evidence and the disagreement side by side with the FACTS ranges; **不替任何一方站台**。Never write about 死刑存废、堕胎、枪支、政治案件、具体在办案件、具体政党或政治人物的是非。国家之间的争端（如海洋、贸易）只陈述程序性事实。
7. **People are pronoun-neutral:** never 他/她 (verify.js errors). Use names (阿力、小山、甲、乙、原告、被告、当事人、法官) or restructure. 当事人用「甲/乙」或虚构人名，不用真实私人。
8. **No LaTeX.** Math in Unicode with `<span class="math">` / `<p class="ascii">`; sub/superscripts via `<sub>/<sup>`.
9. **Second person, plain Chinese, short sentences.** Explain every term first time: 中文名＋英文，如「善意取得（bona fide purchase）」「对世权（right in rem）」. No 黑话. Concrete case first, abstraction second. 拉丁格言可以出现，但要给白话。
10. **Linear thinking is the point:** every section is *forced* by the previous one. The lesson answers its incoming baton and ends by raising its outgoing baton (§2 seam rule).
11. **One counter-intuitive result per lesson** (the 「反直觉」): state it as a plain sentence early (in 本课路线 or §一), let the widget reproduce it, confirm it in the "你会看到" paragraph. Planned set: 00 守法靠的是"别人也在守" · 01 法庭不必常用才有用 · 02 越常发生的事越该用硬规则（但案情越杂，硬规则越糟）· 03 限制权利的花样反而降低总成本 · 04 保护善意买家是牺牲无辜的原主，却让整体更便宜 · 05 违约有时是对的，法律只要求你"赔到像没违约" · 06 人人都"尽到合理注意"，事故仍然过多 · 07 罚金再重也赔不起，所以才要监禁 · 08 加重轻罪的刑罚会招来更重的罪 · 09 程序越多不一定越好，利害越大越值得 · 10 "十个放过一个"是成本比，不是错误比 · 11 先例越多，软标准越像硬规则 · 12 打到判决的案子，胜率被选择拉向五成 · 13 没有哪条路永远占优 · 14 有限责任让股东偏爱更差但更险的项目 · 15 保护期翻倍，创新只多一点点 · 16 告知越详细，保护越差 · 17 起诉成本一高，机关就不再小心 · 18 审查越严，不是错越少，只是换谁来背错 · 19 违约怕的不是警察，是将来没人跟你合作 · 20 99%的法律在法庭之外工作.
12. The engine wording is fixed (§1); echo it in every 回到主线.

---

## §1 Engine and throughlines

**Engine (state it in 00 and the finale; echo in every 回到主线) — use verbatim:**
> 人人都想要同一些东西，又谁也不能完全信谁。法律，就是社会把「谁能向谁要什么、违反了怎么办」预先写成公开的规则，再交给一个不是当事人的第三方，按固定的程序，在不确定中裁决的装置。所以每一个法律问题，最后都落在三个问法上：谁说了算（权威），规则分了什么（权利与责任），出了争议谁来裁、凭什么证据、错了谁吃亏（裁判与错误）。

**Throughline ① 谁说了算（权威）:** 谁有资格定规则、凭什么服从、谁来管定规则的人 (01 → 02 → 13 → 17 → 18 → 19 → 20).
**Throughline ② 规则分了什么（权利与责任）:** 权利是人与人的关系、财产、合同、侵权、犯罪与刑罚 (03 → 04 → 05 → 06 → 07 → 08 → 14 → 15 → 16).
**Throughline ③ 裁判与错误:** 程序、证据、推理、诉讼的账；任何裁判都会错，法律是在分配错误 (09 → 10 → 11 → 12).

**The six news questions (finale 20 and the series' 收官):** 谁定的规则？把什么分给了谁？违反了谁来裁？凭什么证据？错了谁吃亏？裁判者又被谁管？

---

## §2 The chain

| # | slug | h1 | job (one line) | widget |
|---|---|---|---|---|
| 00 | 00_orientation | 导览：没有人在审判，争端却能了结 | 你守法靠什么；装置的三个零件；引擎；全系列地图 | 守法的账 (lead exemplar) |
| 01 | 01_third_party | 第三方：为什么人们愿意把「自己动手」交出去 | 鹰鸽博弈；私力救济的账；第三方=裁判+执行；自助的边界 | 没有法庭的村庄 / 有法庭的村庄 |
| 02 | 02_rules_standards | 规则的形状：硬条文，还是软标准 | 规则 vs 标准；Kaplow；适用频率与案情杂乱度 | 限速：写死，还是写「谨慎」 |
| 03 | 03_rights_bundle | 权利：不是人和物的关系，而是人和人的关系 | Hohfeld 对应关系；对世权/对人权；物权法定 | 能设计多少种权利 |
| 04 | 04_property_registry | 财产：一块地被卖了两次，法律该保护谁 | 公示；登记 vs 交付；善意取得；最便宜的避免者 | 一块地的转手链 |
| 05 | 05_contract | 合同：承诺凭什么能被强制，违约该赔多少 | 承诺的强制；期待/信赖/履行；有效率违约 | 三种赔法，三种后果 |
| 06 | 06_tort | 侵权：陌生人之间的伤害，谁来为预防出钱 | Hand 公式；过错 vs 严格；活动水平 | 谁来为预防出钱 |
| 07 | 07_why_state_punishes | 罪：为什么有些错要交给国家来罚 | 公共错误；h/p；赔不起；罪刑法定与罪过 | 赔不起的人 |
| 08 | 08_punishment_purposes | 刑罚：罚得重，就一定吓得住吗 | 四种目的；确定性 vs 严厉性；边际威慑 | 抢劫与灭口 |
| 09 | 09_procedure | 程序：为什么「怎么判」比「判什么」更先 | 听两边；中立；Mathews；对抗/职权；认罪 | 程序要配多重 |
| 10 | 10_proof_standards | 证据与证明标准：不确定里，多确定才够判 | 后验概率；门槛 = 错判成本比；Blackstone；基率 | 证明标准的门槛 (lead exemplar) |
| 11 | 11_legal_reasoning | 法律推理：规则遇上没想到的案子 | 文义/目的；类比；先例；解释方法 | 公园里不许有车 |
| 12 | 12_litigation_shadow | 诉讼的账：为什么大多数官司没打到判决 | 和解空间；选择效应；法律的影子；ADR | 谁会走进法庭 |
| 13 | 13_legal_families | 两大法系：判例一案一案积累，法典一次写成 | 普通法/大陆法/中国；两条演化路径；争议 | 法典与判例，谁追得上世界 |
| 14 | 14_the_corporation | 公司：法律发明的「不是人的人」 | 法人；资产分割；有限责任；风险转移；揭开面纱 | 有限责任与风险转移 |
| 15 | 15_intellectual_property | 知识产权：为看不见的东西造出人为的稀缺 | 非竞争品；专利/版权交换；保护期 | 保护期该多长 |
| 16 | 16_privacy_consent | 隐私与同意：人人都点了「同意」，之后呢 | 告知-同意的失灵；GDPR/个保法的合法性基础 | 没人读得完的同意书 |
| 17 | 17_administrative_law | 行政法：国家也是一个当事人 | 行政行为；复议与诉讼；审查强度；预防效应 | 起诉成本与机关的小心 |
| 18 | 18_constitution_review | 宪法与司法审查：谁来判一部法律本身合不合法 | Marbury；两种审查模式；反多数难题；比例原则 | 三种审查强度 |
| 19 | 19_international_law | 国际法：没有世界警察，为什么还被遵守 | 条约/习惯；ICJ 同意管辖；互惠与声誉；WTO | 没有警察的合规 |
| 20 | 20_finale | 收官：法律的边界，与读懂任何一条法律新闻的六个问题 | 规范与法；争议金字塔；法律的影子；六问 | 一个纠纷的二十一站 |

Parts (kicker text, exact): 00–02 `第一部分 · 为什么需要一个不是当事人的第三方` · 03–06 `第二部分 · 私法：权利怎么分、怎么转、怎么赔` · 07–08 `第三部分 · 公法：为什么国家要亲自出手` · 09–12 `第四部分 · 裁判：在不确定中下判决` · 13–16 `第五部分 · 法系与新东西：同一套装置，不同的走法` · 17–19 `第六部分 · 谁来约束掌权者` · 20 `第七部分 · 收官`.

**Seam rule:** the `.chain` left cell of lesson N = `batons["(N-1)-N"]` verbatim (00 uses `in00`); the right cell = `batons["N-(N+1)"]` + ` → NN+1` verbatim (20 uses `out20`, no arrow); the 下一步 callout **starts** with that same baton verbatim and then names `第 NN 课《h1》`. The subtitle retells the incoming question in narrative form ("上一课我们发现……"). verify.js enforces all of this — never paraphrase a baton.

---

## §3 House skeleton

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NN · {h1} | 法律的逻辑</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="topnav"><div class="inner"><a class="crumb-link" href="../../index.html">all_lessons</a><span class="crumb">/</span><a class="crumb-link" href="index.html">法律的逻辑</a><span class="crumb">/</span><span class="crumb">NN</span><span class="step-pill">第 {N+1} 课 / 共 21 课</span></div></header>

<main>

<p class="kicker">{part, exact}</p>
<h1>{h1, exact}</h1>
<p class="subtitle">{上一课我们发现…… retell the incoming question; state this lesson's job as a question}</p>

<div class="chain">
  <span><b>被什么逼出</b>{baton in, verbatim}</span>
  <span class="this"><b>本课</b>{2–3 sentences: the new idea this lesson adds}</span>
  <span><b>逼出下一课</b>{baton out, verbatim} → {NN+1}</span>
</div>

<div class="callout source-note"><div class="label">出处小注</div>{one anchor from FACTS (a name, a year, a case, an article) with its jurisdiction; say what the widget's numbers are (示意)}</div>

<div class="callout"><div class="label">本课路线</div>(1) … (2) … (n)</div>

<h2>一、…</h2>  … 5–8 numbered sections, one 「X、动手：{widget name}」 with an intro paragraph before and a "你会看到" paragraph after …

<div class="callout warn"><div class="label">模型的边界</div>…</div>
<div class="callout"><div class="label">回到主线</div>{tie back to the engine/three questions}</div>

<h2>常见误解</h2>
<ul class="prompt-list">
<li>误解：… <em>（澄清：…）</em></li>   ← 4–6 items
</ul>

<div class="callout takeaway"><div class="label">一句话带走</div>…</div>

<div class="callout"><div class="label">下一步</div>{baton out verbatim} → 第 NN 课《{next h1}》会……</div>

<footer class="lesson-nav"><a href="{prev file}"><span class="dir">上一课</span><span class="ttl">{NN-1} · {prev h1}</span></a><a class="next" href="{next file}"><span class="dir">下一课</span><span class="ttl">{NN+1} · {next h1}</span></a></footer>
</main>
<script>
/* 部件逻辑：{what it models, the formula, which constants are 示意 and which come from FACTS}。纯原生 JS + canvas 2D，所有 id 带 wNN- 前缀；不用随机数。 */
(function(){ … })();
</script>
<!-- reviewed:v1 -->
</body>
</html>
```

- 00's prev link: `<a href="index.html"><span class="dir">上一课</span><span class="ttl">← 课程总览</span></a>`. 20's next link: `<a class="next" href="index.html"><span class="dir">下一课</span><span class="ttl">回到课程总览 →</span></a>`; 20 has no 下一步 callout.
- Callouts: `.callout`, `.callout warn`, `.callout ok`, `.callout takeaway`, `.callout source-note`; also `.mini-flow`, `.trade-table`, `.prompt-list`, `.position-grid`, `.lesson-flow`, `p.ascii`, `span.math`.
- **Every `<div class="callout…">` closes with `</div>`, never `</p>`.** Run verify after every edit.
- Size 22–45 KB. Cross-refs inside the series: `第 NN 课《exact h1》` or bare `第 NN 课` (FILE numbers 00–20). Sibling refs: `《政治的逻辑》第 NN 课《exact h1》` with a link (titles in §7).
- Tables (`.trade-table`) are welcome for "case → what it shows" and for **三传统对照** (中国 / 英美普通法 / 欧陆大陆法) — but only cells you have FACTS for; leave a cell out rather than fill it from memory. Use a `.mini-flow` for 3–5-step causal chains. Prefer real, FACTS-backed cases (named cases, statute articles) to invented ones; invented illustrative parties use 甲/乙 or 阿力/小山.

## §4 Widget conventions

One `.widget` with `.title`, `.hint`, `.controls`, `.kpi-grid` of 3–5 `.kpi`, one `<canvas id="wNN-canvas" class="dist-canvas">`, optional `#wNN-note`; all ids `wNN-`; vanilla JS IIFE, `var`, no Math.random/Date (LCG if needed), DPR-aware `resize()` + `hFor(w)` stacked layout below 560 px; light canvas `#f8fafc`, slate text; 11px labels. **Colour convention for law (use consistently):** 一方当事人／权利人／原告 = blue `#2563eb`; 另一方／义务人／被告／加害人 = amber `#d97706`; 社会最优／法院／规则达成的好结果 = green `#16a34a`; 损害／错判／无谓损失 = red `#dc2626`; 国家／法规／制裁 = violet `#7c3aed`; neutral/axes = slate `#475569`; secondary series cyan `#0891b2`. **The widget must COMPUTE** (formula, optimization, simulation) — not animate a picture. Prototype in node first (`tools/law_qa/proto/wNN.js`) and *re-derive the spec's formulas yourself*: **if the spec's model is wrong or degenerate, fix it and say what you changed in your final reply — the model must be right, not literal** (the specs below were numerically checked, but your own check is the real one; e.g. an earlier draft of 06 had a degenerate social optimum and 13 had a code-law hybrid that was dominated). KPI text never NaN/undefined/Infinity; Chinese labels with units (元, %, 年, 个). Canvas text inside the canvas at 320 px. Every control must change something visible (no dead sliders). Provide 2–4 preset buttons that jump to the lesson's key cases. 单位一律是「示意单位」，不要伪装成真实货币统计。

## §5 Per-lesson specs

(Writers: the Content bullets are a forced sequence — keep the order; the Widget block gives the model. Anything marked 【FACTS】 must come from the named FACTS section; if the item is missing or marked COULD NOT VERIFY there, write qualitatively. Statute article numbers and case years: only as in FACTS, with the version.)

### 00 导览：没有人在审判，争端却能了结 — (lead-written exemplar)

### 01 第三方：为什么人们愿意把「自己动手」交出去
- Content: (1) the incoming baton: take the law away; two people want the same thing. 先别讲霍布斯（《政治的逻辑》第 01、03 课已讲自然状态与暴力垄断，这里只点名回扣）——讲**法律视角**：争端的解法有三种，打、谈、找第三方。(2) 鹰鸽博弈 (Maynard Smith & Price 1973 【FACTS】)：资源价值 V、打架代价 C；V<C 时，均衡里一部分人好斗，整体收益**低于**人人都和气——私力救济的"账"。(3) 私力救济也可以有秩序：冰岛自由邦（有立法司法集会，没有执行机关，靠当事人自己执行）【FACTS】、中世纪商人法与私人裁判者 (Milgrom–North–Weingast) 【FACTS】——但仍然靠"第三方的判断"，只是执行是私人的；第三方的两件事：**裁**与**执行**。(4) 动手：widget。(5) 现代法律不是消灭自助，而是**管住自助**：中国《民法典》第 1177 条自助行为（要件：情况紧迫、来不及求助国家机关、必要范围、事后立即请求处理，不当须担责）、《刑法》第 20 条正当防卫【FACTS】——国家把"暴力"收归自己，但留了狭窄的口子。(6) boundary：模型里的法庭中立、罚得准；真实第三方可能偏袒、迟到、被收买；这是 02 到 09 要解决的。Bridge → 02：第三方凭什么判？(7) Dedup: 自然状态与暴力垄断 → 《政治的逻辑》第 01、03 课；无国家社会的秩序 → 《人类学》第 09 课。
- Widget 「没有法庭的村庄 / 有法庭的村庄」: Hawk–Dove replicator. 参数滑块：资源价值 V（默认 4），打架代价 C（默认 10），抓住概率 p（0–1，默认 0），罚款 F（0–20，默认 10）。有效处罚 pF = p×F。收益矩阵（鹰=主动动手，鸽=退让）：鹰对鹰 (V−C)/2 − pF；鹰对鸽 V − pF；鸽对鹰 0；鸽对鸽 V/2。均衡鹰占比 x* = clamp((V − 2pF)/C, 0, 1)。**社会福利（人均，罚款只是转移，不计入）= V/2 − C·x²/2**；无法庭时 x* = V/C，福利 = (V/2)(1 − V/C)。法庭成本 k×p×x（每次抓人的行政成本 k，默认 1）。画：左图 π<sub>H</sub>(x)、π<sub>D</sub>(x) 两条线和交点；右图 福利(x) 曲线与当前点；或一条"鹰占比随时间"的复制子轨迹（dx/dt = x(1−x)(π<sub>H</sub>−π<sub>D</sub>)，欧拉步长，起点 x₀=0.5）。KPI：均衡鹰占比，人均福利（对比"人人和气"的 V/2），法庭每人成本，法庭实际罚了多少次（= p×x）。Presets：「没有法庭」(p=0)、「法庭常来但罚得轻」(p=0.8, F=1)、「法庭难得来但罚得重」(p=0.1, F=20)、「刚好够」(pF=V/2)。**数值已核：V=4,C=10 时 pF=0/0.5/1/1.5/2 → x*=0.40/0.30/0.20/0.10/0 → 福利 1.20/1.55/1.80/1.95/2.00（验证过 π<sub>H</sub>=π<sub>D</sub>）。反直觉：当 pF ≥ V/2，鹰占比降到 0，此后法庭几乎不用真的罚——"有用"不等于"常用"。** 注意提醒：这里 p、F 只以乘积 pF 起作用（风险中性、同质的人）；为什么现实里"抓得准"和"罚得重"并不等价，留给 08。

### 02 规则的形状：硬条文，还是软标准
- Content: (1) the incoming baton: 第三方要判，凭什么判？临场决定 vs 事前规则；规则要事前公开、普遍、可预期——富勒的八项内在道德已在《政治的逻辑》第 05 课讲过，这里只点名并回扣，不重讲。(2) 两种写法：规则 rule（"时速不得超过 100"）与标准 standard（"应当谨慎驾驶"）。Kaplow 1992：区别只在"给法律赋予内容的工作发生在行为之前还是之后"；规则事前贵、事后便宜，标准反之【FACTS：注意 FACTS 里关于"频率"论断的出处是正文引言，不要写"摘要说"】。(3) 两个例子：中国《民法典》第 17–19 条（成年/限制行为能力的年龄线）是硬线，第 7 条诚信原则是软标准；英美法的"合理人"标准【FACTS】；再用 FACTS 里的限速例子（美国加州基本速度法之类，**按 FACTS 措辞**）。(4) widget。(5) 为什么硬线还要开软口子：《民法典》第 18 条的"16 岁以上以劳动收入为主要生活来源视为完全民事行为能力人"【FACTS】——规则的边缘会磨出标准。(6) boundary：成本都是示意；真实的"适用成本"包含预测成本、避让成本；规则也会被钻空子。Bridge → 03：规则最常写的是"这东西归谁"。
- Widget 「限速：写死，还是写『谨慎』」: 每年某类情形发生 N 次（滑块 1–1000，对数）；情形杂乱度 H（0.2–2.0；不同路况下安全速度的离散程度）；标准的预测噪声 σ（0.2–1.5）；裁量单次成本 c<sub>adj</sub>（0–3）。**每次适用成本：规则 = k·H² + 0.1（系统性错配：该宽的被限、该严的被放），标准 = k·σ² + c<sub>adj</sub>（噪声 + 事后裁量），k=1**；**一次性成本：规则 K<sub>R</sub>=60（把规则写准），标准 K<sub>S</sub>=5**；总成本 TC<sub>R</sub>(N)=K<sub>R</sub>+N·(kH²+0.1)，TC<sub>S</sub>(N)=K<sub>S</sub>+N·(kσ²+c<sub>adj</sub>)。交叉点 N* = (K<sub>R</sub>−K<sub>S</sub>)/(单次标准 − 单次规则)，仅当单次规则 < 单次标准时存在。默认 H=0.8, σ=0.7, c<sub>adj</sub>=1.0 → 单次规则 0.74、标准 1.49 → N*≈73。画：两条 TC(N) 线（对数横轴）和交点；另一半画 100 个情形的"安全速度"散点和那条限速线，涂出"过严/过松"区间。KPI：规则总成本、标准总成本、交叉点 N*、此时更省的写法。Presets：「高速公路（N 很大，H 小）」、「罕见新技术（N 很小）」、「情形五花八门（H=1.6）」。**反直觉两条：频率越高越该用规则；但情形越杂乱（H 大），哪怕极常见，硬规则也会输——H=1.6 时单次规则 2.66 > 标准 1.49，规则永远赢不了。**

### 03 权利：不是人和物的关系，而是人和人的关系
- Content: (1) the incoming baton: 规则最常写"这东西归谁"。常识说"我对这块地有权利"是人和地的关系；Hohfeld 说：权利永远是**人对人**——我的权利 = 别人的义务 + 出了事能去找人【FACTS: Hohfeld 1913 八个概念的对应关系；注意"权利束"比喻 Hohfeld 本人没用过，别归给他】。(2) 对人权（right in personam，合同：只约束两个人）vs 对世权（right in rem，物权：约束所有陌生人）；中国《民法典》第 114 条物权定义、第 116 条物权法定、第 118 条债权定义【FACTS】。(3) 为什么对世权必须被**标准化**——物权法定 numerus clausus：Merrill & Smith 2000 的信息成本论【FACTS，注意是 [~]】；Hill v Tupper (1863)【FACTS：只写"1863 年英国法院"，不写具体法院级别】。(4) widget。(5) 合同可以自由设计、物权不可以——这条分界在中国法、德国法、英美法里都存在（只写 FACTS 有的）。(6) boundary：模型只算信息成本，忽略创新、政治、传统；真实的物权类型也在慢慢增加（只在 FACTS 有时才举例）。Bridge → 04：对世权要求所有陌生人知道它在——怎么让他们知道？
- Widget 「能设计多少种权利」: 一项权利要约束 T 个陌生人（T 滑块 1–10<sup>6</sup>，对数；T=1 = 合同，T=10<sup>5</sup> = 物权）；允许的权利"花样"数 K（1–60 的自变量）；这一带里被创设的权利个数 R（默认 1000），每个权利从贴身定制得到的价值上限 V（默认 50），定制价值递减：Benefit(K)=R·V·(1−e<sup>−K/κ</sup>)，κ=4；每个陌生人学会 K 种花样的成本 c·K（c 默认 0.02）。**总净值 NS(K)=Benefit(K) − T·c·K**；最优 K* = max(1, κ·ln(R·V/(κ·T·c)))（解析式，已核：R=1000,V=50,κ=4,c=0.02 时 T=1→K*≈53, T=10→44, T=10<sup>3</sup>→26, T=10<sup>5</sup>→7, T=10<sup>6</sup>→1）。画：NS(K) 曲线、K* 竖线、"当前 K"；横向再画"T 从 1 到 10<sup>6</sup> 时 K* 的变化"。KPI：最优花样数 K*，当前总净值，放任（K=60）时的净值，只有 K*时的净值。Presets：「两个人的合同 (T=1)」「一块地的地役权 (T=1000)」「全社会都要尊重的物权 (T=10<sup>5</sup>)」。**反直觉：对世权越多人要尊重，越该限制花样——限制自由反而降低总成本；合同则相反。**

### 04 财产：一块地被卖了两次，法律该保护谁
- Content: (1) the incoming baton: 一物二卖的难题。真所有人 vs 善意买家，总有一个人要吃亏。(2) 公示 publicity：不动产登记、动产占有/交付——中国《民法典》第 209 条（登记生效）、第 214 条（记载于登记簿时发生效力）、第 224 条（动产交付）【FACTS：注意预设里的条号已被更正】；Torrens 制 (Real Property Act 1858)：mirror/curtain/indemnity 三原则【FACTS】；美国 recording acts 三类【FACTS：一句定义即可】。(3) 善意取得：中国《民法典》第 311 条三要件+原所有人向无权处分人请求赔偿；第 312 条遗失物例外（两年）【FACTS：不是"赃物条款"】；德国 BGB §892、§932、§935【FACTS】；英美起点是 nemo dat，英国 Sale of Goods Act 1979 s.21【FACTS】。对比表（三传统，只填 FACTS 有的格子）。(4) widget。(5) 为什么法律愿意牺牲无辜的原主？最便宜的避免者（Calabresi 思想，若 FACTS 无来源则不署名，只说"谁防范最便宜，就让谁担"）。实证：Galiani & Schargrodsky 2010 确权的结果【FACTS：按 FACTS 措辞，无具体数字就不写数字】；de Soto "9.3 万亿"不要写数字。(6) boundary：模型的"错误率""调查成本"是示意；登记簿也会错（国家补偿 indemnity）。Bridge → 05：东西归属定下来，转手发生在承诺之后。
- Widget 「一块地的转手链」: 一件东西已转手 n 次（n 滑块 1–30）。每一环出问题（遗留的瑕疵/被卖二次）的概率 f（默认 0.02），出事时买家损失价款 P（默认 100）。三种制度的**每笔交易社会总成本**：(I) 真权利人优先、无公示（nemo dat）：买家要么逐环查（成本 s·n，s=1）要么赌：cost<sub>I</sub>=min(s·n, P·(1−(1−f)<sup>n</sup>))；(II) 登记簿公信力+善意取得（不动产）：买家看一次登记簿（s<sub>reg</sub>=1.5，与 n 无关）+ 在先权利人要去登记（r=1）+ 登记簿出错的概率 ε=0.002 × P：cost<sub>II</sub>=s<sub>reg</sub>+r+ε·P；(III) 占有即外观+善意取得（动产）：买家看占有（s<sub>p</sub>=0.5）+ 物被盗/遗失的概率 θ=0.005 × P（由原主承担）+ 原主防范成本 g=0.3：cost<sub>III</sub>=s<sub>p</sub>+θ·P+g。n=1 时 I 最省（1 vs 2.7 vs 1.3…请自己核），n≈3 之后 II/III 更省。画：三条成本随 n 变化的线、交叉点、当前 n；下方一条"谁吃亏"条形：I 里买家吃亏、II/III 里在先权利人吃亏（红色=那个被牺牲的人）。KPI：三种制度的单笔成本，最省的制度，被牺牲者是谁。Presets：「新开发小区 (n=1)」「老房子倒了十手 (n=15)」「二手手机 (动产)」。**反直觉：保护善意买家意味着一个没做错事的原主可能失去东西，可全体的成本更低——"公平"和"总成本"在这里分叉。**

### 05 合同：承诺凭什么能被强制，违约该赔多少
- Content: (1) the incoming baton: 转手靠承诺。承诺为什么能被强制？Carlill v Carbolic Smoke Ball (1892/1893)：广告也是要约【FACTS：判决 1892-12-07，报告引证年份 [1893]，两个年份都要说准】。(2) 违约该赔多少：三种利益——期待/信赖/返还 (Fuller & Perdue 1936–37【FACTS：[~]】)；Hadley v Baxendale (1854)：可预见性限制【FACTS】；中国《民法典》第 584 条（含"合同履行后可以获得的利益"，不得超过订立时预见或应当预见）、第 577 条、第 585 条违约金增减【FACTS：注意条文部分是转述】。(3) 默认救济不同：英美普通法默认是赔钱，实际履行是例外 (Co-operative Insurance v Argyll Stores 1998【FACTS：[~]，只写"拒绝命令继续经营"一点】)；中国《民法典》第 577、580 条以继续履行为先，但有三项例外；德国 BGB 部分【FACTS 若无则不写】。(4) 霍姆斯 "The Path of the Law" 1897 的著名话——合同责任是一种对"不履行就得赔钱"的预测【FACTS：措辞按 FACTS】。(5) widget。(6) 效率违约：Shavell 1980 【FACTS：[~]】——期待赔偿使违约决定有效率，但导致过度信赖；批评【FACTS 只写有来源的批评】。格式条款：《民法典》第 496 条【FACTS】。(7) boundary：模型里违约成本 c 是均匀分布；信息、情绪、关系、声誉都不在里面；Doing Business 已停用，不要用它的数字（FACTS 里有停用事实）。Bridge → 06：合同只管签字的人。
- Widget 「三种赔法，三种后果」: 买家付价 p=60，卖家履约成本 c ~ U[0,150]（事后才知）。买家可以先花 r 做"信赖投资"让商品对自己更值：v(r)=80+40(1−e<sup>−r/10</sup>)。社会最优：履约当且仅当 c≤v(r)；W(r)=v²/(2·150)−r（c 均匀 → P(c≤v)·v − E[c·1(c≤v)]=v²/300… 请自己推并核）；r*≈10.37, W≈26.96。四种规则：(a) 无赔偿：卖家履约当且仅当 c≤p；买家选 r 最大化 P(c≤p)(v(r)−p)−r；(b) 信赖赔偿 D=r：卖家履约当且仅当 c≤p+r；买家 max P(c≤p+r)(v−p−r)；(c) 期待赔偿 D=v−p：卖家履约当且仅当 c≤v；买家 max (v−p)−r；(d) 强制实际履行：卖家一律履约；买家 max (v−p)−r。**已核结果：无赔偿 r=4.70, 履约 40.0%, W=21.30；信赖 r=19.60, 履约 53.1%, W=19.97；期待 r=13.86, 履约 73.3%, W=26.47；实际履行 r=13.86, 履约 100%, W=21.14；社会最优 r*=10.37, W=26.96。**画：c 的分布条上标出各规则的履约阈值；下方 W 对比条形图。KPI：当前规则下的买家信赖 r、履约概率、社会福利 W、与社会最优的差。Presets 四个规则。**反直觉：期待赔偿下卖家在 c>v 时会违约，而这是对的（履约成本比买家得到的价值还高）——法律并不追求"每个承诺都兑现"；强制履行反而更差；信赖赔偿最差。同时期待赔偿也有代价：买家过度信赖（13.86 > 10.37）。**

### 06 侵权：陌生人之间的伤害，谁来为预防出钱
- Content: (1) the incoming baton: 没有合同，谁该为伤害出钱？Donoghue v Stevenson (1932) 邻居原则【FACTS】。(2) 过错 vs 严格：Hand 公式 B<PL（Carroll Towing 1947）【FACTS：FACTS 提示案情表述存疑，只用公式本身】；Rylands v Fletcher (1868) 严格责任【FACTS：若未核到就不写】；中国《民法典》第 1165 条（过错责任+过错推定）、第 1166 条（无过错责任）、第 1173 条（受害人过错）、第 1186 条（公平分担）、第 1203 条（产品缺陷）【FACTS】；美国产品责任 Escola→Greenman【FACTS：只写核到的前半段】。(3) 经济结构：事故成本=预防成本+事故损失；法律的任务是让做决定的人把"对别人的伤害"算进自己的账；Calabresi 三类成本（FACTS 若未核到则不署名）。(4) widget。(5) 活动水平：Shavell 1980 【FACTS：[~]】——过错责任只管"做得多小心"，不管"做多少"。(6) boundary：模型里的法院完美知道 x*、受害人不预防、损害可完全赔付、加害人赔得起（07 再讲赔不起）。Bridge → 07。
- Widget 「谁来为预防出钱」: 加害人每单位活动选择小心程度 x（成本 x）和活动量 a；每单位活动的事故概率 p(x)=p₀/(1+x)（p₀=0.5），损失 L=100；活动的收益 B(a)=b·a−a²/2（b=20）。每单位活动的社会成本 u(x)=x+p(x)·L；社会最优 x*=argmin u（解析：x*=√(p₀L)−1≈6.07），a*=max(0,b−u(x*))≈6.86，W*≈23.5。规则：(a) 无责任：x=0, a=b=20, W=−800；(b) 过错责任（法院标准 x<sub>d</sub>，滑块 0–15，默认 x*）：加害人恰好满足标准，x=x<sub>d</sub>，不承担事故成本，故 a=max(0,b−x<sub>d</sub>)≈13.93，W≈−1.5，事故数 a·p(x)≈0.98 vs 社会最优 0.48；(c) 严格责任：加害人承担 u(x)，选 x*、a*，W=W*。滑块也调 L、p₀、b。**反直觉：过错责任下每个人都"尽到了合理注意"，法院一次也不判错，事故仍然是最优水平的两倍——因为"做多少"没人管。（标准设得低于 x* 更糟：x<sub>d</sub>=0.5x* → W≈−66。注意标准设得"过高"会意外改善福利——这是次优修补，不要当成结论。）** 画：u(x) 曲线和 x*；a 对比条；W 对比条。KPI：x、a、事故数、W 三规则对照。

### 07 罪：为什么有些错要交给国家来罚
- Content: (1) the incoming baton: 赔偿的前提是抓得到、赔得起。(2) Blackstone：public wrongs vs private wrongs 【FACTS】；Becker 1968 威慑：预期成本 = 概率×刑罚；**h/p 是在页面上自己推出来的（不署名）**：若要让加害人把全部损害算进账，p<1 时就得罚 h/p；Becker 1968 与 Polinsky–Shavell 1979 只用 FACTS 里核到的措辞（FACTS 明说 1979 年摘要里没有 h/p 这个公式，别归给他们）；现实中 p 很小：FBI clearance rate 数字（FACTS 里按年份和口径写，clearance≠定罪）【FACTS】。(3) 赔不起 judgment-proof (Shavell 1986【FACTS】)：h/p 远超财产 → 威慑失效 → 要用无法"赔不起"的制裁：监禁（以及吊销执照等）。(4) widget。(5) 但国家出手要先把"什么是罪"写清楚：罪刑法定——中国《刑法》第 3 条、1979 年第 79 条类推与 1997 年修订废止【FACTS】；Feuerbach 1801、ECHR 第 7 条、ICCPR 第 15 条【FACTS】；罪过：中国《刑法》第 14–16 条（故意/过失/意外），美国《模范刑法典》§2.02 四级罪过【FACTS】；第 13 条的但书【FACTS】。不重讲精神病辩护 → 《犯罪心理学的逻辑》第 11 课。(6) boundary：模型把"罪"只当作"执行不了的侵权"；现实里刑法还有表达、报应、秩序（08 讲）。Bridge → 08。
- Widget 「赔不起的人」: 1000 个潜在加害人，获利 g 均匀分布在 (0, 0.8h]（h=100 是社会损害）；抓住概率 p（默认 0.2）；加害人资产 w（默认 20）；罚金 f（默认 h/p=500）；有效罚金 = min(f, w)；监禁 y 年（0–12，默认 0）：第 t 年的痛苦 d<sub>t</sub>=d₀·0.8<sup>t−1</sup>（d₀=30，**示意的适应效应，不是实证**）；国家成本 c<sub>s</sub>=25/年。加害人犯事当且仅当 g ≥ 预期制裁 p·(min(f,w)+ΣD)；社会成本 = Σ_{犯事者}(h−g) + 犯事者人数×p×y×c<sub>s</sub>。**已核：y=0 威慑 5.0%，社会成本 55 100；y=1: 12.5%/52 500；y=2: 18.5%/51 019；y=3: 23.3%/50 377；y=4: 27.1%/50 418（最低点约 3–4 年）；y=8: 36.2%/54 562；y=12: 39.9%/62 528；w=∞（财产足够）：威慑 100%、成本 0。** 画：g 的分布条涂出被威慑的部分；y 与社会成本的 U 形曲线。KPI：被威慑的比例，社会总成本，最优监禁年数（扫描），"财产足够时的成本"对照。Presets：「富人 (w=∞)」「赔不起 (w=20)」「赔不起+短监禁」。**反直觉：罚金设成再高也没用——罚不动一个没有财产的人；于是出现了一个不依赖财产的制裁，即监禁；但它有成本，所以最优刑期不是越长越好。**

### 08 刑罚：罚得重，就一定吓得住吗
- Content: (1) the incoming baton: 国家出手了，罚多少、为什么罚。(2) 四种目的：报应、威慑、隔离、矫正；每一种对"该罚多少"给不同的答案【FACTS：四分法没有单一权威出处（SEP 只分后果论/报应论），本课自己界定四个词，不署名；中国《刑法》第 5 条罪责刑相适应、第 61 条量刑——并如 FACTS 所述，注明现行刑法文本是否明文列出刑罚目的】。(3) 确定性 vs 严厉性：Beccaria 1764 的句子、Nagin 2013、NIJ "Five Things About Deterrence" 2016【FACTS：[~] 的只写"研究综述认为"】；HOPE 实验及复制的收窄【FACTS：作为"研究结论会随复制而变"的警示】；监禁与再犯 Nagin–Cullen–Jonson 2009【FACTS】。不重讲矫正与再犯 → 《犯罪心理学的逻辑》第 13、14 课。(4) widget：边际威慑 Stigler 1970【FACTS：Stigler 原文举的是偷 5 美元与偷 5000 美元受同样刑罚；「抢劫/灭口」是教学上常见的变体，课里要明说是「我们的例子」，不要说成 Stigler 的；不要用其中涉及死刑的例子】。(5) 罪刑相适应在这里获得"不只是公平，也是效率"的第二层理由。(6) boundary：模型里罪犯理性算账；很多犯罪是冲动、醉酒、群体里的；威慑的实证有限。Bridge → 09：不管罚多少，前提是认定对了人。
- Widget 「抢劫与灭口」: 1000 个潜在罪犯，获利 g 均匀 (0, 60]。选项：不犯 (u=0)；抢劫 u₁=g−p₁S₁（p₁=0.3）；抢劫并杀死目击者 u₂=g−p₂S₂−m（p₂=0.2 灭口使被抓概率降低，m=3 灭口的额外代价）。刑罚 S₁（抢劫）与 S₂（抢劫杀人）两个滑块（0–200）。选效用最高且为正者。伤害：抢劫 h₁=30，杀人额外 h₂=200。**已核：S₁=5,S₂=60 → 抢劫 975、灭口 0、伤害 29 250；S₁=20,S₂=100 → 抢劫 900、灭口 0、伤害 27 000；S₁=40,S₂=40（轻罪也罚到和重罪一样）→ 抢劫 0、抢劫+灭口 817、伤害 187 910；S₁=40,S₂=100 → 抢劫 800、灭口 0、伤害 24 000。灭口条件：(p₁−p₂)·S₁ − p₂·(S₂−S₁) > m。** 画：(S₁,S₂) 平面三色区域图（不犯/抢劫/灭口）+ 当前点；下方条形：三种选择的人数与总伤害。第二个控件 p₁（抓住概率）：展示把抓住概率提高 vs 把 S₁ 提高，哪个更省——确定性 vs 严厉性（保持乘积 p₁S₁ 不变时，威慑相同，但灭口的诱因不同）。KPI：三类人数，总伤害，"灭口临界的 S₁"。Presets：「轻罪轻罚、重罪重罚」「一律重判 (S₁=S₂=40)」「抓得更准 (p₁↑)」。**反直觉：把轻罪的刑罚提到和重罪一样，不只吓不住，反而招来更重的罪。**

### 09 程序：为什么「怎么判」比「判什么」更先
- Content: (1) the incoming baton: 判错的代价。(2) 程序的两层作用：减少错误（工具性）；让输的人也接受（Tyler 1990【FACTS】）。(3) 三条古老要求：自己不当自己案子的法官 (Dr Bonham 1610 / Dimes v Grand Junction Canal 1852 / "justice must be seen to be done" 1924【FACTS 核到哪个写哪个】)；听取双方 audi alteram partem；说明理由。交叉询问 (Wigmore)【FACTS】。(4) 两大诉讼模式：对抗制 vs 职权调查（德国 StPO §244 Abs.2【FACTS】）；(5) 无罪推定：中国《刑事诉讼法》第 12 条、第 55 条、第 56 条非法证据排除、2018 年修正【FACTS：写明版本】；Mapp v Ohio 1961【FACTS 在课 10 里】。(6) widget：程序要配多重——Mathews v. Eldridge (1976) 三因素【FACTS】。(7) 认罪：美国联邦约九成以上以认罪结案【FACTS 按年份口径】、Missouri v. Frye 判词【FACTS】、中国刑诉法第 15 条认罪认罚从宽【FACTS】——程序保障被"交易"换掉了什么。不重讲讯问与假供 → 《犯罪心理学的逻辑》第 06、07 课；陪审团 → 第 12 课。(8) boundary。Bridge → 10。
- Widget 「程序要配多重」: 五项保障（书面通知 r=0.30,c=20；听证 r=0.35,c=200；律师 r=0.30,c=600；交叉询问 r=0.30,c=300；上诉 r=0.30,c=900；r=该保障把错判概率乘以(1−r)，c=单案成本）。基线错判概率 e₀（滑块 0.02–0.4，默认 0.2）；一旦判错的损失 L（对数滑块 10<sup>3</sup>–10<sup>7</sup>，默认 10<sup>5</sup>）。**对 2⁵=32 种组合穷举：总成本 = e·L + Σc，e=e₀·Π(1−r)；选使总成本最小的组合。** 已核：e₀=0.2 时 L=1000 → 只配书面通知；L=10<sup>4</sup> → 通知+听证；L≥10<sup>5</sup> → 全配；e₀=0.05,L=10<sup>5</sup> → 通知+听证+交叉询问。画：32 个组合的总成本条（排序）+ 最优标亮；五个保障的开关。KPI：最优组合、错判概率、总成本、"不配任何保障"的总成本。Presets：「停车罚单」「开除」「重罪」。**反直觉：程序不是越多越好——它的价值取决于错判的代价；同一套规则下"小事用轻程序、大事用重程序"才是合理的。**（并在"模型的边界"里说明：Tyler 的结论提示程序还有"让人服气"的价值，模型没算，因此低估了轻程序的价值。）

### 10 证据与证明标准：不确定里，多确定才够判 — (lead-written exemplar)

### 11 法律推理：规则遇上没想到的案子
- Content: (1) the incoming baton: 事实定了，怎么落进规则。(2) 标准三段论 + 它的局限：规则有"核心"与"边缘"——Hart 1958 "公园里不得有车辆"，Fuller 的反驳【FACTS】。(3) 两种读法：文义 vs 目的——Church of the Holy Trinity v. United States (1892)【FACTS】；Riggs v. Palmer (1889)【FACTS】；Savigny 四要素、Heydon's Case【FACTS】；中国《民法典》第 10 条（法律没有规定的，可以适用习惯，不得违背公序良俗）【FACTS】。(4) widget：先例类比。(5) 先例制度：stare decisis；英国上议院 1966 年 Practice Statement【FACTS】；Ehrlich & Posner 1974【FACTS】；中国：2010 年《关于案例指导工作的规定》与指导性案例【FACTS：严格按 FACTS 的措辞，"应当参照"一词只在 FACTS 核到时才用】。(6) boundary。Bridge → 12。
- Widget 「公园里不许有车」: 二维平面：横轴 a = 文义相似度（像不像"车辆"），纵轴 b = 目的相关度（有没有立法者想防的危险）。真值（立法目的）：禁止当且仅当 b ≥ 0.45+0.25·sin(3a)（曲线边界，**不是**轴对齐线，这样先例才需要慢慢积累）；文义规则：禁止当且仅当 a≥0.5。先例集：n 个已决案件（用 Halton 序列 base 2,3 的前 n 点确定性生成），带真值标签（可混入噪声：错判比例 0–30%）；新案件用最近 3 个先例投票（k=3，n<3 时用全部）。**已核：文义规则正确率≈0.49；先例数 n=1 或 3 → 0.62；5 → 0.86；10 → 0.88；20 → 0.92；40 → 0.94；80 → 0.97；160 → 0.98；320 → 0.99；10% 错判先例时 n=40 → 0.87，n=320 → 0.97。** 画：散点（已决案件=实心点，颜色=禁/不禁）、曲线边界（虚线）、新案件测试点背景（浅色，被判错的涂红）。KPI：文义规则正确率、先例类比正确率、先例数、"分歧区"占比（文义与先例判断不一致的比例）。控件：先例数 n（0–320，对数）、错判先例比例、"换一批测试案件"按钮（换 Halton 偏移）。Presets：「新法刚出 (n=3)」「判过几十个 (n=40)」「有些先例判错 (噪声 10%)」。**反直觉：条文自己不会变准，但先例越多，原本模糊的标准越像一条清楚的规则；错误的先例会拖着后来者一起错——先例是双刃的。**

### 12 诉讼的账：为什么大多数官司没打到判决
- Content: (1) the incoming baton: 规则、先例、程序齐了，结果更可预测——可预测就意味着没必要打。(2) 和解空间：原告期望 − 成本 vs 被告期望 + 成本【FACTS：Shavell/Posner，教科书表述】；(3) 选择效应：Priest & Klein 1984【FACTS：注意"五成"只在特定假设下趋近】；"消失的审判"Galanter 2004【FACTS：具体数字按 FACTS】；中国法院案件规模与调解【FACTS：若数字没核到就只写定性】。(4) widget。(5) 法律的影子：Mnookin & Kornhauser 1979【FACTS】；费用规则：美国规则 vs 英国规则 vs 中国《诉讼费用交纳办法》第 29 条【FACTS】；ADR：纽约公约、新加坡调解公约【FACTS】；争议金字塔 Felstiner–Abel–Sarat / Miller–Sarat【FACTS：[~] 的只写定性】。(6) boundary：风险中性、成本固定、没有声誉效应。Bridge → 13。
- Widget 「谁会走进法庭」: 案件"真实强度" m ~ N(μ,1)（μ 滑块 −1.5…1.5，代表"整体上原告该赢的程度"，默认 0.8），法院判原告胜的真实概率 Φ(m/s<sub>c</sub>)（s<sub>c</sub>=1）；原被告各自带噪声估计 m+σ<sub>e</sub>·e（σ<sub>e</sub> 滑块 0.2–2.0，默认 1.0），估得胜诉概率 p<sub>P</sub>、p<sub>D</sub>；和解当且仅当 (p<sub>P</sub>−p<sub>D</sub>)·J ≤ c（c=双方成本之和，J=标的；用 c/J 滑块 0.02–0.5，默认 0.1）；否则进审判。用 31(m)×21×21 的标准正态分位格点做确定性积分。**已核（σ<sub>e</sub>=1, c/J=0.1）：μ=0 → 进审判 34.5%，审判中原告胜 50.0%，总体 50.0%；μ=0.8 → 31.4%，审判中 66.6%，总体 71.4%；μ=−0.8 → 31.4%，审判中 33.4%，总体 28.6%；μ=0.8 且 σ<sub>e</sub>=0.4 → 进审判 19.9%，审判中 62.2%；σ<sub>e</sub>=2 → 34.5%，69.2%；c/J=0.02 → 42.8%，69.1%；c/J=0.3 → 16.3%，64.1%。** 注意：默认参数下"进审判比例"高于现实（现实远低于此），写课时说明是示意，可调整默认值使进审判比例更小（比如 c/J 提到 0.3 或 σ<sub>e</sub> 降低），但**不要**让图暗示真实比例。画：横轴 m 的分布，涂出和解区/审判区；柱状：总体原告胜率 vs 审判中原告胜率。KPI：进审判比例，审判中原告胜率，总体原告胜率，两者之差（选择效应）。Presets：「双方看法接近 (σ<sub>e</sub>=0.4)」「成本很高」「原告整体占理 (μ=0.8)」。**反直觉：打到判决的案子，胜率被拉向五成（相对总体）——官司的胜率不能直接当成"法律站在哪边"的证据。**

### 13 两大法系：判例一案一案积累，法典一次写成
- Content: (1) the incoming baton: 影子的形状取决于规则怎么长出来。(2) 两条路的历史：普通法（Henry II 的巡回法官、Magna Carta 1215【FACTS 核到什么写什么】）；大陆法（Corpus Iuris Civilis 529–534；Code civil 1804；BGB 1896/1900；日本继受德国法）【FACTS】。(3) 中国：1949 年废除六法全书的指示；《民法通则》1986；《民法典》2020-05-28 通过、2021-01-01 施行；2011 年宣布"中国特色社会主义法律体系已经形成"【FACTS】；指导性案例（11 课已提）。一国多法域：香港基本法第 8 条（普通法保留）、澳门、魁北克、路易斯安那、苏格兰【FACTS】——**一句话事实，不评论**。(4) widget。(5) 两个有争议的命题：普通法更有效率 (Rubin 1977 / Priest 1977)；法律起源与金融发展 (La Porta et al. 1998) 以及 Spamann 2010 的批评【FACTS：两边都写】；JuriGlobe 的数量【FACTS：[~]】。(6) boundary。Bridge → 14。
- Widget 「法典与判例，谁追得上世界」: 世界上"最合适的规则"θ 每年随机游走（步长 σ，滑块 0.02–0.8，"变化快慢"）；法典：每 T 年（滑块 5–40，默认 20）立法一次，把规则改到当年的 θ，成本 K=10；判例：每年规则向"法官看到的信号 θ+噪声"移动 λ 比例（λ 滑块 0.05–0.5，默认 0.2），法官只看见局部案件，信号噪声 σ<sub>η</sub>=2，另付每年"不确定性成本" u=0.3；每年损失 = (θ−规则)²。200 个确定性种子（LCG）× 200 年取平均。**已核（T=20,K=10,λ=0.2,σ<sub>η</sub>=2,u=0.3）：变化速度 0.02 → 法典 0.50 / 判例 0.75；0.1 → 0.59 / 0.76；0.2 → 0.88 / 0.82；0.4 → 2.01 / 1.03；0.8 → 6.53 / 1.87。交叉点约在 σ=0.2。**（不要做"混合"曲线——上一版的混合设计被两者夹击，没有教学价值；真实法域两者并存，在正文里说，不在模型里画。）画：θ 与两条规则轨迹（一个种子的 200 年）；右侧条形：平均年损失。KPI：法典年损失、判例年损失、更省的一条、交叉点（σ 扫描求得）。Presets：「变化很慢的领域 (σ=0.05)」「变化很快的领域 (σ=0.6)」「法官只看到局部 (σ<sub>η</sub>=3)」。**反直觉：没有哪条路永远占优——变化慢、需要整齐统一时法典占优；变化快、信息散在案件里时判例追得更快；代价是判例的噪声。（不要写"哪个法系更好"。）**

### 14 公司：法律发明的「不是人的人」
- Content: (1) the incoming baton: 法律还要回答"谁是主体"。公司签合同、被起诉、拥有财产。(2) Salomon v Salomon (1897)【FACTS】；资产分割 Hansmann & Kraakman 2000【FACTS】；有限责任的立法史（Joint Stock Companies Act 1844 / Limited Liability Act 1855 等）【FACTS：核到什么写什么】。(3) 中国《公司法》：1993/1994；**2023-12-29 通过、2024-07-01 施行**；第 3、4 条（独立法人财产、有限责任）、第 23 条（人格否认）、第 47 条（五年内缴足）【FACTS：条号只用 2023 版，旧版条号不同】。(4) widget：风险转移 (Jensen & Meckling 1976【FACTS】)。(5) 揭开公司面纱 Thompson 1991【FACTS】；受信义务 Dodge v. Ford (1919)【FACTS】。(6) boundary：模型只有两种项目、债权人理性；不提公司的政治与社会责任争论。Bridge → 15。
- Widget 「有限责任与风险转移」: 公司负债面值 D（默认 80）；两个项目：安全项目 S 确定回报 105；风险项目 R 以 p=0.5 回报 150、以 0.5 回报 50（期望 100，价值更低）。股东只拿 max(回报−D,0)（有限责任）或回报−D（无限责任）。**已核：安全 → 股东 25；风险 → 有限责任股东 35、无限责任股东 20；债权人在风险项目下期望拿 0.5·80+0.5·50=65（< 80）；R 的社会价值 100 < S 的 105。** 滑块：D、R 的波动幅度（150/50 → 150±ΔΔ）、均值差、揭开面纱概率 q（出了问题时债权人追股东个人的概率）。债权人预期到股东的选择，据此定价：借款额 = 预期还款 / (1+r)，隐含利率 r；有限责任的"成本"体现为债权人要的利率溢价。画：股东在 S 与 R 下的收益；债权人的收益；项目价值。KPI：股东选哪个、社会价值损失、债权人预期回收率、隐含利率溢价。Presets：「债务很少 (D=30)」「高负债 (D=80)」「加上揭开面纱 q=0.5」。**反直觉：有限责任下，股东会偏爱价值更低、但风险更大的项目——因为输了有人替他们背；债权人知道，所以先涨价。**

### 15 知识产权：为看不见的东西造出人为的稀缺
- Content: (1) the incoming baton: 公司最值钱的东西可以被复制。(2) 非竞争品；Statute of Anne 1710（14+14 年）、威尼斯专利法 1474、垄断法 1624【FACTS】；TRIPS 第 33 条 20 年、第 12 条 50 年、伯尔尼公约【FACTS】；美国 CTEA 1998 与 Eldred v. Ashcroft (2003)【FACTS】；中国《专利法》2020 修正（2021-06-01 施行；发明 20 年、实用新型 10 年、外观设计 15 年）、《著作权法》2020 修正（作者终身+50 年）【FACTS：版本与条号】。(3) 经济学：Nordhaus 1969【FACTS】；实证：Moser 2005、Williams 2013、Raustiala & Sprigman 2006【FACTS】；Boldrin & Levine 作为分歧的一方【FACTS】；Doha 与强制许可【FACTS 若核到】。(4) widget。(5) boundary：模型里只有"激励创新"一个目的；没有累积性创新的完整结构。Bridge → 16。
- Widget 「保护期该多长」: 一项创新的研发成本 K<sub>i</sub> 对数正态（中位数 K<sub>med</sub>=6，σ=0.6，滑块可调），每年独占利润 π=1（示意），折现率 δ（滑块 0.03–0.2，默认 0.08）；保护期 T 年（5–60）。创新者投资当且仅当 PV(T)=π(1−e<sup>−δT</sup>)/δ ≥ K<sub>i</sub>。社会价值：保护期内每年 1.5（利润 1 + 消费者 0.5，线性需求下无谓损失 0.5），保护期后每年 2.0（全部归社会）；"累积创新阻碍"φ（滑块 0–0.6，默认 0.3）使保护期内每年再减 φ；W(T)=Σ_{创新者}[(1.5−φ)·A(T)+2·e<sup>−δT</sup>/δ − K<sub>i</sub>]/N。**已核（δ=0.08, K<sub>med</sub>=6, σ=0.6, φ=0.3）：T=5 → 被创新 26.6%，W/潜在 4.97；10 → 59.1%/8.96；15 → 73.5%/9.56（峰值）；20 → 80.2%/9.35；25 → 83.7%/9.02；30 → 85.7%/8.75；40 → 87.5%/8.39；60 → 88.7%/8.14。** 注意：这里的峰值 T=15 是参数的产物，**不要**说"最优期限是 15 年"；教学点是形状：创新比例的增长越来越慢，而保护期的代价线性累积。画：创新比例随 T 的曲线、福利随 T 的曲线、当前 T；对照"20 年"（TRIPS 专利）的竖线。KPI：被创新的比例、福利、T 从 20 提到 40 带来的创新比例增量 vs 保护期翻倍。Presets：「药品 (K 大)」「软件 (K 小, δ 大)」「时装 (几乎不需要保护: K 极小)」。**反直觉：保护期翻倍，创新只多一点点——折现把远期利润压得很小；而被保护的每一项都要付更长的代价。**

### 16 隐私与同意：人人都点了「同意」，之后呢
- Content: (1) the incoming baton: 同意曾经是私法的万能钥匙（合同=同意）。数据不一样。(2) Warren & Brandeis 1890【FACTS】；德国 1983 人口普查案与信息自决【FACTS】；GDPR（2016 通过，2018-05-25 适用；第 6 条六项合法性基础，第 7 条同意，第 83 条罚款）【FACTS】；中国《个人信息保护法》（2021-11-01 施行；第 13 条七项合法性基础、第 14 条同意须"充分知情、自愿、明确"、第 6 条最小必要、第 66 条罚款）【FACTS】；美国分行业立法与 CCPA/CPRA【FACTS】。(3) 同意的失灵：McDonald & Cranor 2008 的 201 小时【FACTS：带口径】；Obar & Oeldorf-Hirsch 的"头生子女条款"【FACTS：样本与数字】；Solove 的"同意困境"【FACTS】。(4) widget。(5) 从"同意"转向"默认规则"：目的限制、最小必要、合法性基础（不依赖同意）；大额执法案例只陈述事实【FACTS】。不重讲监控与元数据 → 《侦查与反侦察的逻辑》第 15 课。(6) boundary。Bridge → 17：我们谈的主要是公民之间的法律。
- Widget 「没人读得完的同意书」: 每人每年遇到 n 份政策（滑块 10–2000；默认取 FACTS 里 McDonald–Cranor 的口径，只在 FACTS 核到时用其数字），政策长度 L（词，滑块 200–8000），阅读速度（词/分钟，固定，取 FACTS 或写"示意"），时间价值（元/小时，滑块）。用户 i 对"坏条款"的在乎程度 H<sub>i</sub> 均匀分布在 (0, H<sub>max</sub>]，坏条款出现概率 q（0.2），读了能识别的概率 0.7。**用户读当且仅当 q·0.7·H<sub>i</sub> > 读这份的时间成本（L/速度 × 时间价值）。** 制度 A（告知-同意）：读者受保护，不读者承担 q·H<sub>i</sub>；制度 B（默认规则/最小必要，覆盖率 κ=0.8，合规成本 c<sub>B</sub> 示意）：坏条款被禁止 κ 的部分，与是否读无关。KPI：愿意读的人占比，若人人都读的总时间（小时/年），制度 A 的总损害，制度 B 的总损害+合规成本。Presets：「短政策 (L=500)」「长政策 (L=6000)」「只靠默认规则」。**反直觉：告知越详细（L 越大），愿意读的人越少，保护反而越差；默认规则不受这个影响。**（具体“201 小时”等数字只在 FACTS 核到时引用，且要和模型输出分开写。）

### 17 行政法：国家也是一个当事人
- Content: (1) the incoming baton: 国家本身是最强的当事人。(2) 行政行为与救济三条路：复议、诉讼、赔偿——中国《行政诉讼法》（1989 通过、1990-10-01 施行；2014 与 2017 修正）、《国家赔偿法》（1994/1995）、《行政处罚法》（2021 修订，2021-07-15 施行）、《行政许可法》（2003/2004-07-01）、《行政复议法》（2023 修订，2024-01-01 施行）；**行政机关负责人出庭应诉**的条款【FACTS：以 FACTS 条号为准】。(3) 比较：法国 Conseil d'État (1799)、Blanco (1873)；德国 VwGO 1960；英国 Wednesbury (1948)、GCHQ (1985) 三分；美国 APA 1946、Chevron 1984 及 Loper Bright (2024-06-28)【FACTS：只写核到的】。(4) 审查强度：比例原则（德国药店案 1958；中国《行政处罚法》第 5 条过罚相当、《行政强制法》第 5 条）【FACTS】。(5) widget。(6) 一个具体而中立的行政诉讼案例【FACTS】。(7) boundary：模型里公民理性、法院判断无误。Bridge → 18：行政机关受法律约束，那法律本身呢？
- Widget 「起诉成本与机关的小心」: 公民的利害 S 均匀分布在 (0,100]；机关每个决定投入"小心" x（成本 x），错误概率 e(x)=e₀·e<sup>−x/4</sup>（e₀=0.3）；公民受到错误决定后是否提起救济，取决于 λ·S·0.8 是否超过救济成本 c（c 滑块 0–100；λ=法院纠错的力度，滑块 0–1，默认 0.9；用 logistic 平滑代替硬门槛，宽度 5）；机关被纠正一次的代价 P=40。机关选 x 使 x + e(x)·Pr(被诉)·λ·P 最小。未被纠正的损害 = e(x)·(1−Pr(被诉)·λ)·平均利害 50。**趋势已核：c=2 → 机关小心 3.85，错误率 11.5%，97% 的人会救济，每案未纠正损害 0.73；c=10 → 3.37/12.9%/86%/1.46；c=30 → 1.83/19.0%/59%/4.49；c=60 → 0.00/30%/17%/12.77。（硬门槛版本；平滑后应保持趋势但更圆润。）** 画：横轴 c，三条线（机关的小心、错误率、会去救济的比例）；当前点标亮。KPI：机关小心水平、错误率、救济比例、每案未纠正损害。Presets：「复议免费」「诉讼贵得离谱」「法院几乎不纠错 (λ 低)」。**反直觉：救济的"权利"写在纸上不够，成本一高，机关就不再小心——被纠正的威胁本身，比实际纠正更重要。**

### 18 宪法与司法审查：谁来判一部法律本身合不合法
- Content: (1) the incoming baton: 行政受法律约束；法律受谁约束？(2) 美国：Marbury v. Madison (1803)、"say what the law is"【FACTS】；欧陆：凯尔森 1920 奥地利、德国基本法 1949 与联邦宪法法院、法国宪法委员会 1958/1971/2008 QPC【FACTS】；英国：议会主权 + Human Rights Act 1998 第 4 条不一致声明【FACTS】；中国：1982 宪法第 62、67 条；备案审查（立法法条文按当前版本核对）、2018 年机构调整；**孙志刚事件后的审查建议与 2003 年办法的废止；2013 年劳动教养的废止；齐玉苓批复 2008 年废止**【FACTS：只陈述事实】；世界范围的审查机制比例 (Ginsburg & Versteeg 2014)【FACTS】。(3) 反多数难题 Bickel 1962【FACTS】。(4) 比例原则的三步：适当、必要、狭义比例【FACTS 若核到】。(5) widget。(6) boundary。Bridge → 19。不重讲分权与法治的政治理论 → 《政治的逻辑》第 05 课。
- Widget 「三种审查强度」: 六部**虚构**的法律（如「居民区夜间禁放烟花」「外卖骑手须持健康证」「网络直播实名」「某类药品禁止做广告」「公共场所禁止拍照」「车辆限行日」——**不要真实政治议题**），每部有：目的重要性 G（0–10）、手段有效度 σ（0–1）、对权利的负担 B（0–10）、是否存在"负担更小、效果几乎一样"的替代 alt（0/1）与其效果比 α（0–1）。三种审查：**合理性审查**（通过当且仅当 G>0 且 σ>0.2）；**严格审查**（通过当且仅当 G≥8 且 σ≥0.8 且 不存在 α≥0.9 的更轻替代）；**比例原则**（三步：适当性 σ>0.5；必要性 不存在 α≥0.8 的更轻替代；狭义比例 B ≤ k·G·σ，k 滑块 0.5–3，默认 1.5）。再给一个"真值"：净收益 G·σ − B > 0 视为"这部法律值得"。**对 1000 部（G,σ,B 格点）计算每种审查的 I 类错误（推翻了值得的法律）与 II 类错误（放过了不值得的法律）数量。** 画：六部法律 × 三种审查的通过/不通过矩阵；下方三种审查的错误对比条。KPI：每种审查推翻的法律比例，I 类错误，II 类错误，"审查越严，总错误数不一定更少"。Presets：「宽松」「严格」「比例原则」。**反直觉：审查越严，不是错越少，只是把错误从"放过坏法"换成"推翻好法"——换谁来背错，是政治与制度选择（反多数难题）。**

### 19 国际法：没有世界警察，为什么还被遵守
- Content: (1) the incoming baton: 国与国之间没有终极裁判。(2) 渊源与同意：VCLT 1969/1980、第 26 条 pacta sunt servanda；ICJ 规约第 38 条；第 36 条任择条款的接受国数量；联合国宪章第 94 条；Nicaragua v. USA (1986)【FACTS】；Lotus (1927) 与管辖权五基础、North Sea (1969) 与习惯【FACTS】。(3) 为什么仍被遵守：Henkin 的句子；互惠与声誉（Axelrod、Guzman、Goldsmith–Posner 的分歧）【FACTS】；WTO 争端解决：DSU 第 22 条授权报复；上诉机构 2019-12-11 起无法运作【FACTS：只陈述事实】；蒙特利尔议定书的贸易条款【FACTS 若核到】；UNCLOS 强制程序【FACTS：南海仲裁只在"备用"里，**本课不写**】。(4) widget。(5) boundary。Bridge → 20。不重讲国际无政府状态 → 《政治的逻辑》第 10 课；《世界的逻辑》各区域卡片的国际条约不重讲。
- Widget 「没有警察的合规」: 违约一次的一次性收益 g（滑块 0–20，默认 10）；每期合作收益 b（2）；被发现的概率 d（0–1，默认 0.7）；被发现后合作中断 T 期（1–10，默认 5）；折现因子 δ（0.3–0.99，默认 0.9）；受影响的伙伴数 m（1–6，默认 1；联动/多边）。**遵守当且仅当 g ≤ d·b·m·Σ<sub>t=1..T</sub> δ<sup>t</sup>**。画：以 δ 为横轴、d 为纵轴的"遵守区域"（色块），当前点；另一图：m 从 1 到 6 时临界 g 的变化。KPI：违约的得失（g vs 预期损失）、是否遵守、临界 g、临界 d。Presets：「双边、短期惩罚」「多边条约」「很看重眼前 (δ 小)」。**反直觉：违约的代价不是被"抓"，而是将来没人跟你合作；伙伴越多、关系越长，遵守越稳——没有警察也可以。注意：模型不说明哪个国家遵守得好或差，也不涉及任何具体争端。**

### 20 收官：法律的边界，与读懂任何一条法律新闻的六个问题
- Content: (1) the incoming baton: 拆开装置之后，边界在哪。(2) 法律之外的秩序：Ellickson Shasta County【FACTS】；Macaulay 1963 商人【FACTS】；Tyler 的合法性【FACTS 若与课 09 重复只回扣】；法律与道德：Radbruch 1946、纽伦堡审判 1945–46【FACTS】；人民调解与《人民调解法》2010/2011【FACTS：只陈述事实】。(3) 争议金字塔：从 grievance 到判决，衰减【FACTS：[~] 的只写定性】；"法律的影子"回扣 12；获得司法救济的缺口 OECD/WJP 2019、51 亿、LSC 2023 的 92%【FACTS：[~] 的按口径写】；WJP 法治指数的覆盖范围与八因素（**不抄任何国家排名**）【FACTS】。(4) widget。(5) 回望整条链：把 21 课装进"三个问法"再扩成**六问**：谁定的规则？把什么分给了谁？违反了谁来裁？凭什么证据？错了谁吃亏？裁判者又被谁管？每一问回指课号。(6) 一份"读法律新闻的六问清单"（`.trade-table`：新闻类型 × 六问 × 回指课号：新规出台、某人被判、公司被罚、违宪审查、条约争端）。(7) 完整声明：这门课不是法律意见；有争议的问题我们摆出分歧，不站队。
- Widget 「一个纠纷的二十一站」（建议名「纠纷漏斗」）: 1000 个纠纷从"受了委屈"出发，经过阶段：①意识到并归咎 ②向对方主张 ③谈判/和解 ④找律师/调解 ⑤起诉 ⑥审理判决 ⑦上诉/执行。每阶段留存率 = logistic((标的 − 该阶段成本)/(0.4×成本+1) + 信任)；标的 S（滑块，示意单位 100–10000，对数）；各阶段成本（示意：5,20,60,150,300 的倍数，滑块「总体费用水平」 ×0.2–5）；对司法的信任（−2…+2）。**示意性校准：把默认值调到呈金字塔（顶端 1000 → 只有少数走到判决；不要伪装成 Miller–Sarat 的真实比例，除非 FACTS 核到并按其口径写）。** 每一阶段旁标注对应的课号（如⑤起诉→课 09、⑥判决→课 10–11、③和解→课 12）。KPI：到判决的比例，在法庭之外了结的比例，提高“起诉费用”对到判决数的影响 vs 提高“主张前”成本的影响（对比两个按钮）。Presets：「小额纠纷」「大额纠纷」「对司法不信任」。**反直觉：99% 的法律在法庭之外工作；提高早期环节（意识到、主张）的成本，比提高诉讼费更能让纠纷"消失"——access to justice 的缺口大半在漏斗前端。**

## §6 Dedup red lines (cite, don't re-teach)

- 自然状态、霍布斯、暴力的垄断、社会契约 → 《政治的逻辑》第 01、03 课；合法性 → 第 04 课；**富勒八项、法治 vs 以法而治、分权与宪政 → 第 05 课**；自由与权利的政治哲学 → 第 07 课；国际无政府状态 → 第 10 课。
- 无国家社会的秩序（世仇、调解） → 《人类学》第 09 课。
- 凭什么服从、公正的分配（哲学） → 《哲学》第 14、15 课；事实与价值的鸿沟 → 第 12 课。
- 政体、官僚与国家能力、否决者 → 《政体的逻辑》第 05、13 课。
- 犯罪的定义与标签 → 《犯罪心理学的逻辑》第 01 课；讯问、假供、目击者、侦查员偏误、精神病辩护、陪审团与法庭、危险性评估、矫正与再犯 → 第 06、07、08、10、11、12、13、14 课。**课 07–10 只讲法律装置本身，不重讲这些心理机制。**
- 监控、元数据、取证 → 《侦查与反侦察的逻辑》第 15、16 课。
- 公司的利润、护城河、资本配置 → 《财报的逻辑》第 11、12 课（课 14 只讲公司的法律结构）。
- 货币、银行、资本主义的历史 → 《人类与文明简史》第 07、14 课。
- 认知偏误 → 《心理学》第 06 课。
- Inside this series: 第三方 01; 规则与标准 02 (11 reuses); 权利结构 03 (04, 14, 15 build on); 登记与善意取得 04; 合同 05; 侵权 06; 刑罚 07–08; 程序 09; 证明标准 10 (09, 18 reuse the idea of threshold); 推理与先例 11 (13 builds on); 诉讼的账 12 (20 reuses); 法系 13; 公司 14; 知识产权 15; 隐私 16; 行政 17; 宪法 18; 国际 19; 边界与六问 20.

## §7 Sibling titles (exact)

《政治的逻辑》 `../../politics/lessons/`: 01_state_of_nature 自然状态：没有政府会怎样？ · 02_collective_action 合作的困境：囚徒困境、公地悲剧与搭便车 · 03_social_contract 社会契约与国家：暴力的垄断 · 04_sovereignty_legitimacy 主权与合法性：我们为什么服从？ · 05_constraining_power 驯服利维坦：宪政、分权与法治 · 07_liberty_rights 自由与权利：个人与国家的边界 · 10_international_order 国家之间：无政府状态的回归.
《政体的逻辑》 `../../regimes/lessons/`: 05_bureaucracy 谁来执行：官僚、代理人与国家能力 · 13_veto_players 否决者：为什么有的国家改不动.
《犯罪心理学的逻辑》 `../../criminal_psychology/lessons/`: 01_what_is_crime 犯罪是什么：越轨、法律与标签 · 06_interrogation 讯问的心理学：如何让人开口 · 07_false_confessions 假供：无辜者为什么会认罪 · 08_eyewitness_memory 记忆不是录像：目击者与冤案 · 10_investigator_bias 侦查员的思维陷阱：隧道视野与确认偏误 · 11_insanity_responsibility 疯癫与罪责：精神病辩护与刑事责任能力 · 12_jury_courtroom 陪审团与法庭里的心理学 · 13_risk_assessment 危险性评估：预测暴力的科学与限度 · 14_rehabilitation 矫正与再犯：惩罚、治疗，还是绝望.
《侦查与反侦察的逻辑》 `../../reconnaissance/lessons/`: 15_mass_surveillance 当探测变得免费：大规模监控与隐私 · 16_forensics 事后追凶：取证与反取证.
《人类学》 `../../anthropology/lessons/`: 09_political_power 政治与权力：没有国家，秩序从哪来.
《哲学》 `../../philosophy/lessons/`: 12_is_ought 善从哪来？事实与价值的鸿沟 · 14_social_contract 凭什么服从？社会契约与国家的正当性 · 15_justice 公正如何分配？罗尔斯与诺齐克.
《财报的逻辑》 `../../financials/lessons/`: 11_good_business_moat 好生意：护城河与高回报的可持续性 · 12_management_capital_allocation 管理层与资本配置：同一门生意，不同的每股命运.
《人类与文明简史》 `../../history/lessons/`: 07_money 金钱：最普遍的互信系统 · 14_capitalism 资本主义：把未来借到现在.
《心理学》 `../../psychology/lessons/`: 06_thinking_biases 思维与判断：捷径是缺陷，还是算力有限下的最优解.
《世界的逻辑》 `../../world_regions/lessons/`: 03_the_board 今天的牌面：一个国家的四个读数.

## §8 QA

```
node tools/law_qa/verify.js all_lessons/law/lessons/NN_slug.html     # must end errors=0
node tools/cooking_qa/kpi.js all_lessons/law/lessons/NN_slug.html click:wNN-x set:wNN-y=V
node tools/cooking_qa/layout.js all_lessons/law/lessons/NN_slug.html 320   # and 700; after every button/preset state
```
Warnings "planned but not written yet" are expected while other lessons are being written. Self-check before replying: balance of `<p>/<strong>/<em>/<div>` tags; no stray `</p>` inside callouts; 常见误解 has 4–6 items; exactly 1 `.widget` and 1 `<canvas>`; a `callout warn` titled 模型的边界; a `callout source-note` titled 出处小注; every prose number/statute/case traceable to FACTS or derived on the page; every legal statement tagged with its jurisdiction (and statute version); no 他/她; no hot-button value positions.
