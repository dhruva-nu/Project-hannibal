import { Button, ThemeToggle } from "@/shared/components/atoms";
import { NavBrand } from "@/shared/components/molecules";
import type { NavLink, Theme } from "@/shared/types";
import styles from "./Navbar.module.css";

interface NavbarProps {
  links?: NavLink[];
  ctaLabel?: string;
  ctaHref?: string;
  theme: Theme;
  onThemeToggle: () => void;
  onLogout?: () => void;
}

const DEFAULT_LINKS: NavLink[] = [
  { label: "Tracks", href: "#" },
  { label: "For teams", href: "#" },
  { label: "Pricing", href: "#" },
  { label: "Sign in", href: "#" },
];

export const Navbar = ({
  links = DEFAULT_LINKS,
  ctaLabel = "Start building →",
  ctaHref = "#",
  theme,
  onThemeToggle,
  onLogout,
}: NavbarProps) => {
  return (
    <nav className={styles.nav} aria-label="Main navigation">
      <NavBrand />
      <div className={styles.links}>
        {links.map((link) => (
          <a key={link.label} className={styles.link} href={link.href}>
            {link.label}
          </a>
        ))}
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        {onLogout ? (
          <Button variant="ghost" onClick={onLogout}>
            Sign out
          </Button>
        ) : (
          <Button variant="navCta" href={ctaHref}>
            {ctaLabel}
          </Button>
        )}
      </div>
    </nav>
  );
};
