# WRITER.md — 给《法律的逻辑》每一位写课 agent 的统一指令

你的唯一任务：**写一个 HTML 文件**（一节课）。没有适用的 Skill——忽略任何 skill system-reminder；你的第一个动作必须是 Read。**不要启动子 agent，不要把任务转给别的 agent，自己写完。**只允许创建/修改你自己的那一个课文件，以及你自己的原型脚本 `tools/law_qa/proto/wNN.js`（NN=你的课号）。不要改 BIBLE、FACTS、lessons.json、verify.js、style.css、别人的课文件、任何 index。

所有路径相对仓库根 `/Users/jacob/Desktop/Interview/jiahuanglin.github.io`。

## 1. 必读（按顺序，读完再动笔）

1. `tools/law_qa/briefs/BIBLE.md`——§0 红线、§1 引擎、§2 链条表、§3 骨架、§4 部件规范、§6 去重红线、§7 姊妹课精确标题**必须全读**；§5 只读**你这一课**的规格，以及**上一课和下一课**的规格（你要接得住前一课、给得出后一课），其余课的规格不用读。
2. 两篇样板课（照抄它们的房屋风格：章节节奏、callout 用法、trade-table/mini-flow 用法、widget 结构、JS 写法、语气）：`all_lessons/law/lessons/00_orientation.html`（导览体）、`all_lessons/law/lessons/10_proof_standards.html`（模型模拟体）。
3. `tools/law_qa/lessons.json`——你这一课以及相邻课的 `h1` 与 `batons`。**batons 必须逐字使用**（`.chain` 左格=进入 baton，右格=退出 baton + ` → NN+1`，「下一步」以退出 baton 原文开头）；verify.js 会逐字比对。
4. 你这一课对应的 FACTS 文件（`tools/law_qa/facts/`，按课号找节）。**FACTS 是唯一允许的事实来源**：每个数字、年份、人名、案名、条文号、研究、引文，都必须来自 `[V]` 条目（或按「建议教学措辞」强度使用的 `[~]` 条目）。`COULD NOT VERIFY` 下的一切禁止写入。FACTS 没有的事实，用定性语言绕开，不写数字，不凭记忆补。**BIBLE 的规格里引用的事实只是「去哪里找」的指针：BIBLE 与 FACTS 不一致时，以 FACTS 为准**（研究员纠正了很多我写在 BIBLE 里的条号、年份、措辞、归属）。FACTS 对某条写了「更正」「不要写」「只写…」的，必须照办。

课号 → FACTS 文件：00–03 `FACTS_foundations.md` · 04–06 `FACTS_private_law.md` · 07–08 `FACTS_criminal.md` · 09–10 `FACTS_procedure_evidence.md` · 11–13 `FACTS_reasoning_litigation.md` · 14–16 `FACTS_corp_ip_privacy.md` · 17–20 `FACTS_state_intl_finale.md`。

## 2. 写作要求（摘要，细则见 BIBLE）

- 中文，`lang="zh-CN"`，第二人称，短句，白话；术语第一次出现给中文名＋英文（如「善意取得（bona fide purchase）」）；先给具体案例再抽象。**不要用 他/她/他们/她们**（verify 会报错，「其他」「他人」除外），用名字、「当事人」「原告」「被告」「法官」「作者」或改写。不要 LaTeX；公式用 Unicode＋`<sub>/<sup>`，放在 `<span class="math">` 或 `<p class="ascii">` 里。
- 结构严格按 BIBLE §3 骨架：topnav → kicker → h1 → subtitle → `.chain` → 出处小注 → 本课路线 → 5–8 个编号小节（其中一个是「X、动手：{widget 名}」，前有引入段、后有「你会看到」段）→ **模型的边界（callout warn）** → 回到主线 → 常见误解（4–6 条，每条「误解：… <em>（澄清：…）</em>」）→ 一句话带走 → 下一步 → footer.lesson-nav → `<script>` → `<!-- reviewed:v1 -->`。
- **每课一个「反直觉」**（BIBLE §0.11 有计划好的那一条）：早早用一句话说出，让 widget 复现，在「你会看到」里确认。
- 线性推导：每一节必须被上一节逼出来；开头回答进入 baton，结尾抛出退出 baton。
- **法律内容的纪律**（这是这门课与别的课不同的地方）：
  - **每一句关于「法律规定」的话都标明法域，法条标明版本**：「中国《民法典》（2021-01-01 施行）第 311 条」「德国《民法典》第 892 条」「英国 Hadley v Baxendale（1854）」。绝不写光秃秃的「法律规定……」。条号以 FACTS 为准（中国法条文很多取自 Wikisource 转录，FACTS 会标注）。
  - **三个传统并列**（中国法 / 英美普通法 / 欧陆大陆法）：用 `.trade-table` 对照时，只填 FACTS 里有的格子，宁可留空也不凭记忆补。不排名，不说哪套更先进，不评价任何国家的政治制度。
  - **实然 vs 应然**分开说；有争议的实证结论两边都摆；**不碰**死刑存废、堕胎、枪支、政治案件、具体在办案件的是非。
  - **不是法律意见**：在「模型的边界」里自然地带一句「这门课讲法律的逻辑，不是法律意见；具体案件请找执业律师」。
  - 案名用 `<em>…</em>`（如 <em>Carlill v Carbolic Smoke Ball</em>）；引文只用 FACTS 已核的短句（≤15 个词），其余转述；不要整段摘抄条文，条文要点用你自己的话写，必要时摘一小句。
