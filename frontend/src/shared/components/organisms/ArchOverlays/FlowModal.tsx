import {
  edgeInfo,
  expectedFor,
  toPrettyJson,
  reachableNodes,
  warnText,
  type AnyEdge,
  type ArchNode,
  type DerivedEdge,
  type EdgeInfo,
} from "@/pages/ArchTest/engine";
import { findNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { Callout, CodeBlock, FieldCaption, HintText, ToolButton } from "@/shared/components/atoms";
import { DataTable, FormRow } from "@/shared/components/molecules";
import { flowRows, type FlowStatus } from "./flowRows";
import { Modal } from "@/shared/components/molecules";
import { ArchNodeLinks } from "@/shared/components/molecules";
import styles from "./overlays.module.css";

interface FlowModalProps {
  edgeId: string;
  onClose: () => void;
}

const STATUS_CLASS: Record<Exclude<FlowStatus, "">, string> = {
  added: styles.statusAdded,
  mapped: styles.statusMapped,
  removed: styles.statusRemoved,
  missing: styles.statusMissing,
  type: styles.statusType,
  modified: styles.statusModified,
  unused: styles.statusUnused,
};

const statusLabel = (status: FlowStatus) => (status === "type" ? "type mismatch" : status);

const DerivedEdgeList = ({ edge, from, to, onClose }: { edge: DerivedEdge; from: ArchNode; to: ArchNode; onClose: () => void }) => {
  const api = useArch();
  return (
    <Modal title={`Connections between ${from.name} and ${to.name}`} onClose={onClose}>
      {edge.ids.map((id) => {
        const real = api.model.edges.find((x) => x.id === id);
        const source = real && findNode(api.model, real.from);
        const target = real && findNode(api.model, real.to);
        return (
          <FormRow key={id}>
            <span>
              {source?.name} → {target?.name}
            </span>
            <ToolButton small keepWidth onClick={() => api.openFlow(id)}>
              Payload
            </ToolButton>
          </FormRow>
        );
      })}
    </Modal>
  );
};

const MismatchSummary = ({ info, target }: { info: EdgeInfo; target: ArchNode }) =>
  info.warns.length ? (
    <Callout tone="warning">
      <b>Schema mismatch</b>
      {info.warns.map((w) => (
        <div key={w.path + w.kind}>{warnText(w)}</div>
      ))}
    </Callout>
  ) : (
    <Callout tone="success">The payload matches what {target.name} expects.</Callout>
  );

const PayloadComparison = ({ edge, from, to, onClose }: { edge: Exclude<AnyEdge, DerivedEdge>; from: ArchNode; to: ArchNode; onClose: () => void }) => {
  const api = useArch();
  const info = edgeInfo(api.model, api.flow, edge);
  const rows = flowRows(info.src, info.req, expectedFor(to), edge.map);
  const componentsFeeding = reachableNodes(api.model, from.id, "bwd", ["component"]);
  const origin = from.type === "component" ? [from] : componentsFeeding;
  const consumers = from.type === "component" ? [...componentsFeeding, from] : componentsFeeding;
  return (
    <Modal title={`${from.name} → ${to.name}`} wide onClose={onClose}>
      <MismatchSummary info={info} target={to} />
      <HintText>
        Request data originates at: <ArchNodeLinks nodes={origin} />. Response data is consumed by: <ArchNodeLinks nodes={consumers} />.
      </HintText>
      <div className={styles.scroll}>
        <DataTable>
          <thead>
            <tr>
              <th>Field</th>
              <th>Source output</th>
              <th>On the wire</th>
              <th>Target expects</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path}>
                <td>{row.path}</td>
                <td>{row.source}</td>
                <td>{row.wire}</td>
                <td>{row.expected}</td>
                <td className={row.status ? STATUS_CLASS[row.status] : undefined}>{statusLabel(row.status)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
      <div className={styles.topGap}>
        <FieldCaption>Full request payload</FieldCaption>
      </div>
      <CodeBlock>{toPrettyJson(info.req)}</CodeBlock>
      {info.res !== undefined ? (
        <>
          <FieldCaption>Full response payload</FieldCaption>
          <CodeBlock>{toPrettyJson(info.res)}</CodeBlock>
        </>
      ) : (
        <HintText>No response recorded for this connection yet.</HintText>
      )}
    </Modal>
  );
};

export const FlowModal = ({ edgeId, onClose }: FlowModalProps) => {
  const api = useArch();
  const edge = api.edgeById(edgeId);
  const from = edge && findNode(api.model, edge.from);
  const to = edge && findNode(api.model, edge.to);
  if (!edge || !from || !to) return null;
  if (edge.derived) return <DerivedEdgeList edge={edge} from={from} to={to} onClose={onClose} />;
  return <PayloadComparison edge={edge} from={from} to={to} onClose={onClose} />;
};
