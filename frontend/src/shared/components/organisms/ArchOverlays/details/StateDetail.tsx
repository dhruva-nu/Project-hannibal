import { allVars, readersOf, writersOf, NODE_REGISTRY, type ArchModel, type PlacedNode, type StateVar } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText } from "@/shared/components/atoms";
import { Modal } from "@/shared/components/molecules";
import styles from "../overlays.module.css";

const ROW_HEIGHT = 46;
const ROW_OFFSET = 26;
const NODE_EDGE_X = 260;
const VAR_EDGE_X = 470;

const uniqueNodes = (model: ArchModel, vars: readonly StateVar[]): PlacedNode[] => {
  const found: PlacedNode[] = [];
  vars.forEach((v) =>
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

export const StateDetail = ({ onClose }: { onClose: () => void }) => {
  const { model } = useArch();
  const vars = allVars(model);
  const participants = uniqueNodes(model, vars);
  const height = Math.max(vars.length, participants.length) * ROW_HEIGHT + 30;
  const unused = vars.filter((v) => !readersOf(model, v.id).length && !writersOf(model, v.id).length);

  return (
    <Modal title="State dependencies" wide onClose={onClose}>
      {vars.length === 0 ? (
        <HintText>Add app state or component state first.</HintText>
      ) : (
        <>
          <HintText>Solid lines: a component or function modifies the variable. Dashed lines: a component reads it.</HintText>
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
                  {NODE_REGISTRY[x.type].label}
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
            <HintText key={v.id}>{v.name} is not read or modified by anything yet.</HintText>
          ))}
        </>
      )}
    </Modal>
  );
};
