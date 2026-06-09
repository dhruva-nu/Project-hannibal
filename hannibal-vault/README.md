# Hannibal Vault

End-to-end documentation for **Project Hannibal** — an interactive course platform where students learn system design by building real services, running their code in a sandbox, and placing components on a live canvas.

This vault is the **primary documentation**. Source files have minimal comments by design; the answers live here.

## How to navigate

Pick the entry point that matches your question:

| Question | Open |
|---|---|
| "What does this app do? How do the pieces fit?" | [`00-architecture.md`](./00-architecture.md) |
| "What tables / collections exist? What's the schema?" | [`01-database.md`](./01-database.md) |
| "How does *feature X* work, top to bottom?" | [`features/`](./features) |
| "What does this atom / molecule / organism do?" | [`reference/frontend-shared.md`](./reference/frontend-shared.md) |
| "How does the FE talk to the BE?" | [`reference/frontend-services-api.md`](./reference/frontend-services-api.md) |
| "How is the FastAPI app wired? What middleware runs?" | [`reference/backend-infrastructure.md`](./reference/backend-infrastructure.md) |
| "What's the controller → service → repo pattern?" | [`reference/backend-layers.md`](./reference/backend-layers.md) |
| "Where does Home / Storyboard / DesignBoard fit in?" | [`reference/pages-supporting.md`](./reference/pages-supporting.md) |
| "How do I run tests / lint / migrate / build locally?" | [`reference/justfile.md`](./reference/justfile.md) |

## Vault layout

```
hannibal-vault/
├── README.md                          ← you are here
├── 00-architecture.md                 ← system overview, request flow, services
├── 01-database.md                     ← PostgreSQL + MongoDB schema
├── features/                          ← end-to-end feature docs (FE → BE → DB)
│   ├── auth.md
│   ├── courses-and-lessons.md         ← the core learning loop
│   ├── code-execution.md              ← sandboxed RCE
│   ├── copilotkit-agent.md            ← Gemini-powered chat
│   ├── tags.md
│   └── health.md
└── reference/                         ← cross-feature reference
    ├── frontend-shared.md             ← atoms / molecules / organisms / utils
    ├── frontend-services-api.md       ← api.ts + per-feature services
    ├── backend-infrastructure.md      ← main, middleware, config, db, deps
    ├── backend-layers.md              ← controller / service / repository pattern
    ├── pages-supporting.md            ← Home, Storyboard, DesignBoard
    └── justfile.md                    ← task runner (dev, test, lint, migrate)
```

## Reading conventions

Every reference to source code uses the form `path/to/file.py:LINE` or `path/to/file.py:START-END`. Open those exact ranges — don't read files top-to-bottom.

When a doc says "see [auth → cookies](./features/auth.md#cookies)", the link points to a section anchor; follow it for the detail.

## Conventions enforced in the code

- **Backend layers:** controllers → services → repositories. Skipping a layer is a review-blocker.
- **Frontend layers:** pages → organisms → molecules → atoms. Pages call `services/api.ts`; components never `fetch` directly.
- **Auth:** HttpOnly cookies only (`access_token`, `refresh_token`). No `localStorage`, no `Authorization` headers from FE.
- **Theme:** call `useTheme()` from `hooks/useTheme.ts`. Do not hand-roll the `data-theme` attribute.
- **Styles:** CSS Modules + design tokens in `frontend/src/styles/tokens.css`. No styled-components, no Tailwind.
- **Tests (BE):** `TestClient` + `app.dependency_overrides`. The real DB is never hit.
