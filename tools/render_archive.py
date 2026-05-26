#!/usr/bin/env python3
"""One-shot static renderer for the writing archive.

Reads the Jekyll posts in ``_posts/`` and emits self-contained static HTML
into ``archive/`` — one page per post plus an index grouped by year. This is
*not* part of any deploy; it is run by hand when the archive content changes:

    python3 tools/render_archive.py

The live site is plain static HTML (no Jekyll), so the generated output is
committed directly.
"""
from __future__ import annotations

import html
import re
from datetime import datetime
from pathlib import Path

import markdown
import yaml

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "_posts"
OUT_DIR = ROOT / "archive"

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

MD_EXTENSIONS = ["fenced_code", "codehilite", "tables", "toc", "attr_list", "sane_lists", "nl2br"]
MD_CONFIG = {"codehilite": {"guess_lang": False, "noclasses": True, "pygments_style": "friendly"}}


def parse_post(path: Path):
    raw = path.read_text(encoding="utf-8")
    m = FM_RE.match(raw)
    if not m:
        return None
    front = yaml.safe_load(m.group(1)) or {}
    body = raw[m.end():]
    date = front.get("date")
    if isinstance(date, datetime):
        dt = date
    else:
        # filename prefix YYYY-MM-DD
        dt = datetime.strptime(path.stem[:10], "%Y-%m-%d")
    cats = front.get("categories") or []
    if isinstance(cats, str):
        cats = [cats]
    tags = front.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    return {
        "title": front.get("title", path.stem),
        "dt": dt,
        "categories": cats,
        "tags": tags,
        "body_md": body,
        "slug": path.stem,
    }


def page(title: str, body: str, *, css_prefix: str = "../") -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<link rel="stylesheet" href="{css_prefix}assets/site.css">
</head>
<body>
<header class="topbar"><div class="wrap-wide topbar-inner">
  <a class="brand" href="/">Jiahuang (Jacob) Lin</a>
  <nav>
    <a href="/all_lessons/">ML Lessons</a>
    <a href="/archive/">Writing</a>
  </nav>
</div></header>
{body}
<footer class="site-footer"><div class="wrap">© Jiahuang (Jacob) Lin</div></footer>
</body>
</html>
"""


def render_post(post) -> str:
    md = markdown.Markdown(extensions=MD_EXTENSIONS, extension_configs=MD_CONFIG)
    body_html = md.convert(post["body_md"])
    meta_bits = post["dt"].strftime("%B %-d, %Y")
    if post["categories"]:
        meta_bits += " · " + " / ".join(html.escape(c) for c in post["categories"])
    tags_html = "".join(f'<span class="tag">{html.escape(t)}</span>' for t in post["tags"])
    inner = f"""<main class="wrap article">
  <a class="backlink" href="/archive/">← All writing</a>
  <h1 class="post-title">{html.escape(post['title'])}</h1>
  <div class="post-meta">{meta_bits}</div>
  <div>{tags_html}</div>
  <article class="article-body">
{body_html}
  </article>
</main>"""
    return page(post["title"], inner, css_prefix="../")


def render_index(posts) -> str:
    by_year: dict[int, list] = {}
    for p in posts:
        by_year.setdefault(p["dt"].year, []).append(p)
    sections = []
    for year in sorted(by_year, reverse=True):
        items = sorted(by_year[year], key=lambda p: p["dt"], reverse=True)
        lis = []
        for p in items:
            cat = " / ".join(p["categories"]) if p["categories"] else ""
            lis.append(
                f'    <li>'
                f'<span class="date">{p["dt"].strftime("%b %-d")}</span>'
                f'<a class="ptitle" href="/archive/{p["slug"]}.html">{html.escape(p["title"])}</a>'
                f'<span class="cat">{html.escape(cat)}</span>'
                f'</li>'
            )
        sections.append(
            f'  <h2 class="year-head">{year}</h2>\n  <ul class="post-list">\n'
            + "\n".join(lis)
            + "\n  </ul>"
        )
    inner = f"""<main class="wrap article">
  <h1 class="post-title">Writing</h1>
  <div class="post-meta">An archive of {len(posts)} older posts — algorithms, systems, and engineering notes (2021–2023). Kept for posterity.</div>
{''.join(sections)}
</main>"""
    return page("Writing — Jacob Lin", inner, css_prefix="../")


def main():
    posts = [p for p in (parse_post(f) for f in sorted(POSTS_DIR.glob("*.md"))) if p]
    OUT_DIR.mkdir(exist_ok=True)
    for p in posts:
        (OUT_DIR / f"{p['slug']}.html").write_text(render_post(p), encoding="utf-8")
    (OUT_DIR / "index.html").write_text(render_index(posts), encoding="utf-8")
    print(f"Rendered {len(posts)} posts + index into {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
