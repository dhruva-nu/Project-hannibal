import { useState } from "react";
import { Button } from "@/shared/components/atoms";
import { InputField, OAuthButton, PasswordField } from "@/shared/components/molecules";
import { Checkbox } from "@/shared/components/atoms";
import styles from "./LoginForm.module.css";

type FormMode = "signin" | "signup";

interface LoginFormValues {
  email: string;
  password: string;
  rememberMe: boolean;
}

interface LoginFormProps {
  mode: FormMode;
  onSubmit: (values: LoginFormValues) => Promise<void>;
  onGoogleAuth?: () => void;
  onGitHubAuth?: () => void;
}

type SubmitState = "idle" | "loading" | "success";

const SUBMIT_LABELS: Record<FormMode, string> = {
  signin: "Sign in & continue building",
  signup: "Create account & start building",
};

export const LoginForm = ({
  mode,
  onSubmit,
  onGoogleAuth,
  onGitHubAuth,
}: LoginFormProps) => {
  const [email, setEmail] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitState("loading");
    try {
      await onSubmit({ email, password: "", rememberMe });
      setSubmitState("success");
      setTimeout(() => setSubmitState("idle"), 2400);
    } catch {
      setSubmitState("idle");
    }
  };

  const submitLabel =
    submitState === "loading"
      ? "verifying..."
      : submitState === "success"
        ? "✓ welcome back"
        : SUBMIT_LABELS[mode];

  return (
    <div className={styles.card}>
      <span className={styles.cardTag}>login.form</span>
      <div className={styles.sticky} aria-hidden="true">
        we never store<br />your password ✦
      </div>

      <div className={styles.oauthGrid}>
        <OAuthButton provider="google" onClick={onGoogleAuth} />
        <OAuthButton provider="github" onClick={onGitHubAuth} />
      </div>

      <div className={styles.divider}>or with email</div>

      <form onSubmit={handleSubmit} autoComplete="off" noValidate>
        <InputField
          label="Email"
          type="email"
          placeholder="you@workshop.dev"
          promptMark="$"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <PasswordField
          label="Password"
          hintLabel="Forgot?"
          hintHref="#"
          required
        />

        <div className={styles.checkRow}>
          <Checkbox
            label="Keep me signed in"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            name="remember"
          />
        </div>

        <Button
          variant="submit"
          type="submit"
          disabled={submitState === "loading"}
        >
          {submitLabel}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </Button>
      </form>

      <div className={styles.footnote}>
        By signing in you agree to our{" "}
        <a href="#">terms</a> &amp; <a href="#">privacy</a>.
      </div>
    </div>
  );
};
