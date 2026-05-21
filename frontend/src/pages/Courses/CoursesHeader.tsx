import { Badge, Input } from "@/shared/components/atoms";
import { AI_SUGGESTIONS } from "./courses.constants";
import styles from "./Courses.module.css";

interface CoursesHeaderProps {
  aiQuery: string;
  submitted: boolean;
  onQueryChange: (val: string) => void;
  onSubmit: () => void;
  onSuggestion: (text: string) => void;
}

export const CoursesHeader = ({ aiQuery, submitted, onQueryChange, onSubmit, onSuggestion }: CoursesHeaderProps) => (
  <header className={styles.pageHeader}>
    <div className={styles.headerLeft}>
      <Badge label="/courses · genUI" showDot />
      <h1 className={styles.title}>
        <span className={styles.marker}>Build</span>, don&apos;t browse.
        <br />
        <span className={styles.scribble}>— pick something to make today.</span>
      </h1>
      <p className={styles.lede}>
        Every course is a real artifact you ship. Or —{" "}
        <strong>ask the tutor</strong> to design a custom path for what you&apos;re trying to build.
      </p>
    </div>

    <div className={styles.aiBar}>
      <span className={styles.aiBarTag}>tutor.prompt</span>
      <Input
        promptMark="$"
        placeholder="describe what you want to build…"
        value={aiQuery}
        onChange={(e) => { onQueryChange(e.target.value); }}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        aria-label="Describe what you want to build"
        suffix={
          <button className={styles.sendBtn} onClick={onSubmit} aria-label="Submit prompt">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>
        }
      />
      {submitted && aiQuery && (
        <p className={styles.aiResponse}>
          Curating courses for: &ldquo;{aiQuery}&rdquo; — refining picks…
        </p>
      )}
      {!submitted && (
        <div className={styles.aiSuggestions}>
          {AI_SUGGESTIONS.map((s) => (
            <button key={s} className={styles.suggestion} onClick={() => onSuggestion(s)}>{s}</button>
          ))}
        </div>
      )}
    </div>
  </header>
);
