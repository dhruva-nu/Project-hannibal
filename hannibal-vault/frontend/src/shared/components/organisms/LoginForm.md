---
name: LoginForm
description: Auth form — email + password inputs, OAuth buttons, loading/success states, error display
type: file
layer: ui
tags: [organism, form, auth, login]
imports:
  - "[[frontend/src/shared/components/atoms/_atoms]]"
  - "[[frontend/src/shared/components/molecules/_molecules]]"
---

# `organisms/LoginForm/LoginForm.tsx`

**Imports:** `Button`, `Checkbox` (atoms) · `InputField`, `OAuthButton`, `PasswordField` (molecules)

**Used by:** [[frontend/src/pages/Login/Login]]

---

## `LoginForm` component — lines 23–117

Props: `mode` (`signin` | `signup`), `onSubmit`, optional `onGoogleAuth` / `onGitHubAuth`.

Holds its own email, password, rememberMe, submitState (`idle` | `loading` | `success`), and error state.

---

## `handleSubmit` — lines 35–46

Wraps `onSubmit(email, password)` with state management: sets `loading` on start, `success` on resolve, or shows the error message on reject. The submit button label changes to "verifying…" during loading and "✓ welcome back" on success.

**Calls:** `props.onSubmit` → [[frontend/src/pages/Login/Login#handleSubmit]]
