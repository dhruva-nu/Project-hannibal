import { useCallback, useState } from "react";
import type { SqlNode, SqlTable } from "@/pages/ArchTest/engine";
import { CodeBlock, FieldCaption } from "@/shared/components/atoms";
import { Modal } from "@/shared/components/molecules";
import styles from "../overlays.module.css";

const FOREIGN_KEY_HANDLE = 40;

const entityTable = (table: SqlTable) => (
  <div className={styles.entity} key={table.name}>
    <div className={styles.entityHead}>{table.name}</div>
    {table.columns.map((column) => (
      <div
        className={styles.entityColumn}
        key={column.name}
        data-column={`${table.name}.${column.name}`}
        data-foreign-key={column.fk || undefined}
      >
        <span>
          {column.name}
          {column.pk && <b>PK</b>}
          {column.fk && <b>FK</b>}
        </span>
        <span>{column.type}</span>
      </div>
    ))}
    {table.indexes.length > 0 && (
      <>
        <div className={`${styles.entityColumn} ${styles.entityDivider}`}>
          <span>Indexes</span>
          <span />
        </div>
        {table.indexes.map((index) => (
          <div className={styles.entityColumn} key={index.name}>
            <span>
              {index.name}
              {index.unique && <b>unique</b>}
            </span>
            <span>{index.columns}</span>
          </div>
        ))}
      </>
    )}
  </div>
);

const foreignKeyPath = (source: DOMRect, target: DOMRect, container: DOMRect): string => {
  const targetIsRight = source.left + source.width / 2 < target.left + target.width / 2;
  const x1 = (targetIsRight ? source.right : source.left) - container.left;
  const y1 = source.top + source.height / 2 - container.top;
  const x2 = (targetIsRight ? target.left : target.right) - container.left;
  const y2 = target.top + target.height / 2 - container.top;
  const handle = targetIsRight ? FOREIGN_KEY_HANDLE : -FOREIGN_KEY_HANDLE;
  return `M${x1},${y1} C${x1 + handle},${y1} ${x2 - handle},${y2} ${x2},${y2}`;
};

const measureForeignKeys = (container: HTMLElement): string[] => {
  const bounds = container.getBoundingClientRect();
  if (!bounds.width) return [];
  const columns = Array.from(container.querySelectorAll<HTMLElement>("[data-column]"));
  return columns
    .filter((row) => row.dataset.foreignKey)
    .flatMap((row) => {
      const target = columns.find((c) => c.dataset.column === row.dataset.foreignKey);
      return target
        ? [foreignKeyPath(row.getBoundingClientRect(), target.getBoundingClientRect(), bounds)]
        : [];
    });
};

export const SqlDetail = ({ node, onClose }: { node: SqlNode; onClose: () => void }) => {
  const [paths, setPaths] = useState<string[]>([]);
  const measureOnMount = useCallback((container: HTMLDivElement | null) => {
    if (container) setPaths(measureForeignKeys(container));
  }, []);

  return (
    <Modal title={`${node.name} schema`} wide onClose={onClose}>
      <div className={styles.er} ref={measureOnMount}>
        {node.cfg.tables.map(entityTable)}
        <svg aria-hidden="true">
          <defs>
            <marker id="erm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className={styles.fillMuted} />
            </marker>
          </defs>
          <g>
            {paths.map((d) => (
              <path key={d} d={d} className={styles.strokeMuted} strokeWidth={1.5} markerEnd="url(#erm)" />
            ))}
          </g>
        </svg>
      </div>
      {node.cfg.sps.length > 0 && (
        <div className={styles.topGap}>
          <FieldCaption>Stored procedures</FieldCaption>
          {node.cfg.sps.map((sp) => (
            <CodeBlock key={sp.name}>{`${sp.name}(${sp.params})\n${sp.body}`}</CodeBlock>
          ))}
        </div>
      )}
    </Modal>
  );
};
