import type { MessageRole } from "@/shared/types";
import styles from "./Avatar.module.css";

interface AvatarProps {
  role: MessageRole;
  /** Override display label (defaults to "U" for user, "PH" for ai) */
  label?: string;
}

const DEFAULT_LABELS: Record<MessageRole, string> = {
  user: "U",
  ai: "PH",
};

export const Avatar = ({ role, label }: AvatarProps) => {
  return (
    <div className={[styles.avatar, styles[role]].join(" ")} aria-hidden="true">
      {label ?? DEFAULT_LABELS[role]}
    </div>
  );
};
