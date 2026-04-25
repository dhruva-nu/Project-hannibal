
## Component Reference

Before exploring the codebase, read **[COMPONENTS.md](./COMPONENTS.md)** — it contains the full component map (atoms, molecules, organisms), shared types, design tokens, routing setup, and common patterns. Saves ~45k tokens of exploration per task.

---

## Purpose

This document defines the engineering standards and architectural principles that all generated React code must follow.

All code must be:

* Maintainable
* Scalable
* Responsive
* Accessible
* Testable
* Production-ready

No shortcuts. No demo-level code.

---

# 1. Tech Stack Assumptions

Unless specified otherwise:

* React 18+
* TypeScript (strict mode enabled)
* Functional components only
* Hooks-based architecture
* Vite or Next.js (App Router) environment
* ESLint + Prettier enforced
* Absolute imports enabled
* Modern ECMAScript (no legacy patterns)

---

# 2. Architecture Principles

## 2.1 Folder Structure

Use feature-based structure (NOT flat component dumping):

```
src/
  app/ or pages/
  features/
    auth/
      components/
      hooks/
      services/
      types.ts
    dashboard/
  shared/
    components/
    hooks/
    utils/
    constants/
    types/
  lib/
  styles/
```

Never mix feature logic into shared.

---

## 2.2 Component Rules

All components must:

* Be small and single-responsibility
* Be reusable when possible
* Have explicit prop types
* Avoid inline anonymous functions in JSX when avoidable
* Avoid unnecessary re-renders (useMemo/useCallback only when justified)

Example standard:

```tsx
interface ButtonProps {
  variant?: "primary" | "secondary";
  onClick: () => void;
  children: React.ReactNode;
}

export const Button = ({ variant = "primary", onClick, children }: ButtonProps) => {
  return (
    <button
      className={`btn btn-${variant}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
};
```

No `any`. Ever.

---

# 3. State Management Rules

## 3.1 Local State

* useState for simple UI state
* useReducer for complex state transitions

## 3.2 Global State

Use:

* Context only for lightweight global concerns (theme, auth)
* Zustand, Redux Toolkit, or React Query for scalable state

Avoid prop drilling beyond 2 levels.

---

# 4. Data Fetching Standards

* Use React Query / TanStack Query
* All API logic must live in `services/`
* No API calls inside components directly
* Handle loading, error, and empty states
* Never ignore errors

Example:

```tsx
export const useUser = (id: string) => {
  return useQuery({
    queryKey: ["user", id],
    queryFn: () => userService.getUser(id),
  });
};
```

---

# 5. Styling Standards

Must be:

* Fully responsive (mobile-first)
* No fixed pixel layouts unless necessary
* Use Tailwind, CSS Modules, or Styled Components consistently
* No random inline styles

Layouts must use:

* Flexbox or Grid
* Proper spacing scale
* Semantic HTML

---

# 6. Accessibility (Non-Negotiable)

* All interactive elements must be keyboard accessible
* Buttons must be `<button>` not `<div>`
* Inputs must have labels
* Use ARIA only when necessary
* Ensure proper heading hierarchy

---

# 7. Performance Rules

* Lazy load heavy routes
* Memoize expensive calculations
* Avoid unnecessary re-renders
* Use dynamic imports when appropriate
* No large dependencies without justification

---

# 8. Error Handling

* Use error boundaries for major feature areas
* Always handle async errors
* Never swallow exceptions
* Show user-friendly error states

---

# 9. Testing Requirements

* Use React Testing Library
* Test behavior, not implementation
* Cover:

  * Rendering
  * User interaction
  * API states
  * Edge cases

---

# 10. Code Quality Rules

Strictly avoid:

* God components
* 300+ line components
* Nested ternaries
* Magic numbers
* Hardcoded strings (use constants)
* Duplicate logic
* Console.logs in production

---

# 11. Reusability & Extensibility

All code must be:

* Easily extendable without rewriting
* Open for extension, closed for modification
* Loosely coupled
* Strongly typed

---

# 12. Production Checklist

Before considering code complete:

* ✅ Fully responsive
* ✅ No TypeScript errors
* ✅ No ESLint warnings
* ✅ Proper loading + error states
* ✅ Accessible
* ✅ No unused imports
* ✅ Clean folder structure
* ✅ Clear naming conventions

---

# 13. AI Agent Behavioral Rules

When generating code:

1. Think like a senior frontend engineer.
2. Do not generate demo shortcuts.
3. Do not sacrifice structure for brevity.
4. Prefer clarity over cleverness.
5. Always assume the project will scale.
6. If a requirement is ambiguous, choose the more scalable solution.

