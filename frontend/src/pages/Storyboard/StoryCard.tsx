import styles from "./Storyboard.module.css";

export interface StoryCardProps {
  name: string;
  props?: string;
  preview?: "row" | "column" | "center" | "full";
  children: React.ReactNode;
}

export const StoryCard = ({ name, props, preview = "row", children }: StoryCardProps) => {
  const previewClass = [
    styles.preview,
    preview === "column" ? styles.previewColumn : "",
    preview === "center" ? styles.previewCenter : "",
    preview === "full"   ? styles.previewFull   : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{name}</span>
      <div className={previewClass}>{children}</div>
      <div className={styles.cardMeta}>
        <span className={styles.cardName}>{name}</span>
        {props && <span className={styles.cardProps}>{props}</span>}
      </div>
    </div>
  );
};
