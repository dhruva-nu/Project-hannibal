import styles from "./StickyNote.module.css";

interface StickyNoteProps {
  children: React.ReactNode;
  rotate?: number;
  className?: string;
}

const Lamp = () => (
  /*
   * SVG occupies a 170×90 canvas positioned 70px above the note.
   * SVG y=70 == note top. The light cone extends from the bulb (y≈66)
   * downward through the note face (to y≈260).
   */
  <svg
    className={styles.lampSvg}
    viewBox="0 0 170 90"
    fill="none"
    aria-hidden="true"
    overflow="visible"
  >
    {/* Wall-mount bracket */}
    <rect x="148" y="0" width="22" height="10" rx="3" fill="currentColor" opacity="0.65" />
    <circle cx="159" cy="5" r="3" fill="currentColor" opacity="0.45" />

    {/* Horizontal arm */}
    <line x1="148" y1="5" x2="78" y2="5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />

    {/* Elbow joint */}
    <circle cx="78" cy="5" r="5" fill="currentColor" />

    {/* Angled drop arm */}
    <line x1="78" y1="5" x2="68" y2="46" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />

    {/* Lamp shade (trapezoid) */}
    <path d="M44 46 L92 46 L84 66 L52 66 Z" fill="currentColor" opacity="0.75" />
    <line x1="53" y1="48" x2="50" y2="63" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.18" />

    {/* Bulb */}
    <circle cx="68" cy="60" r="7" className={styles.bulb} />
    <circle cx="65" cy="57" r="2.5" fill="white" opacity="0.5" />
  </svg>
);

export const StickyNote = ({ children, rotate = 5, className = "" }: StickyNoteProps) => {
  return (
    <div
      className={[styles.sticky, className].filter(Boolean).join(" ")}
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      {/* Lamp + glow — visible only in dark mode */}
      <div className={styles.lampWrap}>
        <Lamp />
        <div className={styles.glow} />
      </div>
      {children}
    </div>
  );
};
