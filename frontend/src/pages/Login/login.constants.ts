export const AUTH_TABS = [
  { id: "signin", label: "Sign in" },
  { id: "signup", label: "Create account" },
];

export const TRUST_ITEMS = [
  { label: "SSO ready" },
  { label: "SOC 2 type II" },
  { label: "2FA" },
];

export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_cancelled: "Google sign-in was cancelled.",
  oauth_state_mismatch: "Security check failed. Please try again.",
  oauth_failed: "Google sign-in failed. Please try again.",
};
