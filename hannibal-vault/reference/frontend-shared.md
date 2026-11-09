# Frontend Shared

Everything under `frontend/src/shared/` plus `hooks/`, `context/`, `styles/`. These are the building blocks the feature pages compose. Each entry is one-line role + props shape.

## App entry

| File | Lines | Role |
|---|---|---|
| `frontend/src/main.tsx` | 1-13 | React 18 root mount. Imports `tokens.css`, globals, CopilotKit styles, then renders `<App />` inside `<StrictMode>`. |
| `frontend/src/App.tsx` | 1-80 | Router + providers. `BrowserRouter > AuthProvider > FeatureFlagProvider > CopilotKit`. Public route: `/login`. Protected (via `ProtectedRoute` 21-26): `/home`, `/courses`, `/courses/:courseId`, `/storyboard`, `/design-board`. Default redirect → `/home`. Mounts `<CopilotPopup label="Hannibal AI" />`. |

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

Other hooks: `useFeatureFlag(key)` (see [feature-flags](../features/feature-flags.md)) and `useCopilotNav()` (see [copilotkit-agent](../features/copilotkit-agent.md)).

## Edge geometry

Edge anchoring lives next to its consumers:

| File | Role |
|---|---|
| `shared/components/organisms/CourseBoard/canvasUtils.ts` | `getAnchor(canvas, nodeId, modId, port)`, `buildEdgePaths(...)` — SVG edge paths for the course design tab. |
| `shared/components/organisms/DesignCanvas/useEdgePaths.ts` | Edge paths for the DesignBoard canvas. |
| `shared/components/organisms/DiagramArea/DiagramArea.tsx` | Computes its own edge paths for the Home diagram. |

## Utils — `frontend/src/shared/utils/`

| File | Role |
|---|---|
| `classNames.ts` | `classNames(...names)` joins truthy class names (`classNames(styles.a, on && styles.b)`). Use it instead of `[...].filter(Boolean).join(" ")`. |

## Types

### `frontend/src/shared/types/index.ts`

```ts
Theme = "light" | "dark"
User { id, email, provider, oauth_id }
MessageRole = "user" | "ai"
ChatSegment { type: "text"|"code"|"underline", value, annotation? }
ChatMessage { id, role, text?, segments? }
DiagramNodeData { id, label, icon?, sub?, tag?, x, y }
DiagramEdge { from, to, color?, dashArray? }
HowStep { num, title, desc, hasArrow? }
NavLink { label, href }
TrustItem { label }
TabItem<Id extends string = string> { id: Id, label }
```

### `frontend/src/pages/DesignBoard/boardTypes.ts`

Board types are page-local (`PaletteKind`, `BoardModule`, `BoardNodeData`, `EdgeEndpoint`, `BoardEdge`, `PendingEdge`, `SelectedItem`, …). `PortPosition` (`"l" | "r" | "t" | "b"`) is exported from `atoms/PortDot/PortDot.tsx` and re-exported here.

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

Compact editor atoms (dense inspector and dialog forms, first used by ArchTest):

| Component | Props (short form) |
|---|---|
| `ToolButton` | `{ children, onClick?, small?, danger?, active?, keepWidth?, disabled?, title?, aria-label?, aria-pressed? }` — compact toolbar/form button. |
| `LinkButton` | `{ children, onClick }` — inline underlined button. |
| `TextInput` / `NumberInput` / `SelectInput` / `TextArea` / `InlineCheckbox` | `FormControls/FormControls.tsx` — controlled inputs that report the value (not the event). `width` fixes a width inside a `FormRow`; `TextArea` takes `invalid`; `SelectInput` options are `string` or `[value, label]` (`SelectOption`). |
| `MethodBadge` | `{ method }` — coloured HTTP method label. |
| `HintText` / `MutedText` / `FieldCaption` / `CodeBlock` | Text styles: hint paragraph, faint inline text, uppercase field caption, scrollable `<pre>`. |
| `Callout` | `{ tone: "warning" \| "success", children }` |
| `Pill` | `{ children, emphasis? }` — bordered inline tag. |

## Molecules — `frontend/src/shared/components/molecules/`

Small composites of atoms. Still mostly presentational.

