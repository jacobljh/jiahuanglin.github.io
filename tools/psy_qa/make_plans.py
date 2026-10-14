#!/usr/bin/env python3
"""make_plans.py — single source for lessons.json (spine) and lessons_play.json (sidecar).
Edit the data here, re-run: python3 tools/psy_qa/make_plans.py
Batons are VERBATIM text: they appear in the .chain strip and in the 下一步 callout (verify.js checks)."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))

SIBLINGS = [
    ("哲学", "philosophy/lessons"), ("人类学", "anthropology/lessons"), ("计算心智", "computational_mind/lessons"),
    ("犯罪心理学", "criminal_psychology/lessons"), ("训练的逻辑", "training/lessons"), ("政体的逻辑", "regimes/lessons"),
    ("世界的逻辑", "world_regions/lessons"), ("政治的逻辑", "politics/lessons"), ("反脆弱", "antifragile/lessons"),
    ("作曲的逻辑", "music/lessons"), ("烹饪的逻辑", "cooking/lessons"), ("从零学会做饭", "cooking_play/lessons"),
    ("饮品的逻辑", "beverages/lessons"), ("酒的逻辑", "drinks/lessons"), ("人类简史", "sapiens/lessons"),
    ("人类与文明简史", "history/lessons"), ("世界文明史", "world_history/lessons"), ("地理的逻辑", "geography/lessons"),
    ("能源的逻辑", "energy/lessons"), ("刘仲敬思想的逻辑", "liu_zhongjing/lessons"), ("侦查与反侦察", "reconnaissance/lessons"),
    ("市场的逻辑", "markets/lessons"), ("估值的逻辑", "valuation/lessons"), ("投资的逻辑", "investing/lessons"),
    ("交易的手艺", "trader/lessons"), ("数学的逻辑", "math/lessons"), ("物质为什么会变", "chemistry/lessons"),
]

# ───────────────────────────── spine: 心理学 (28 lessons) ─────────────────────────────
PARTS = [
    ("第一部分 · 方法：怎样研究一台看不见的机器", 0, 2),
    ("第二部分 · 输入与判断：世界是被猜出来的", 3, 8),
    ("第三部分 · 价值与学习：凭什么打分，怎么更新", 9, 16),
    ("第四部分 · 他人：别的脑袋是一个大变量", 17, 22),
    ("第五部分 · 自己与差异：同一台机器，不同的人", 23, 24),
    ("第六部分 · 失灵、修复与收官", 25, 27),
]
L = [  # (slug, h1)
    ("00_orientation", "导览：你体验到的世界，是大脑的一次猜测"),
    ("01_psychology_as_science", "心理学如何成为科学：从内省到行为，再到看不见的心智"),
    ("02_evidence", "证据怎么称重：运气、挑选与重复"),
    ("03_perception", "感觉与知觉：大脑如何「造」出一个世界"),
    ("04_attention", "注意与意识：你只看见你注意的"),
    ("05_memory", "记忆：不是录像，是每次重新建构的故事"),
    ("06_thinking_biases", "思维与判断：捷径是缺陷，还是算力有限下的最优解"),
    ("07_regression_to_mean", "回归均值：极端之后的「变好」，不一定是你做了什么"),
    ("08_noise", "噪声：同一位专家，换一天就换一个判断"),
    ("09_emotion", "情绪：身体的价值信号，还是大脑的解释？"),
    ("10_pain", "痛不等于伤：疼痛是大脑对危险的估计"),
    ("11_hardware", "大脑这台硬件：神经元、能量预算与可塑性"),
    ("12_learning", "学习：联结、强化，与「预测错了就更新」"),
    ("13_wanting_habits", "想要不等于喜欢：动机、习惯与成瘾"),
    ("14_self_control", "自控：做到自控的人，靠的不是硬扛"),
    ("15_experience_memory", "经历与记忆：你记得的，不是你经历的"),
    ("16_development", "发展：一台机器如何从零搭起"),
    ("17_social", "社会心理：别人如何改写你的判断"),
    ("18_seen_by_others", "别人眼里的你：聚光灯、喜欢差距与「不好意思开口」"),
    ("19_ideal_partner", "理想型：说得出的偏好，和真正被吸引的人"),
    ("20_crowds", "群体：什么时候一群人比一个人聪明，什么时候更笨"),
    ("21_language", "语言：把一个脑子里的模型，传进另一个脑子"),
    ("22_culture", "文化与样本：我们学到的「人性」，是谁的人性"),
    ("23_self", "自我：大脑编给自己的故事"),
    ("24_persons", "人格与智力：同一台机器，为什么人和人不一样"),
    ("25_disorders", "心理障碍：当推断掉进自我维持的回路"),
    ("26_therapy", "心理治疗：在安全的关系里，送去推翻旧预测的证据"),
    ("27_looking_back", "回望整条链：把这台机器用好，与活得好"),
]
B = {
    "in00": "同一张照片，有人看到蓝黑、有人看到白金；同一件往事，两个人各记得一个版本——如果连「看见」和「记得」都因人而异，我们说的「现实」到底是什么？",
    "out27": "心智是一台在有限算力下替身体下注的推断机器：它猜、它打分、它按误差更新、它借别人和语言扩容，也会掉进自己的回路——用好它，就是看清它的账本，再在你能验证的地方改它。",
    "00-01": "体验到的世界既然是一次猜测，那「我看见了」「我记得」「我就是这么想的」都不能直接当证据——要研究一台看不见、还会自欺的机器，到底该信什么、从哪里下手？",
    "01-02": "有了可测量的行为，就能做实验了；可一次实验的结果只是一次抽样——它是真规律，还是运气，还是研究者无意间挑出来的？证据到底该怎么称重？",
    "02-03": "手里有了称证据的秤，就可以开始拆这台机器了，先拆最前端：感官给的原料又少又糊，体验到的世界却又满又清晰——多出来的那一部分从哪里来？",
    "03-04": "知觉靠先验把稀薄的信号补成整个世界；可每秒涌进来的信号远多于大脑处理得了的量——它必须挑着「看」，被丢掉的那部分去了哪里？",
    "04-05": "注意只放行一小部分，放行的东西还得留下来才有用；可留下来的并不是录像——记忆是怎么存的，又为什么每次取出来都会被改写？",
    "05-06": "知觉在补全、注意在筛选、记忆在重建，处处都在拿旧经验换省力；判断和决定也是这样——这些「捷径」到底是缺陷，还是在算力有限时的最优解？",
    "06-07": "捷径在算力有限时可以「够用」；可有一类错误并不出在捷径上，而出在「运气」上：任何一次测量都混着运气，极端的结果下一次会自己往回走，而大脑偏偏会为这种回走编出一个因果故事。这个故事什么时候是错觉？",
    "07-08": "回归均值说的是：只要结果里混着运气，极端值就会往回走。那专业判断里混着多少运气？同一位专家，隔几天、换个次序再判一次同样的案例，会不会判得不一样——如果会，这种「噪声」有多大，又怎样压下去？",
    "08-09": "「够用」「更好」总得有个打分的标准——算力有限的机器，是按什么给自己的猜测打分的？答案在身体里：要活下去，要趋利避害，而情绪就是这套价值信号。",
    "09-10": "如果情绪是身体价值信号的读数，那最像「直接读数」的一路就是疼痛：哪里坏了哪里痛，痛多少就是伤多少。可事实真是这样吗——痛的程度，和身体真实受损的程度，到底是什么关系？",
    "10-11": "价值信号要真的改变行为，就得有物理实现：一团耗能有限的肉，靠什么把「这个值得」「那个不对」传遍全身，又写进连接里？",
    "11-12": "硬件会随经验改写连接，可改哪里、改多少？最省的办法是只在「预测错了」的时候改——把价值信号变成学习信号。",
    "12-13": "按预测误差学习的系统会把「被预测到的奖赏」抓得越来越牢；可当学习信号和我们真正喜欢、真正想要的东西脱了钩，会出什么事——习惯、渴求，乃至成瘾？",
    "13-14": "「想要」可以脱离「喜欢」，习惯可以脱离目标；既然驱动力常常不听使唤，对付它的那套机制——自控——是怎么工作的？是一块能练的「意志肌肉」，还是别的什么？",
    "14-15": "自控说到底，是为了将来的好处放弃眼前的诱惑；可「将来的好处」是按什么估出来的——按当时实际的体验，还是按事后留在记忆里的那个印象？经历的和记住的，到底是不是一回事？",
    "15-16": "这套学习系统不是出厂就调好的：基因起个头，经验把它长成，有些窗口一过就很难补——一台这样的机器，是怎么从零搭起来的？",
    "16-17": "孩子搭自己的模型，原料主要来自别人；别人既是重要的信息来源，也是重要的变量——当身边有一群同样会猜、会骗、会模仿的机器，个体的判断会被怎样改写？",
    "17-18": "别人如何改写你的判断，上一课讲了；可反过来，你对「别人怎么看你」「别人对你是什么感觉」的判断，又有多准？",
    "18-19": "你对别人眼里的自己，猜得系统性地偏；那你对「自己想要什么样的人」的自我报告呢——事先说得出的理想型，和真正见面之后被谁吸引，是不是一回事？",
    "19-20": "单个人的判断有偏、有噪声，连自己的偏好都说不准；把许多人的判断放在一起，是会互相抵消错误，还是互相放大错误？一群人在什么条件下比一个人聪明，在什么条件下反而更笨？",
    "20-21": "群体要协调，就得把一个脑子里的模型送进另一个脑子，这需要一套共享的编码；人类找到的办法是语言——它是怎么在孩子身上长出来的，又怎样反过来塑造思维？",
    "21-22": "语言和习俗不是基因直接给的，每个群体都长出了自己的版本——所谓「人性」，哪些是普遍的，哪些只是特定文化里长出来的？更要紧的是：这门课引用的实验，大多来自哪里的人？",
    "22-23": "在由他人、语言和文化构成的环境里，这台机器还得给自己建一个模型：「我」是什么？我们对自己的解释，有多少来自真正的观察，有多少是事后编的故事？",
    "23-24": "同样的机器装进不同的人身上，输出为什么不一样？有什么是真正稳定的——人格与智力，哪些是稳的，多少来自基因，多少只是我们的误读？",
    "24-25": "个体差异有一个正常的范围；当预测系统掉进一个自我维持的闭环——错的预测不断被自己造出来的证据证实——就越出了这个范围。心理障碍到底是什么？",
    "25-26": "如果障碍是靠回避与误读维持的闭环，那修复它靠的就不是讲道理，而是在安全的条件下送去一条足以推翻旧预测的新证据——这是怎么做到的，证据有多强？",
    "26-27": "机器的零件、出错的方式和修复的办法都看过了，回到最初的问题：把这台机器用好，到底是什么意思？「活得好」有多少证据可说？",
}

# ───────────────────────────── sidecar: 从零学会用脑 (8 lessons) ─────────────────────────────
PPARTS = [
    ("第一部分 · 立起方法：一次只改一件事", 0, 0),
    ("第二部分 · 记住与判断", 1, 3),
    ("第三部分 · 身体与驱动", 4, 7),
]
PL = [
    ("00_orientation", "导览：把自己当成一个实验对象"),
    ("01_retrieval_spacing", "记住：检索与间隔"),
    ("02_calibration", "校准：知道自己知道什么"),
    ("03_decision_hygiene", "决策卫生：外部视角、事前验尸与清单"),
    ("04_sleep", "睡眠：你身体里的两个计时器"),
    ("05_habits", "习惯：环境、触发与摩擦"),
    ("06_motivation_design", "动机设计：奖励用对了才有用"),
    ("07_emotion_regulation", "情绪调节：先选对策略，再谈心态"),
]
PB = {
    "in00": "读完《心理学》，你知道了这台机器的零件和它的出错方式——可知道和用得上之间，隔着一道沟：哪些办法真的有效，又怎么知道它对你有效？",
    "00-01": "有了「一次只改一件事、用数据看效果」的方法，该先改哪一件？多数人最想改的，是记得住——而最常见的做法（重读、划线）偏偏证据最弱。",
    "01-02": "按检索与间隔练习，你能记住更多；可怎么知道自己真的记住了、真的懂了？人对自己「知道多少」的感觉，本身就需要校准。",
    "02-03": "校准好「我有多大把握」之后，把它用到真正要紧的地方：做决定。直觉什么时候可以信，什么时候该换成外部视角、事前验尸和清单？",
    "03-04": "记忆、判断和决策都要靠一个前提：大脑状态够好。可最先被牺牲、也最不被自己察觉的，就是睡眠——它到底是怎么运转的，怎样睡才算「够」？",
    "04-05": "睡眠是底座；底座之上，好办法只有变成不用想就做的习惯才算数——习惯是怎么形成的，又该怎样给它搭一个会自己运转的环境？",
    "05-06": "习惯靠环境搭起来，可总有些事要靠「想要」去推动——奖励、目标、夸奖用对了是助力，用错了反而会把本来的兴趣挤掉。该怎样设计？",
    "06-07": "动机设计得再好，也挡不住情绪突然来搅局；情绪上来的时候，哪些调节办法有证据，哪些只是听上去有道理？",
    "out07": "用脑不靠鸡血，靠一套能验证的小办法：检索与间隔管记忆，校准与清单管判断，睡眠托住一切，环境与奖励设计管行为，选对策略管情绪——一次改一件，用自己的数据说话。",
}

def build(series, dir_, parts, items, batons, siblings, extra=None):
    n = len(items)
    lessons = [{"n": i, "slug": s, "h1": h} for i, (s, h) in enumerate(items)]
    d = {
        "series": series, "dir": dir_,
        "parts": [{"name": p, "from": a, "to": b} for p, a, b in parts],
        "lessons": lessons, "batons": batons,
        "siblings": [{"name": a, "dir": b} for a, b in siblings],
    }
    if extra: d.update(extra)
    return d

SWAPPED = os.path.exists(os.path.join(HERE, "SWAPPED"))   # swap.py creates this marker file: psychology_new has become psychology
spine = build("心理学", "all_lessons/psychology/lessons" if SWAPPED else "all_lessons/psychology_new/lessons", PARTS, L, B,
              SIBLINGS + [("从零学会用脑", "psychology_play/lessons")],
              {"finalDir": "all_lessons/psychology/lessons", "js": "psy.js", "noBet": [27]})
play = build("从零学会用脑", "all_lessons/psychology_play/lessons", PPARTS, PL, PB,
             SIBLINGS,
             {"finalDir": "all_lessons/psychology_play/lessons", "js": "psy.js", "betPrefix": "p",
              "spineLink": ({"name": "心理学", "dir": "psychology/lessons"} if SWAPPED else {"name": "心理学", "dir": "psychology/lessons", "dirDev": "psychology_new/lessons"})})
# sanity: every baton key exists
def check(plan, key_total):
    N = len(plan["lessons"]); b = plan["batons"]
    need = ["in00", f"out{N-1:02d}"] + [f"{i:02d}-{i+1:02d}" for i in range(N-1)]
    miss = [k for k in need if k not in b]
    extra = [k for k in b if k not in need]
    assert not miss and not extra, (miss, extra)
check(spine, 28); check(play, 8)
for name, plan in (("lessons.json", spine), ("lessons_play.json", play)):
    with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2); f.write("\n")
    print("wrote", name, len(plan["lessons"]), "lessons,", len(plan["batons"]), "batons")
# pronoun check on batons
import re
for plan in (spine, play):
    for k, v in plan["batons"].items():
        if re.search(r"[他她]", re.sub(r"其他|他人|他国|利他", "", v)): print("PRONOUN in", k)
