import { useEffect, useRef, type ReactNode } from "react";
import styles from "./menu.module.css";

export interface MenuAnchor {
  left: number;
  bottom: number;
}

interface MenuProps {
  anchor: MenuAnchor;
  onClose: () => void;
  children: ReactNode;
}

const EDGE_MARGIN = 8;

export const Menu = ({ anchor, onClose, children }: MenuProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const maxLeft = window.innerWidth - 230 - EDGE_MARGIN;
  return (
    <div ref={ref} className={styles.menu} role="menu" style={{ left: Math.max(6, Math.min(anchor.left, maxLeft)), top: anchor.bottom + 4 }}>
      {children}
    </div>
  );
};

export const MenuHeading = ({ children }: { children: ReactNode }) => <div className={styles.heading}>{children}</div>;

export const MenuButton = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <button type="button" role="menuitem" className={styles.item} onClick={onClick}>
    {children}
  </button>
);
