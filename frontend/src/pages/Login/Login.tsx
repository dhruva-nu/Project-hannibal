import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, PaperBg, StickyNote, ThemeToggle } from "@/shared/components/atoms";
import { NavBrand, Tabs, TrustPillStrip } from "@/shared/components/molecules";
import { LoginForm } from "@/shared/components/organisms";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/services/api";
import type { User } from "@/shared/types";
import { useTheme } from "@/hooks/useTheme";
import { AUTH_TABS, TRUST_ITEMS, OAUTH_ERROR_MESSAGES } from "./login.constants";
import { LoginDemoCol } from "./LoginDemoCol";
import styles from "./Login.module.css";

type FormMode = "signin" | "signup";

export const Login = () => {
  const { theme, toggleTheme: handleThemeToggle } = useTheme();
  const [activeTab, setActiveTab] = useState<FormMode>("signin");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();

  const oauthError = useMemo(() => {
    const err = searchParams.get("error");
    if (!err) return null;
    return OAUTH_ERROR_MESSAGES[err] ?? "Authentication failed. Please try again.";
  }, [searchParams]);

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
              <a href="#" className={styles.navAction} onClick={(e) => { e.preventDefault(); setActiveTab("signup"); }}>
                Create an account
              </a>
            </span>
            <ThemeToggle theme={theme} onToggle={handleThemeToggle} />
          </div>
        </nav>

        <main className={styles.main}>
          <div className={styles.authCol}>
            <div className={styles.eyebrow}>
              <Badge label="auth · /login" />
            </div>
            <h1 className={styles.title}>
              {activeTab === "signin" ? (<>Welcome back to<br /></>) : "Join "}
              <span className={styles.marker}>the workshop.</span>
            </h1>
            <p className={styles.subtitle}>
              {activeTab === "signin" ? (
                <>Pick up where you left off.{" "}<a href="#" className={styles.subtitleLink}>Resume your build</a>{" "}— or start a new one with the AI tutor.</>
              ) : (
                <>Start your journey.{" "}<a href="#" className={styles.subtitleLink}>Explore the curriculum</a>{" "}— or jump right in with the AI tutor.</>
              )}
            </p>
            <Tabs tabs={AUTH_TABS} activeId={activeTab} onChange={(id) => setActiveTab(id as FormMode)} />
            <div className={styles.formWrap}>
              <StickyNote>we never store<br />your password ✦</StickyNote>
              {oauthError && <p className={styles.oauthError}>{oauthError}</p>}
              <LoginForm mode={activeTab} onSubmit={handleSubmit} onGoogleAuth={() => { window.location.href = "/api/v1/auth/google"; }} />
            </div>
            <TrustPillStrip items={TRUST_ITEMS} />
          </div>

          <LoginDemoCol />
        </main>
      </div>
    </>
  );
};
