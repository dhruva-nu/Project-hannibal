import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, PaperBg, StickyNote, ThemeToggle } from "@/shared/components/atoms";
import { NavBrand, Tabs, TrustPillStrip } from "@/shared/components/molecules";
import { AuthFlowDiagram, LoginForm } from "@/shared/components/organisms";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/services/api";
import type { User } from "@/shared/types";
import { useTheme } from "@/hooks/useTheme";

import styles from "./Login.module.css";

type FormMode = "signin" | "signup";

const AUTH_TABS = [
  { id: "signin", label: "Sign in" },
  { id: "signup", label: "Create account" },
];

const TRUST_ITEMS = [
  { label: "SSO ready" },
  { label: "SOC 2 type II" },
  { label: "2FA" },
];

export const Login = () => {
  const { theme, toggleTheme: handleThemeToggle } = useTheme();
  const [activeTab, setActiveTab] = useState<FormMode>("signin");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();

  const oauthError = useMemo(() => {
    const err = searchParams.get("error");
    if (!err) return null;
    const messages: Record<string, string> = {
      oauth_cancelled: "Google sign-in was cancelled.",
      oauth_state_mismatch: "Security check failed. Please try again.",
      oauth_failed: "Google sign-in failed. Please try again.",
    };
    return messages[err] ?? "Authentication failed. Please try again.";
  }, [searchParams]);

  const handleTabChange = (id: string) => {
    setActiveTab(id as FormMode);
  };

  const handleGoogleAuth = () => {
    window.location.href = "/api/v1/auth/google";
  };

  const handleSubmit = async (email: string, password: string): Promise<void> => {
    if (activeTab === "signup") {
      await api.post("/api/v1/auth/register", { email, password });
    }
    const user = await api.post<User>("/api/v1/auth/login", { email, password });
    setUser(user);
    navigate("/home");
  };

  return (
    <>
      <PaperBg />

      <div className={styles.stage}>
        <nav className={styles.nav} aria-label="Main navigation">
          <NavBrand href="/" />
          <div className={styles.navRight}>
            <span className={styles.navText}>
              New here?{" "}
              <a
                href="#"
                className={styles.navAction}
                onClick={(e) => { e.preventDefault(); setActiveTab("signup"); }}
              >
                Create an account
              </a>
            </span>
            <ThemeToggle theme={theme} onToggle={handleThemeToggle} />
          </div>
        </nav>

        <main className={styles.main}>
          {/* LEFT: form column */}
          <div className={styles.authCol}>
            <div className={styles.eyebrow}>
              <Badge label="auth · /login" />
            </div>

            <h1 className={styles.title}>
              {activeTab === "signin" ? (
                <>
                  Welcome back to
                  <br />
                </>
              ) : (
                "Join "
              )}
              <span className={styles.marker}>the workshop.</span>
            </h1>

            <p className={styles.subtitle}>
              {activeTab === "signin" ? (
                <>
                  Pick up where you left off.{" "}
                  <a href="#" className={styles.subtitleLink}>
                    Resume your build
                  </a>{" "}
                  — or start a new one with the AI tutor.
                </>
              ) : (
                <>
                  Start your journey.{" "}
                  <a href="#" className={styles.subtitleLink}>
                    Explore the curriculum
                  </a>{" "}
                  — or jump right in with the AI tutor.
                </>
              )}
            </p>

            <Tabs
              tabs={AUTH_TABS}
              activeId={activeTab}
              onChange={handleTabChange}
            />

            <div className={styles.formWrap}>
              <StickyNote>
                we never store<br />your password ✦
              </StickyNote>
              {oauthError && (
                <p className={styles.oauthError}>{oauthError}</p>
              )}
              <LoginForm
                mode={activeTab}
                onSubmit={handleSubmit}
                onGoogleAuth={handleGoogleAuth}
              />
            </div>

            <TrustPillStrip items={TRUST_ITEMS} />
          </div>

          {/* RIGHT: auth flow demo */}
          <div className={styles.demoCol}>
            <p className={styles.floatAnno} aria-hidden="true">
              what happens
              <br />
              when you sign in ↘
              <svg
                width="80"
                height="40"
                viewBox="0 0 80 40"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M5 8 Q 35 5, 60 25" strokeDasharray="4 4" />
                <path d="M52 18 L 62 26 L 56 30" />
              </svg>
            </p>
            <AuthFlowDiagram />
          </div>
        </main>
      </div>
    </>
  );
};
