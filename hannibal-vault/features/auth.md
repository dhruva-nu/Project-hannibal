# Auth Feature

← [[00 - Features Index|Back to index]]

Email/password login, registration, Google OAuth, token refresh, logout. Tokens are HttpOnly cookies — never localStorage.

## Data flow

```
[[Login]] ──► [[api]] ──► [[auth-controller]] ──► [[AuthService]] ──► [[UserRepository]]
                                                                   └──► [[RefreshTokenRepository]]

[[AuthContext]] ──► [[api]] ──► [[auth-controller]].me
```

## Nodes in this feature

### Frontend
- [[Login]] — login/register page, Google OAuth redirect
- [[AuthContext]] — `user` state, session bootstrap, `logout()`
- [[api]] — shared HTTP client (used by all features)

### Backend
- [[auth-controller]] — 7 endpoints: `/me`, `/register`, `/login`, `/logout`, `/refresh`, `/google`, `/google/callback`
- [[AuthService]] — password hashing, JWT creation, OAuth state HMAC
- [[UserRepository]] — email/oauth lookup, user creation
- [[RefreshTokenRepository]] — jti storage, revocation
