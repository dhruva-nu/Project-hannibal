import { readersOf, writersOf, REG, type ArchModel, type PlacedNode, type StateNode } from "../../../engine";
import { useArch } from "../../../state/archApi";
import { Note } from "../../../ui/Controls";
import { Modal } from "../Modal";
import styles from "../overlays.module.css";

const ROW_HEIGHT = 46;
const ROW_OFFSET = 26;
const NODE_EDGE_X = 260;
const VAR_EDGE_X = 470;

const uniqueNodes = (model: ArchModel, node: StateNode): PlacedNode[] => {
  const found: PlacedNode[] = [];
  node.cfg.vars.forEach((v) =>
    [...readersOf(model, v.id), ...writersOf(model, v.id)].forEach((x) => {
      if (!found.includes(x)) found.push(x);
    }),
  );
  return found;
};

const rowY = (index: number) => ROW_OFFSET + index * ROW_HEIGHT;

const Arrowhead = ({ id, fill }: { id: string; fill: string }) => (
  <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" className={fill} />
  </marker>
);

export const StateDetail = ({ node, onClose }: { node: StateNode; onClose: () => void }) => {
  const { model } = useArch();
  const vars = node.cfg.vars;
  const participants = uniqueNodes(model, node);
  const height = Math.max(vars.length, participants.length) * ROW_HEIGHT + 30;
  const unused = vars.filter((v) => !readersOf(model, v.id).length && !writersOf(model, v.id).length);

  return (
    <Modal title={`${node.name} dependencies`} wide onClose={onClose}>
      {vars.length === 0 ? (
        <Note>Add variables first.</Note>
      ) : (
        <>
          <Note>Solid lines: a component or function modifies the variable. Dashed lines: a component reads it.</Note>
          <svg viewBox={`0 0 700 ${height}`} width="100%" className={styles.diagram} role="img" aria-label="State dependencies">
            <defs>
              <Arrowhead id="sdm" fill={styles.fillMuted} />
              <Arrowhead id="sdm2" fill={styles.fillAccent} />
            </defs>
            {vars.flatMap((v, vi) => [
              ...readersOf(model, v.id).map((x) => (
                <path
                  key={`r-${v.id}-${x.id}`}
                  d={`M${VAR_EDGE_X},${rowY(vi)} C400,${rowY(vi)} 330,${rowY(participants.indexOf(x))} ${NODE_EDGE_X},${rowY(participants.indexOf(x))}`}
                  className={styles.strokeMuted}
                  strokeDasharray="4 4"
                  markerEnd="url(#sdm)"
                />
              )),
              ...writersOf(model, v.id).map((x) => (
                <path
                  key={`w-${v.id}-${x.id}`}
                  d={`M${NODE_EDGE_X},${rowY(participants.indexOf(x))} C330,${rowY(participants.indexOf(x))} 400,${rowY(vi)} ${VAR_EDGE_X},${rowY(vi)}`}
                  className={styles.strokeAccent}
                  markerEnd="url(#sdm2)"
                />
              )),
            ])}
            {participants.map((x, i) => (
              <g key={x.id}>
                <text x={250} y={rowY(i) + 4} textAnchor="end" className={styles.diagramLabel}>
                  {x.name}
                </text>
                <text x={250} y={rowY(i) + 17} textAnchor="end" className={styles.diagramSub}>
                  {REG[x.type].label}
                </text>
              </g>
            ))}
            {vars.map((v, i) => (
              <text key={v.id} x={480} y={rowY(i) + 4} className={styles.diagramLabel}>
                {v.name} <tspan className={styles.diagramSub}>{v.type}</tspan>
              </text>
            ))}
          </svg>
          {unused.map((v) => (
            <Note key={v.id}>{v.name} is not read or modified by anything yet.</Note>
          ))}
        </>
      )}
    </Modal>
  );
};
