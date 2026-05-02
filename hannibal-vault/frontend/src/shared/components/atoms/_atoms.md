---
name: atoms (folder)
description: Primitive UI building blocks — stateless or minimal state, no data fetching
type: folder
layer: ui
tags: [folder, atoms, components]
---

# `src/shared/components/atoms/`

The smallest reusable UI units. Atoms are mostly stateless; a few (ThemeToggle) accept controlled props. None fetch data.

**Used by:** molecules and organisms throughout the app.

## Components

| Component | What it does |
|---|---|
| `Avatar` | Small circular avatar for `"user"` (person icon) or `"ai"` (robot icon) roles |
| `Badge` | Pill-shaped label with optional pulsing live dot (e.g. `"Hands-on coding · System design"`) |
| `BrandMark` | Square logo mark — renders `"H"` or custom `letters` in the brand font |
| `Button` | Multi-variant button/link (`primary`, `ghost`, `navCta`, `submit`). Renders `<a>` if `href` prop is present, else `<button>`. Supports left/right icon slot. |
| `Checkbox` | Styled checkbox with label |
| `Chip` | Rounded pill with a custom accent colour — used in `CourseMarquee` |
| `Input` | Raw styled text input with an optional `promptMark` prefix (e.g. `$`) |
| `LiveDot` | Pulsing green status dot (CSS animation) |
| `PaperBg` | Full-page parchment-textured background layer (pseudo-element grid + texture) |
| `StickyNote` | Slightly rotated sticky-note card for decorative callouts |
| `Tag` | Small monospace label tag (e.g. `"ttl=30s"`) |
| `ThemeToggle` | Sun/moon toggle button — calls `onToggle` prop, controlled via `theme` prop |
| `TypingIndicator` | Animated three-dot typing indicator shown in chat while AI responds |
| `PortDot` | Hoverable connection port dot on a canvas node — appears on parent hover via `[data-port-dot]` selector. Exports `PortPosition = "l"\|"r"\|"t"\|"b"`. See [[frontend/src/shared/components/atoms/PortDot]] |

### Key connections

- `Button` used by [[frontend/src/shared/components/organisms/Navbar]], [[frontend/src/shared/components/organisms/LoginForm]], [[frontend/src/pages/Home/HeroLeft]]
- `PaperBg` used by [[frontend/src/pages/Home/Home]], [[frontend/src/pages/Login/Login]], [[frontend/src/pages/Storyboard/Storyboard]]
- `ThemeToggle` used by [[frontend/src/shared/components/organisms/Navbar]], [[frontend/src/pages/Login/Login]]
- `Avatar` + `TypingIndicator` used by [[frontend/src/shared/components/molecules/ChatMessage]]
- `Chip` used by [[frontend/src/shared/components/organisms/CourseMarquee]]
- `Badge` used by [[frontend/src/pages/Login/Login]], [[frontend/src/pages/Home/HeroLeft]]
- `StickyNote` used by [[frontend/src/pages/Login/Login]], [[frontend/src/pages/Home/HeroLeft]]
- `Input` used by [[frontend/src/shared/components/molecules/InputField]], [[frontend/src/shared/components/molecules/PasswordField]]
- `PortDot` used by [[frontend/src/shared/components/molecules/BoardNode]], [[frontend/src/shared/components/molecules/ServiceBlock]]
