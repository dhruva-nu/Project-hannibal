import type { Viewport } from "@/pages/ArchTest/view/geometry";

const GRID_SIZE = 24;

export const gridStyle = (view: Viewport) => ({
  backgroundSize: `${GRID_SIZE * view.k}px ${GRID_SIZE * view.k}px`,
  backgroundPosition: `${view.x}px ${view.y}px`,
});