| Component | Role |
|---|---|
| `BoardChrome` | Header bar (tabs + meta label + live dot) for a canvas. |
| `BoardNode` | Draggable rectangle with 4 port dots; emits `onMove`, `onSelect`. |
| `ChatMessage` | User/AI bubble; renders `segments` with code/underline annotations. |
| `CourseCard` | Clickable card on the courses listing. Two modes: regular (cover, level, lesson count) and `genUi` placeholder. |
| `CourseModal` | Full-screen course detail; flip-animated from the clicked card's `originRect`. |
| `DiagramNode` | Draggable SVG node (icon + label + sub). Constrained to container bounds. |
| `InputField` | Labeled `Input` with optional hint link. |
| `NavBrand` | Logo + "Project Hannibal" + tagline. |
| `OAuthButton` | `{ provider: "google"|"github", onClick? }` |
| `PaletteItem` | Draggable palette tile (component/service/module). Writes kind+label to `dataTransfer`. |
| `PasswordField` | `InputField` + eye toggle to reveal/hide. |
| `ServiceBlock` | Draggable service node with embedded module rows + add-module UI. |
| `StepCard` | Numbered step (number, title, desc, optional arrow). |
| `Tabs` | Tab group; `{ tabs, activeId, onChange, variant?: "pill" \| "underline" }`, generic over the tab id. |
| `TrustPill` | Horizontal strip of `TrustItem` badges. |
| `FormField` | `{ label, children }` — captioned label wrapping one control. |
| `FormRow` / `FixedCell` | Horizontal row of controls; `FixedCell` keeps its natural width. |
| `PanelSection` | `{ title, action?, children }` — titled inspector section. |
| `Collapsible` | `{ summary, open, onToggle, children }` — controlled `<details>`. |
| `DataTable` | Compact monospace `<table>`. |
| `SearchableMultiSelect` | `{ options, selected, onToggle, singleChoice?, placeholder, aria-label }` — searchable dropdown checklist; `matchingOptions` filters. |
| `Modal` | `{ title, wide?, onClose, children }` — focused dialog; closes on Escape, Close and backdrop press. |
| `ConfirmDialog` | `{ message, confirmLabel, onConfirm, onClose }` — closes, then confirms. |
| `PopoverMenu` / `MenuHeading` / `MenuItem` | Anchored menu (`MenuAnchor { left, bottom }`) clamped to the viewport; closes on an outside pointer. |
| `Toast` | `{ message, actionLabel?, onAction?, onDismiss }` — bottom status toast with an optional action. |
| `ArchNodeLinks` | ArchTest: comma list of node links that close the modal and reveal the node (uses `useArch`). |
| `ArchStateLine` | ArchTest: one state variable row with its traced value. |

## Organisms — `frontend/src/shared/components/organisms/`

Feature-shaped. Take props, emit events; pages compose them.

| Component | Used by | Role |
|---|---|---|
| `AuthFlowDiagram` | Login | Static SVG swimlane explaining the auth flow. |
| `CanvasBoard` | Home | Chrome wrapper around any canvas body. |
| `ChatPanel` | Home | Scrollable message stream + input bar. |
| `CourseBoard` | CoursePage | Theory/design tabs, design canvas with revealed nodes and edges, hosts `TheoryPanel`. |
| `CourseMarquee` | Home | Auto-scrolling chip row of course names (duplicated for seamless loop). |
| `DesignCanvas` | DesignBoard | Free-form board: draggable nodes/edges, palette drop, port drawing. |
| `DesignInspector` | DesignBoard | Right sidebar for editing the selected node/module/edge. |
| `DesignPalette` | DesignBoard | Left sidebar of palette items + inline "add module" input. |
| `DiagramArea` | Home | SVG container drawing nodes + cubic edges via `edgePath`. |
| `HowItWorksStrip` | Home | Three-step process (select → sketch → build) using `StepCard`. |
| `LearningPath` | Courses | Vertical timeline (complete/current/upcoming) with optional sticky note overlay. |
| `LessonsPanel` | CoursePage | Left sidebar: course meta, lesson list with locks, progress bar, shake animation on locked-lesson click. |
| `LoginForm` | Login | Email/password form, signin↔signup toggle, "Continue with Google". |
| `Navbar` | All authenticated pages | Brand + nav links + theme toggle + logout. |
| `TheoryPanel` | CoursePage | Slide-in overlay rendering `LessonBlock.content` (HTML) with a "got it" action. |
| `ArchCanvas` | ArchTest | Overview/layer canvas, gestures, dock animation (see [arch-test](../features/arch-test.md)). |
| `ArchInspector` | ArchTest | Right inspector plus the service, database and app-state popups/panels (`ArchStorePanel`). |
| `ArchOverlays` | ArchTest | `ArchTraceDrawer` and `ArchModalHost` (confirm, import/export, detail views, flow table, connect picker). |
| `ArchMenu` | ArchTest | Add / Insert / File menus. |
| `ArchTopBar` | ArchTest | Title, menus, toggles, undo/redo, zoom, theme. |

The `Arch*` organisms read page state through `useArch()` (`pages/ArchTest/state/archApi.ts`) instead of props, the same way DesignBoard organisms import page-local types.

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
