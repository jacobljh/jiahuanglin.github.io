#!/usr/bin/env python3
"""One-off hygiene on the LIVE old series all_lessons/psychology/lessons: fix stale lesson-number cross-references
left over from an older (shorter) numbering. Exact-string replacements; each must match exactly once or the script aborts
before writing anything. Run: python3 tools/psy_qa/fix_old_refs.py [--dry]"""
import sys, pathlib
D = pathlib.Path(__file__).resolve().parents[2] / 'all_lessons' / 'psychology' / 'lessons'
R = [
 ('01_psychology_as_science.html', '这一点 10 课会让你大吃一惊', '这一点第 12 课会让你大吃一惊'),
 ('06_thinking_biases.html', '把 02、03、04 连起来看，你会撞见同一句话的第三次出现', '把 03、05、06 连起来看，你会撞见同一句话的第三次出现'),
 ('07_learning.html', '<strong>知觉（02 课）</strong>', '<strong>知觉（03 课）</strong>'),
 ('07_learning.html', '回扣引擎：原来 02 的知觉，', '回扣引擎：原来 03 的知觉，'),
 ('11_personality.html', '但请回想第 05、06 课：这台机器的本职', '但请回想第 07 课：这台机器的本职'),
 ('12_self.html', '感知是建构（02）、记忆是重构（03）、判断走捷径（04）、情绪是解释（07）', '感知是建构（03）、记忆是重构（05）、判断走捷径（06）、情绪是解释（09）'),
 ('12_self.html', '这正是治疗（13）要训练的本事', '这正是治疗（15）要训练的本事'),
 ('13_social.html', '回忆第 00、02 课：知觉', '回忆第 00、03 课：知觉'),
 ('15_therapy.html', '前面 12 课讲的「正常」运转', '前面各课讲的「正常」运转'),
 ('15_therapy.html', '整门课讲了 12 课「现实是大脑建构的够用模型」', '整门课讲了十几课「现实是大脑建构的够用模型」'),
 ('16_looking_back.html', '建构能被重写（13 课）', '建构能被重写（第 15 课）'),
 ('16_looking_back.html', '真正的痛苦（12 课的障碍）', '真正的痛苦（第 14 课的障碍）'),
 ('16_looking_back.html', '00 埋下（大脑在猜）、05 讲透（猜错才更新）、又在 02 知觉、07 情绪、12 障碍里回来', '00 埋下（大脑在猜）、07 讲透（猜错才更新）、又在 03 知觉、09 情绪、14 障碍里回来'),
 ('16_looking_back.html', '00 立、在 03 记忆只存要点、04 偏误是省力捷径里兑现', '00 立、在 05 记忆只存要点、06 偏误是省力捷径里兑现'),
]
texts = {}
for f, old, new in R:
    t = texts.setdefault(f, (D / f).read_text(encoding='utf8'))
    n = t.count(old)
    if n != 1:
        sys.exit(f'ABORT {f}: {old!r} matched {n} times (want 1)')
    texts[f] = t.replace(old, new)
if '--dry' in sys.argv:
    print('dry run OK:', len(R), 'replacements in', len(texts), 'files'); sys.exit()
for f, t in texts.items():
    (D / f).write_text(t, encoding='utf8')
print('applied', len(R), 'replacements in', len(texts), 'files')
