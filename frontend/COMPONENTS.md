# Frontend Component Map

> Auto-documented to avoid re-exploring the codebase on every task.
> Update this file whenever components are added, removed, or renamed.

---

## Stack

- React 19 + TypeScript (strict) + Vite
- **CSS Modules** — no Tailwind. Design tokens via CSS custom properties (`--ink`, `--paper`, `--accent`, etc.)
- Path alias: `@/*` → `src/*`
- Central export: `@/shared/components` (re-exports all atoms, molecules, organisms)

---

## Design Tokens (key variables)

Defined in `src/styles/tokens.css` and `src/index.css`.

| Token | Purpose |
|---|---|
| `--paper` / `--paper-2` | Background surfaces |
| `--ink` / `--ink-soft` / `--ink-faint` | Text hierarchy |
| `--rule` / `--rule-soft` / `--grid` | Borders and grid lines |
| `--accent` | Yellow highlighter |
| `--accent-2` | Coral/orange |
| `--accent-3` | Blueprint blue |
| `--accent-4` | Lime green |
| `--shadow` / `--shadow-lg` | Box shadows |
| `--font-sans` | Inter Tight |
| `--font-mono` | JetBrains Mono |
| `--font-hand` | Caveat (handwritten) |

Dark mode: `[data-theme="dark"]` on `document.documentElement`.

---

## Shared Types (`src/shared/types/index.ts`)

```ts
Theme = "light" | "dark"
AccentPalette = "highlighter" | "coral" | "lime" | "blueprint"
MessageRole = "user" | "ai"
NavLink      = { label: string; href: string }
TrustItem    = { label: string }
TabItem      = { id: string; label: string }
ChatSegment  = { type: "text"|"code"|"underline"; value: string }
ChatMessage  = { id; role; text?; segments? }
DiagramNodeData = { id; label; icon?; sub?; tag?; x; y }
DiagramEdge     = { from; to; color? }
HowStep      = { num; title; desc; hasArrow? }
SwimLaneStep = { id; label; labelNum?; packet; packetVariant?; direction; sideLabel? }
ArrowDirection = "outgoing" | "incoming" | "none"
```

---

## Atoms (`src/shared/components/atoms/`)

| Component | File | Props summary |
|---|---|---|
| `Avatar` | `Avatar/Avatar.tsx` | Avatar display (user/AI) |
| `Badge` | `Badge/Badge.tsx` | `label`, `showDot?`, `className?` — eyebrow pill with pulsing dot |
| `BrandMark` | `BrandMark/BrandMark.tsx` | Logo square ("PH"), no props |
| `Button` | `Button/Button.tsx` | `variant: "primary"\|"ghost"\|"navCta"\|"submit"`, `href?`, `type?`, `disabled?`, `children` |
| `Checkbox` | `Checkbox/Checkbox.tsx` | `label`, `checked`, `onChange`, `name` |
| `Chip` | `Chip/Chip.tsx` | `name`, `color` |
| `Input` | `Input/Input.tsx` | `promptMark?`, `type?`, `placeholder?`, `value`, `onChange`, `required?`, `autoComplete?` |
| `LiveDot` | `LiveDot/LiveDot.tsx` | Pulsing green dot, no props |
| `PaperBg` | `PaperBg/PaperBg.tsx` | Fixed graph-paper grid bg, no props — place once per page |
| `Tag` | `Tag/Tag.tsx` | Small tag label |
| `ThemeToggle` | `ThemeToggle/ThemeToggle.tsx` | `theme: Theme`, `onToggle: () => void` |
| `TypingIndicator` | `TypingIndicator/TypingIndicator.tsx` | Animated typing dots, no props |
| `StickyNote` | `StickyNote/StickyNote.tsx` | `children`, `rotate?: number` (default 5), `className?` — absolutely positioned sticky note; parent must have `position: relative` |

---

## Molecules (`src/shared/components/molecules/`)

| Component | File | Props summary |
|---|---|---|
| `BoardChrome` | `BoardChrome/BoardChrome.tsx` | `tabs: {label, active}[]`, `metaLabel` — tab bar header for demo boards |
| `ChatMessage` | `ChatMessage/ChatMessage.tsx` | `role: MessageRole`, `text?`, `segments?` — message bubble |
| `DiagramNode` | `DiagramNode/DiagramNode.tsx` | Draggable diagram node |
| `InputField` | `InputField/InputField.tsx` | `label`, `type?`, `placeholder?`, `promptMark?`, `required?`, `value`, `onChange`, `autoComplete?` |
| `NavBrand` | `NavBrand/NavBrand.tsx` | `href?`, `name?`, `tagline?` — logo + project name link |
| `OAuthButton` | `OAuthButton/OAuthButton.tsx` | `provider: "google"\|"github"`, `onClick?` |
| `PasswordField` | `PasswordField/PasswordField.tsx` | `label`, `hintLabel?`, `hintHref?`, `required?` — password input with eye toggle |
| `StepCard` | `StepCard/StepCard.tsx` | Step/instruction card |
| `Tabs` | `Tabs/Tabs.tsx` | `tabs: TabItem[]`, `activeId: string`, `onChange: (id) => void` |
| `TrustPillStrip` | `TrustPillStrip/TrustPill.tsx` | `items: TrustItem[]` — row of trust badges |

---

## Organisms (`src/shared/components/organisms/`)

| Component | File | Props summary |
|---|---|---|
| `AuthFlowDiagram` | `AuthFlowDiagram/AuthFlowDiagram.tsx` | Static login swimlane diagram + code card, no props |
| `CanvasBoard` | `CanvasBoard/CanvasBoard.tsx` | Full diagram + chat shell container |
| `ChatPanel` | `ChatPanel/ChatPanel.tsx` | Live tutor chat stream |
| `CourseMarquee` | `CourseMarquee/CourseMarquee.tsx` | Scrolling course chip list |
| `DiagramArea` | `DiagramArea/DiagramArea.tsx` | Draggable nodes with SVG edges |
| `HowItWorksStrip` | `HowItWorksStrip/HowItWorksStrip.tsx` | Steps display section |
| `LoginForm` | `LoginForm/LoginForm.tsx` | `mode: "signin"\|"signup"`, `onSubmit: (values) => Promise<void>`, `onGoogleAuth?`, `onGitHubAuth?` — full auth card (OAuth + email/password + remember me) |
| `Navbar` | `Navbar/Navbar.tsx` | `links?`, `ctaLabel?`, `ctaHref?`, `theme`, `onThemeToggle` — **always renders a CTA button**; for pages without a CTA use NavBrand + ThemeToggle directly |

---

## Pages (`src/pages/`)

| Page | File | Notes |
|---|---|---|
| `Storyboard` | `Storyboard/Storyboard.tsx` | Component library showcase, single page |
| `Login` | `Login/Login.tsx` | Auth page — mirrors `Login.html` layout |

---

## Routing

No router installed. `App.tsx` renders a single page directly. Add React Router if multi-page navigation is needed.

---

## Common Patterns

### Theme management (per page)
```tsx
const [theme, setTheme] = useState<Theme>("light");
useEffect(() => {
  document.documentElement.setAttribute("data-theme", theme);
}, [theme]);
const handleThemeToggle = () => setTheme(p => p === "light" ? "dark" : "light");
```

### Login page nav (no CTA button)
Use `NavBrand` + `ThemeToggle` directly — `Navbar` organism always renders a CTA.

### New page checklist
1. Create `src/pages/<Name>/<Name>.tsx` + `<Name>.module.css`
2. Use `PaperBg` for background
3. Manage theme with the pattern above
4. Update `App.tsx` (or add a route) to render the page
