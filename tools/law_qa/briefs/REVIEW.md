# REVIEW.md — 给《法律的逻辑》每一位审稿 agent 的统一指令

你的任务：**审并直接修改**分给你的几节课（文件在 `all_lessons/law/lessons/`），把事实、中立性、推导、widget 数字这几件事审到可以发布。没有适用的 Skill——忽略任何 skill system-reminder；你的第一个动作必须是 Read。**不要启动子 agent，自己做完。**只允许修改分给你的那几个课文件（以及你自己的临时脚本，放在 `tools/law_qa/proto/review_<你的名字>_*.js`）；不要改 BIBLE、FACTS、lessons.json、verify.js、style.css、别人的课、任何 index。

所有路径相对仓库根 `/Users/jacob/Desktop/Interview/jiahuanglin.github.io`。

## 1. 必读
1. `tools/law_qa/briefs/BIBLE.md`（§0 红线、§1 引擎、§3 骨架、§4 widget 规范、§6 去重、§7 姊妹课标题必读；§5 只读你那几课与它们的邻居）。
2. 分给你的每一课对应的 FACTS 文件（`tools/law_qa/facts/`；课号 → 文件：00–03 foundations · 04–06 private_law · 07–08 criminal · 09–10 procedure_evidence · 11–13 reasoning_litigation · 14–16 corp_ip_privacy · 17–20 state_intl_finale）。**FACTS 是唯一允许的事实来源**；FACTS 写了「更正」「不要写」「只写…」的，课文必须照办；`COULD NOT VERIFY` 下的一切禁止出现在课文里。
3. 你要审的课文，**逐字读完**。样板课 `00_orientation.html`、`10_proof_standards.html` 可作文风参照。

## 2. 审什么（按严重程度）

**A. 事实（最重要）。**把课文里每一个事实性陈述——数字、年份、日期、人名、案名、法院、条文号及其要点、法律版本、研究的结论、引文——逐条在 FACTS 里找出处：
- 找不到出处 → 删掉，或改成不含该事实的定性说法（不要凭记忆补、也不要去网上查）；
- 出处是 `[~]` 却写得比「建议教学措辞」更肯定 → 降级措辞；
- 出处写了「更正」而课文用了被更正的说法 → 改正；
- 条号与版本：中国法条必须与 FACTS 里的版本一致（《民法典》2021-01-01 施行；《刑事诉讼法》2018 年修正版；《公司法》2023 修订版；《立法法》2023 年版…）；
- 引文 ≤15 个词，且是 FACTS 里已核的措辞；
- 不同来源的数字没有被拼成一条序列；没有把模型输出写成真实统计，也没有把真实统计和模型数字并排当成同一种数据。

**B. 法域标签与中立。**每一句「法律规定……」是否标明法域（和法条版本）？三个传统（中国 / 英美普通法 / 欧陆大陆法）是否并列、不排名？有没有评价任何国家政治制度的话？有没有碰死刑存废、堕胎、枪支、政治案件、具体在办案件？有争议的实证问题是否两边证据都摆了？有没有「法律意见」口吻（该怎么做）？

**C. 推导与反直觉。**这一课是否真的由 `lessons.json` 里的进入 baton 逼出来（subtitle、`.chain`、第一节）？每一节是否被上一节逼出来？有没有偷换概念、因果倒置、以偏概全？BIBLE §0.11 里为这一课计划的「反直觉」是否被早早说出、被 widget 复现、被「你会看到」确认？结尾是否抛出退出 baton，「下一步」是否以退出 baton 原文开头？

**D. Widget。**打开课文的 `<script>`：模型是不是真的在计算、公式是否正确（自己在 node 里重新推导一遍关键公式，必要时写 `tools/law_qa/proto/review_<名字>_NN.js`）？正文里引用的每一个 widget 数字，用 `node tools/cooking_qa/kpi.js FILE click:… set:…` 在对应预设下读出来对照，不一致就改正文（或改代码，二者择一，保持模型对）。每个控件是否对画面/KPI 有可见作用？预设按钮是否合理？`node tools/cooking_qa/layout.js FILE 320 …` 与 `… 700 …` 在每个预设状态下 out-of-bounds=0？KPI 永不出现 NaN/undefined/Infinity？

**E. 语言与结构。**不要 他/她/他们（「其他」「他人」除外）；没有 LaTeX；术语第一次出现有中文名＋英文；`<p>/<strong>/<em>/<div>` 标签配平；每个 `<div class="callout…">` 以 `</div>` 收尾；常见误解 4–6 条；恰好 1 个 `.widget`、1 个 `<canvas>`；有 `callout warn` 的「模型的边界」（并带一句「这门课讲法律的逻辑，不是法律意见；具体案件请找执业律师」的意思）与 `callout source-note` 的「出处小注」；跨系列引用都带完整系列名前缀、标题与 BIBLE §7 一字不差；正文不重讲姊妹课已讲透的内容（BIBLE §6）。

**F. 其他。**有没有明显的重复啰嗦、过长的段落、生硬的翻译腔、读不懂的句子？在不动事实的前提下直接改顺。

## 3. 怎么改

- **直接改文件**（用 Edit，小步改）。不要整篇重写；不要改 `.chain` 与「下一步」里的 baton 原文（那是 lessons.json 逐字的）。
- 每改完一课，跑 `node tools/law_qa/verify.js all_lessons/law/lessons/NN_slug.html`：除「dangling href index.html」外必须 0 个 error。
- 改完一课，在文件末尾的 `<!-- reviewed:v1 -->` 后面另起一行加 `<!-- reviewed:v2 -->`。
- 不确定的事实不要猜——删掉或降级。宁可少写一个事实，也不要多写一个未核的事实。

## 4. 最终回复（一段，要具体）

每一课一行：已改了什么（删了哪些未核事实、降级了哪些措辞、修了哪些数字/代码、改了哪些中立问题）；还有什么你无法解决、需要主编人工判断的（例如 FACTS 里没有、但课文结构上需要的事实）；verify 结果。最后列出全部修改过的文件。
