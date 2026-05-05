# CopilotKit Feature

← [[00 - Features Index|Back to index]]

AI tutor powered by Gemini 2.5 Flash via Google ADK. `CopilotPopup` is mounted globally (outside `<Routes>`) so it's available on every page. The agent has two tools: look up a user profile, and update a task board in the UI.

## Data flow

```
CopilotPopup (every page)
  └──► [[copilotkit-controller]] (SSE stream)
             └──► GoogleADKAgent → Gemini 2.5 Flash
                       ├─ get_user_profile tool ──► [[UserRepository]]
                       └─ update_tasks tool ──► in-memory per thread
```

## Nodes in this feature

### Frontend
- `App.tsx` — `<CopilotKit runtimeUrl="/api/v1/copilotkit">` + `<CopilotPopup>` (no dedicated FE node)

### Backend
- [[copilotkit-controller]] — SSE endpoint, ADK agent, tool implementations
- [[UserRepository]] — queried directly by `get_user_profile` tool (no service layer)
