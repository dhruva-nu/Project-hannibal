import styles from "./Storyboard.module.css";

export interface OrgStoryProps {
  name: string;
  dark?: boolean;
  children: React.ReactNode;
}

export const OrgStory = ({ name, dark = false, children }: OrgStoryProps) => (
  <div className={styles.orgWrap}>
    <div className={styles.orgLabel}>{name}</div>
    <div className={[styles.orgPreview, dark ? styles.orgPreviewDark : ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  </div>
);
