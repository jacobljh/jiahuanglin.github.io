# jiahuanglin.xyz

Personal site for Jiahuang (Jacob) Lin, served at **https://jiahuanglin.xyz**.

It is a plain **static HTML** site — no Jekyll, no build framework. GitHub Pages
serves the files as-is (`.nojekyll`), deployed by
[`.github/workflows/pages-deploy.yml`](.github/workflows/pages-deploy.yml).

## Structure

| Path | What it is |
| --- | --- |
| `index.html` | Landing page / intro |
| `all_lessons/` | Self-contained ML-systems lesson library (`/all_lessons/`) |
| `archive/` | Rendered static copies of older blog posts (`/archive/`) |
| `assets/` | `site.css` + images (avatar, favicons, post images) |
| `_posts/` | Markdown **source** for the archive (not published) |
| `tools/render_archive.py` | One-shot renderer: `_posts/*.md` → `archive/*.html` |
| `CNAME` | Custom domain (`jiahuanglin.xyz`) |

## Editing

- **Intro:** edit `index.html`.
- **Lessons:** edit files under `all_lessons/` (already static HTML).
- **Archive:** edit the markdown in `_posts/`, then regenerate:

  ```bash
  python3 -m pip install --user markdown pyyaml pygments   # once
  python3 tools/render_archive.py
  ```

  Commit the regenerated `archive/*.html`.

Pushing to `master` deploys automatically.

> The previous Jekyll/Chirpy version of this site is preserved on the
> `blog-archive` branch.
