import {
  Avatar, Badge, BrandMark, Button, Checkbox, Chip, Input, LiveDot,
  Tag, ThemeToggle, TypingIndicator, PortDot,
} from "@/shared/components";
import type { Theme } from "@/shared/types";
import { StoryCard } from "../StoryCard";
import styles from "../Storyboard.module.css";

interface AtomsSectionProps {
  theme: Theme;
  toggleTheme: () => void;
  cbChecked: boolean;
  setCbChecked: (v: boolean) => void;
}

export const AtomsSection = ({ theme, toggleTheme, cbChecked, setCbChecked }: AtomsSectionProps) => (
  <section id="atoms" className={styles.section}>
    <div className={styles.sectionHeader} data-label="the primitives">
      <span className={styles.sectionNum}>01</span>
      <h2 className={styles.sectionTitle}>Atoms</h2>
      <span className={styles.sectionDesc}>12 components</span>
    </div>

    <div className={styles.grid}>
      <StoryCard name="Button" props="variant=primary">
        <Button variant="primary" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>}>
          Start building
        </Button>
      </StoryCard>

      <StoryCard name="Button" props="variant=ghost">
        <Button variant="ghost" icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>} iconPosition="left">
          Watch demo
        </Button>
      </StoryCard>

      <StoryCard name="Button" props="variant=navCta">
        <Button variant="navCta">Start building →</Button>
      </StoryCard>

      <StoryCard name="Button" props="variant=submit">
        <Button variant="submit">Sign in & continue building
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </Button>
      </StoryCard>

      <StoryCard name="Badge" props="showDot=true">
        <Badge label="Hands-on coding · System design" />
      </StoryCard>

      <StoryCard name="Badge" props="showDot=false">
        <Badge label="auth · /login" showDot={false} />
      </StoryCard>

      <StoryCard name="Avatar" props="role=user | role=ai">
        <Avatar role="user" />
        <Avatar role="ai" />
      </StoryCard>

      <StoryCard name="BrandMark">
        <BrandMark />
        <BrandMark letters="AI" />
      </StoryCard>

      <StoryCard name="Chip" props="label + color">
        <Chip label="Build an OTP system"   color="oklch(0.66 0.20 28)" />
        <Chip label="Rate limit an API"     color="oklch(0.78 0.18 85)" />
        <Chip label="Caching with Redis"    color="oklch(0.62 0.13 220)" />
      </StoryCard>

      <StoryCard name="LiveDot">
        <LiveDot />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-faint)", marginLeft: 4 }}>tutor · live</span>
      </StoryCard>

      <StoryCard name="Tag">
        <Tag label="system.sketch" />
        <Tag label="tutor.snippet" />
      </StoryCard>

      <StoryCard name="ThemeToggle" props={`theme=${theme}`}>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </StoryCard>

      <StoryCard name="TypingIndicator">
        <TypingIndicator />
      </StoryCard>

      <StoryCard name="Input" props="promptMark=$">
        <Input promptMark="$" placeholder="you@workshop.dev" />
      </StoryCard>

      <StoryCard name="Checkbox" preview="column">
        <Checkbox label="Keep me signed in" checked={cbChecked} onChange={(e) => setCbChecked(e.target.checked)} />
        <Checkbox label="Agree to terms" />
      </StoryCard>

      <StoryCard name="PortDot" props="position=l|r|t|b">
        <div style={{ position: "relative", width: 60, height: 60, border: "1.5px solid var(--accent-3)", borderRadius: 8, background: "var(--paper-2)" }}>
          {(["l", "r", "t", "b"] as const).map(p => (
            <PortDot key={p} position={p} onPointerDown={() => {}} onPointerUp={() => {}} />
          ))}
        </div>
      </StoryCard>
    </div>
  </section>
);
