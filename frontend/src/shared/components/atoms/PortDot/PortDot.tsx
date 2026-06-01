import styles from "./PortDot.module.css";

export type PortPosition = "l" | "r" | "t" | "b";

interface PortDotProps {
  position: PortPosition;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

export const PortDot = ({ position, onPointerDown, onPointerUp }: PortDotProps) => (
  <div
    className={`${styles.port} ${styles[position]}`}
    data-port-dot=""
    onPointerDown={onPointerDown}
    onPointerUp={onPointerUp}
    aria-hidden="true"
  />
);
