---
name: styles (folder)
description: Design system CSS — custom property tokens and global resets
type: folder
layer: infra
tags: [folder, styles, css, tokens, dark-mode]
---

# `src/styles/`

Two CSS files that define the entire visual language of the app.

**Used by:** [[frontend/src/main]] (both are imported here)

## Files

### `tokens.css`
CSS custom properties (`--` variables) for the full design system. Defines:
- `--ink`, `--paper`, `--paper-2`, `--rule` — base text and background colours
- `--accent`, `--accent-2`, `--accent-3`, `--accent-4` — accent palette (highlighter yellow, coral, lime, blueprint)
- `--font-mono`, `--font-hand` — typefaces
- `--sp-*` spacing scale, `--fs-*` font sizes, `--r-*` border radii, `--bw-*` border widths

Dark mode is activated by `[data-theme="dark"]` on `document.documentElement`, set by [[frontend/src/hooks/useTheme]]. Overrides the same tokens inside that selector.

### `globals.css`
Box-sizing reset, body base styles, scrollbar customisation.
