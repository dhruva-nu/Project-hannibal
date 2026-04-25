import { useEffect, useState } from "react";
import { PaperBg, ThemeToggle } from "@/shared/components/atoms";
import { NavBrand } from "@/shared/components/molecules";
import type { Theme } from "@/shared/types";
import styles from "./Home.module.css";

export const Home = () => {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <>
      <PaperBg />
      <div className={styles.stage}>
        <nav className={styles.nav} aria-label="Main navigation">
          <NavBrand href="/home" />
          <ThemeToggle theme={theme} onToggle={() => setTheme((p) => (p === "light" ? "dark" : "light"))} />
        </nav>
        <main className={styles.main}>
          <p className={styles.eyebrow}>// coming soon</p>
          <h1 className={styles.title}>The workshop<br />is being built.</h1>
          <p className={styles.sub}>Something great is on its way. Check back soon.</p>
        </main>
      </div>
    </>
  );
};
