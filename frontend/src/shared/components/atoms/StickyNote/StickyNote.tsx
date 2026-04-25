import styles from "./StickyNote.module.css";

interface StickyNoteProps {
  children: React.ReactNode;
  rotate?: number;
  className?: string;
}

export const StickyNote = ({ children, rotate = 5, className = "" }: StickyNoteProps) => {
  return (
    <div
      className={[styles.sticky, className].filter(Boolean).join(" ")}
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
};
