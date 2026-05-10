# DeepWiki Repo Explainer

A Firefox extension that explains the architecture of any public GitHub
repository as a DeepWiki-style page, with an auto-generated infographic
summary.

## Install

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json` from this folder.

## Use

1. Navigate to any `https://github.com/<owner>/<repo>` page.
2. Click the toolbar icon.
3. Press **Analyze repository**.

The popup shows a progress log while the extension reads the repo's wiki,
then renders the explainer with an infographic at the top.

## Files

- `manifest.json` — extension manifest (MV3)
- `background.js` — analysis engine
- `popup.html` / `popup.css` / `popup.js` — popup UI
- `markdown.js` — markdown renderer
- `options.html` / `options.css` / `options.js` — settings page
- `icon-48.svg` / `icon-128.svg` — toolbar icons
