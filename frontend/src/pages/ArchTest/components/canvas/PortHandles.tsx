import type { Side } from "../../view/geometry";
import styles from "./canvas.module.css";

const SIDES: Side[] = ["t", "b", "l", "r"];

export const PortHandles = () => (
  <>
    {SIDES.map((side) => (
      <i key={side} className={styles.port} data-port={side} />
    ))}
    <i className={styles.resize} data-resize="true" />
  </>
);
