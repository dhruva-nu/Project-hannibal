import type { ArrowMarker, EdgeScene } from "@/pages/ArchTest/view/edgeScene";
import type { Point } from "@/pages/ArchTest/view/geometry";
import styles from "./canvas.module.css";

const MARKERS: Array<{ id: string; size: number; className: string }> = [
  { id: "arrow-default", size: 10, className: styles.markerDefault },
  { id: "arrow-selected", size: 11, className: styles.markerSelected },
  { id: "arrow-response", size: 11, className: styles.markerResponse },
  { id: "arrow-warn", size: 10, className: styles.markerWarn },
];

const markerId: Record<ArrowMarker, string> = {
  default: "arrow-default",
  selected: "arrow-selected",
  warn: "arrow-warn",
};

interface EdgeLayerProps {
  scene: EdgeScene;
  idPrefix: string;
  preview: { from: Point; to: Point } | null;
}

export const EdgeLayer = ({ scene, idPrefix, preview }: EdgeLayerProps) => (
  <svg className={styles.edgeSvg} xmlns="http://www.w3.org/2000/svg">
    <defs>
      {MARKERS.map((marker) => (
        <marker
          key={marker.id}
          id={`${idPrefix}-${marker.id}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth={marker.size}
          markerHeight={marker.size}
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" className={marker.className} />
        </marker>
      ))}
    </defs>
    <g>
      {scene.shapes.map((shape) => (
        <g key={shape.id}>
          <path
            className={styles.edge}
            d={shape.path}
            data-warn={shape.warn}
            data-selected={shape.selected}
            data-traversed={shape.traversed}
            data-dimmed={shape.dimmed}
            markerEnd={`url(#${idPrefix}-${markerId[shape.marker]})`}
          />
          <path className={styles.edgeHit} d={shape.path} data-edge-id={shape.id} />
        </g>
      ))}
      {scene.stateLinks.map((link) => (
        <path key={link.key} className={styles.stateLink} d={link.path} markerEnd={`url(#${idPrefix}-arrow-default)`} />
      ))}
      {scene.overlays.map((overlay) => (
        <path
          key={overlay.key}
          className={overlay.direction === "request" ? styles.flowRequest : styles.flowResponse}
          d={overlay.path}
          markerEnd={overlay.direction === "response" ? `url(#${idPrefix}-arrow-response)` : undefined}
        />
      ))}
      {preview && (
        <path className={styles.connectPreview} d={`M${preview.from.x},${preview.from.y} L${preview.to.x},${preview.to.y}`} />
      )}
    </g>
  </svg>
);
