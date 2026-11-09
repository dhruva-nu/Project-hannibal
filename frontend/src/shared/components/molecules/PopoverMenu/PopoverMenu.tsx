import { useEffect, useRef, type ReactNode } from "react";
import styles from "./PopoverMenu.module.css";

export interface MenuAnchor {
  left: number;
  bottom: number;
}

interface PopoverMenuProps {
  anchor: MenuAnchor;
  onClose: () => void;
  children: ReactNode;
}

const MENU_WIDTH_PX = 230;
const VIEWPORT_MARGIN_PX = 8;
const MIN_LEFT_PX = 6;
const ANCHOR_GAP_PX = 4;

const clampedLeft = (left: number) => Math.max(MIN_LEFT_PX, Math.min(left, window.innerWidth - MENU_WIDTH_PX - VIEWPORT_MARGIN_PX));

export const PopoverMenu = ({ anchor, onClose, children }: PopoverMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [onClose]);

  return (
    <div ref={menuRef} className={styles.menu} role="menu" style={{ left: clampedLeft(anchor.left), top: anchor.bottom + ANCHOR_GAP_PX }}>
      {children}
    </div>
  );
};

export const MenuHeading = ({ children }: { children: ReactNode }) => <div className={styles.heading}>{children}</div>;

export const MenuItem = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <button type="button" role="menuitem" className={styles.item} onClick={onClick}>
    {children}
  </button>
);
