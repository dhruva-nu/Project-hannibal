# Frontend Shared

Everything under `frontend/src/shared/` plus `hooks/`, `context/`, `styles/`. These are the building blocks the feature pages compose. Each entry is one-line role + props shape.

## App entry

| File | Lines | Role |
|---|---|---|
| `frontend/src/main.tsx` | 1-14 | React 18 root mount. Imports `tokens.css`, globals, CopilotKit styles, then renders `<App />` inside `<StrictMode>`. |
| `frontend/src/App.tsx` | 1-56 | Router + providers. `BrowserRouter > AuthProvider > CopilotKit`. Public route: `/login`. Protected (via `ProtectedRoute` 15-20): `/home`, `/courses`, `/courses/:courseId`, `/storyboard`, `/design-board`. Default redirect → `/home`. Mounts `<CopilotPopup label="Hannibal AI" />`. |

## Context — `frontend/src/context/AuthContext.tsx`

Exports:

```ts
type User = { id, email, provider, oauth_id, role };
type AuthContextValue = {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
};
useAuth(): AuthContextValue
<AuthProvider>{children}</AuthProvider>
```

On mount, fetches `GET /api/v1/auth/me` with credentials. See [`features/auth.md`](../features/auth.md) for full behavior.

## Hooks — `frontend/src/hooks/useTheme.ts`

```ts
useTheme(): { theme: "light" | "dark"; toggleTheme: () => void }
```

Sets `document.documentElement.dataset.theme`. Component-local state — no persistence today. The dark-mode design tokens in `styles/tokens.css` are scoped under `[data-theme="dark"]`, so flipping the attribute switches the entire palette.

## Utils — `frontend/src/shared/utils/edgePath.ts` <a id="edgepath"></a>

Pure helpers for SVG edge geometry:

| Function | Signature | What it does |
|---|---|---|
| `buildCubicPath` | `(a: Point, b: Point) => string` | SVG cubic Bezier path string with 40% horizontal curvature. |
| `anchorOnRect` | `(rect: DOMRect, originX, originY, port: "l"|"r"|"t"|"b"|"c") => Point` | Maps a port label to an exact `{x, y}` on the rectangle, expressed in container-local coords. |
| `anchorOnElement` | `(container, selector, port) => Point | null` | Finds an element inside the container, computes the anchor, returns null if missing. |

Used by `DiagramArea`, `CourseBoard`, and `DesignCanvas` to draw edges that snap to port dots.

## Types

### `frontend/src/shared/types/index.ts`

```ts
Theme = "light" | "dark"
PortPosition = "l" | "r" | "t" | "b"
User { id, email, provider, oauth_id }
MessageRole = "user" | "ai"
ChatSegment { type: "text"|"code"|"underline", value, annotation? }
ChatMessage { id, role, text?, segments? }
DiagramNodeData { id, label, icon?, sub?, tag?, x, y }
DiagramEdge { from, to, color?, dashArray? }
HowStep { num, title, desc, hasArrow? }
NavLink { label, href }
TrustItem { label }
TabItem { id, label }
```

### `frontend/src/shared/types/board.ts`

```ts
PaletteKind = "component" | "service" | "module"
BoardModule { id, label }
BoardNodeData { id, type: "component"|"service", x, y, w?, label, modules? }
EdgeEndpoint { nodeId, moduleId?, port: PortPosition }
BoardEdge { id, from: EdgeEndpoint, to: EdgeEndpoint }
PendingEdge { fromNodeId, fromModuleId?, fromPort, x, y }
SelectedItem { kind: "node"|"service"|"module"|"edge", id, moduleId? }
PaletteEntry { kind, label, displayLabel? }
PlacedEdge { id, from, to }
```

### `frontend/src/shared/types/course.ts`

```ts
BuildStep = 0 | 1 | 2 | 3       // closed → reviewing → building → placed
PendingPlacement { kind: "node" | "module", id, parent? }
TestResult { name, description?, pass: boolean | null }
```

## Atoms — `frontend/src/shared/components/atoms/`

Stateless, no app logic. CSS Modules + design tokens.

| Component | Props (short form) |
|---|---|
| `Avatar` | `{ role: "user"|"ai", label? }` — colored circle for a chat role. |
| `Badge` | `{ label, showDot?, className? }` — pill with optional leading dot. |
| `BrandMark` | `{ letters? }` — 2-letter logo square. |
| `Button` | `{ variant?: "primary"|"ghost"|"navCta"|"submit", href?, type?, disabled?, onClick?, icon?, iconPosition?, className?, children, aria-label? }` — polymorphic button/link. |
| `Checkbox` | `{ label, checked?, defaultChecked?, onChange?, name? }` |
| `Chip` | `{ label, color }` — small inline pill with colored bullet. |
| `Input` | `{ id?, type?, placeholder?, value?, defaultValue?, required?, autoComplete?, promptMark?, suffix?, onChange?, onKeyDown?, onBlur?, className?, aria-label? }` |
| `LiveDot` | `{}` — pulsing "live" indicator. |
| `PaperBg` | `{}` — fixed graph-paper tiled background; used as page wrapper. |
| `PortDot` | `{ position: PortPosition, onPointerDown, onPointerUp }` — connection port on a node edge. |
| `StickyNote` | `{ children, rotate?, className? }` — rotated note with a lamp SVG (visible in dark mode only). |
| `Tag` | `{ label, className? }` — inline semantic tag. |
| `ThemeToggle` | `{ theme, onToggle }` — sun/moon icon button. |
| `TypingIndicator` | `{}` — three-dot animation. |