- 数字纪律：正文里的事实数字写明法域/来源与年份；不同来源别拼成一条序列；区分「模型输出（示意）」与「真实统计」，二者不要并排当成同一种数据。
- **跨系列引用只用 BIBLE §7 里的精确标题，且每一次引用都要带完整前缀**：`<a href="../../politics/lessons/03_social_contract.html">《政治的逻辑》第 03 课《社会契约与国家：暴力的垄断》</a>`。（verify 会把没有系列名前缀的「第 NN 课《…》」当作本系列内引用，并报 xref 错。）本系列内引用写 `第 NN 课《h1》` 或 `第 NN 课`（NN 是文件号 00–20）。别重讲姊妹课已经讲透的内容（BIBLE §6）。
- 体量 22–45 KB。每个 `<div class="callout…">` 以 `</div>` 收尾，绝不用 `</p>`。

## 3. Widget（本课最重要的部分）

- 严格按 BIBLE §4 与你那一课 §5 的 Widget 规格：一个 `.widget`、一个 `<canvas id="wNN-canvas" class="dist-canvas">`、3–5 个 KPI、所有 id 带 `wNN-` 前缀、vanilla JS IIFE、`var`、不用 Math.random / Date（需要伪随机就用 LCG）、DPR 自适应、<560px 时竖排布局、颜色按 BIBLE §4 的法律配色。**必须真的在计算**，不能只是动画。每个控件都要对画面/KPI 有可见作用；提供 2–4 个预设按钮（点击后高亮当前预设，手动拖滑块后取消高亮）。
- **先在 node 里用 `tools/law_qa/proto/wNN.js` 原型验证模型，并自己重新推导规格里的公式。规格里已经有一部分数值检验过（见 BIBLE §5 的「已核」字样，以及 `tools/law_qa/proto/spec_check*.js`），但模型必须是对的，而不是照字面。如果你改了规格的模型，在最终回复里说明改了什么、为什么。**
- 画布里的文字**不要旋转**（layout 探针不识别旋转，会误报越界）：纵轴标签请横排放在图的左上角。所有文字落在画布内（320 px 宽时也是）。
- 用 `tools/cooking_qa/kpi.js` 检查 KPI 文字永不出现 NaN/undefined/Infinity，且与正文引用的 widget 数字一致（正文里写到的每个 widget 数字，都要用 kpi.js 在对应预设下读出来对照）；用 `tools/cooking_qa/layout.js FILE 320 …` 和 `… 700 …` 检查画布不越界（每个按钮/预设状态后都要查）。示例：
  `node tools/cooking_qa/kpi.js all_lessons/law/lessons/NN_slug.html click:wNN-p0 click:wNN-p1 set:wNN-x=30`

## 4. 自检（交付前必须全部通过）

```
node tools/law_qa/verify.js all_lessons/law/lessons/NN_slug.html     # 必须只剩「dangling href index.html」这一类预期错误
```
（"dangling href index.html" 与 "planned but not written yet" 的提示属正常：总览页和其他课还没写。**除此之外必须 0 个 error。**）额外自查：`<p>/<strong>/<em>/<div>` 标签配平；没有游离的 `</p>`；常见误解 4–6 条；恰好 1 个 `.widget`、1 个 `<canvas>`；有 `callout warn` 的「模型的边界」和 `callout source-note` 的「出处小注」；正文每个事实（数字、年份、案名、条号、研究）都能在 FACTS 里指到出处，且强度不超过「建议教学措辞」；widget 引用的数字就是 widget 实际算出来的数；每一句「法律规定」都有法域标签；没有 他/她/他们。

## 5. 最终回复（一小段）

文件路径与大小；verify 结果；你对规格里的模型/公式做了哪些修改及原因；用到了哪些 FACTS 条目（节号即可）；有哪些你不放心、希望审稿人重点核对的地方（尤其是法条号、案例细节、`[~]` 条目的措辞强度）。