## Molecules — `frontend/src/shared/components/molecules/`

Small composites of atoms. Still mostly presentational.

| Component | Role |
|---|---|
| `BoardChrome` | Header bar (tabs + meta label + live dot) for a canvas. |
| `BoardNode` | Draggable rectangle with 4 port dots; emits `onMove`, `onSelect`. |
| `ChatMessage` | User/AI bubble; renders `segments` with code/underline annotations. |
| `CodeEditor` | CodeMirror 6. Languages: Python, JavaScript, Go. Props `{ value, language, onChange }`. Adds completions via the language data facet, **never** `autocompletion({ override })` (override wipes built-in keyword/snippet completions). |
| `CourseCard` | Clickable card on the courses listing. Two modes: regular (cover, level, lesson count) and `genUi` placeholder. |
| `CourseModal` | Full-screen course detail; flip-animated from the clicked card's `originRect`. |
| `DiagramNode` | Draggable SVG node (icon + label + sub). Constrained to container bounds. |
| `InputField` | Labeled `Input` with optional hint link. |
| `NavBrand` | Logo + "Project Hannibal" + tagline. |
| `OAuthButton` | `{ provider: "google"|"github", onClick? }` |
| `PaletteItem` | Draggable palette tile (component/service/module). Writes kind+label to `dataTransfer`. |
| `PasswordField` | `InputField` + eye toggle to reveal/hide. |
| `RunError` | Collapsible error badge → modal with full stderr trace. |
| `ServiceBlock` | Draggable service node with embedded module rows + add-module UI. |
| `StepCard` | Numbered step (number, title, desc, optional arrow). |
| `Tabs` | Tab group; `{ tabs, activeId, onChange }`. |
| `TrustPill` | Horizontal strip of `TrustItem` badges. |

## Organisms — `frontend/src/shared/components/organisms/`

Feature-shaped. Take props, emit events; pages compose them.

| Component | Used by | Role |
|---|---|---|
| `AuthFlowDiagram` | Login | Static SVG swimlane explaining the auth flow. |
| `BuildPanel` | CoursePage | Code editor + test results + output stream + Run/Reset/Place buttons. |
| `CanvasBoard` | CoursePage, DesignBoard | Chrome wrapper around any canvas body. |
| `ChatPanel` | CoursePage | Scrollable message stream + input bar (theory mode). |
| `CourseBoard` | CoursePage | Main interactive canvas: revealed nodes, edges, overlays, celebration on completion. |
| `CourseMarquee` | Home | Auto-scrolling chip row of course names (duplicated for seamless loop). |
| `DesignCanvas` | DesignBoard | Free-form board: draggable nodes/edges, palette drop, port drawing. |
| `DesignInspector` | DesignBoard | Right sidebar for editing the selected node/module/edge. |
| `DesignPalette` | DesignBoard | Left sidebar of palette items + inline "add module" input. |
| `DiagramArea` | Home (how-it-works) | SVG container drawing nodes + cubic edges via `edgePath`. |
| `HowItWorksStrip` | Home | Three-step process (select → sketch → build) using `StepCard`. |
| `LearningPath` | CoursePage | Vertical timeline (complete/current/upcoming) with optional sticky note overlay. |
| `LessonsPanel` | CoursePage | Left sidebar: course meta, lesson list with locks, progress bar, shake animation on locked-lesson click. |
| `LoginForm` | Login | Email/password form, signin↔signup toggle, "Continue with Google". |
| `Navbar` | All authenticated pages | Brand + nav links + theme toggle + logout. |
| `TheoryPanel` | CoursePage | Slide-in overlay rendering `LessonBlock.content` (HTML) with a "got it" action. |

## Styles — `frontend/src/styles/tokens.css`

Design tokens as CSS custom properties on `:root`, overridden under `[data-theme="dark"]`.

| Category | Examples |
|---|---|
| Colors (paper/ink) | `--paper`, `--paper-2`, `--ink`, `--ink-soft`, `--ink-faint`, `--rule`, `--grid` |
| Accent palettes | `--accent`, `--accent-2/3/4`, plus switchable pairs `--accent-{highlighter|coral|lime|blueprint}-{1,2}` |
| Shadows | `--shadow`, `--shadow-lg` |
| Typography | `--font-{sans,mono,hand}`, `--fs-{2xs..display-lg}` (fluid scales) |
| Borders | `--bw-{1..4}` widths, `--r-{2..16,full}` radii |
| Spacing | `--sp-{1..1440}` (1px scale up to a 1440px container) |
| Sticky note | `--sticky` (background) |

Dark mode flips paper↔ink and adjusts the sticky-note colour. Components import only their own `.module.css`; tokens are inherited through the cascade.

CSS Modules are used uniformly — every component has a sibling `Component.module.css`, accessed as `styles.className`.
