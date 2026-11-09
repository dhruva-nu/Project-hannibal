import type { ReactNode } from "react";
import type {
  ArchModel,
  ComponentNode,
  FlowState,
  FunctionNode,
  InfraNode,
  LayerNode,
  NosqlNode,
  ServiceNode,
  SqlNode,
} from "@/pages/ArchTest/engine";
import { MAX_TABLE_LINES, NODE_REGISTRY, endpointById, endpointLabel, payloadLabel, varById } from "@/pages/ArchTest/engine";
import type { ArchNode } from "@/pages/ArchTest/engine";
import type { TraceView } from "@/pages/ArchTest/state/archApi";
import { MethodBadge } from "@/shared/components/atoms";
import { ArchStateLine } from "@/shared/components/molecules";
import styles from "./canvas.module.css";

const MAX_LAYER_TAGS = 8;
const MAX_COLUMNS_SHOWN = 5;

interface Context {
  model: ArchModel;
  trace: TraceView | null;
  /** Endpoint to highlight on a service card: the one the trace is on, or the one open in the inspector. */
  activeEndpoint: string | null;
}

const Line = ({ label, children, title }: { label?: string; children: ReactNode; title?: string }) => (
  <div className={styles.line} title={title}>
    {label && <span className={styles.lineLabel}>{label}</span>}
    <span className={styles.lineValue}>{children}</span>
  </div>
);

const varNames = (model: ArchModel, ids: readonly string[]): string =>
  ids.map((id) => varById(model, id)?.name ?? id).join(", ");

const ComponentBody = ({ model, trace, node }: Context & { node: ComponentNode }) => (
  <>
    <Line>{node.cfg.desc || "No description"}</Line>
    {node.cfg.state.map((variable) => (
      <ArchStateLine key={variable.id} variable={variable} trace={trace} />
    ))}
    {node.cfg.reads.length > 0 && <Line label="reads">{varNames(model, node.cfg.reads)}</Line>}
    {node.cfg.writes.length > 0 && (
      <Line label="sets">{varNames(model, node.cfg.writes.map((w) => w.varId))}</Line>
    )}
  </>
);

const triggerDetail = (node: FunctionNode): string => {
  const { trigger, interval, deps, url } = node.cfg;
  if (trigger === "Polling") return `every ${interval} ms`;
  if (trigger === "On Component Change") return `when ${deps || "nothing"} changes`;
  if (trigger === "WebSocket") return url;
  return trigger === "Initial Load" ? "once when the app boots" : "each time the component mounts";
};

const FunctionBody = ({ model, node }: Context & { node: FunctionNode }) => {
  const called = endpointById(model, node.cfg.endpoint);
  return (
    <>
      <Line label="runs">{triggerDetail(node)}</Line>
      <Line label="calls">
        {called ? (
          <>
            <MethodBadge method={called.endpoint.method} /> <code>{called.endpoint.path}</code>
          </>
        ) : (
          <span className={styles.muted}>no endpoint yet</span>
        )}
      </Line>
      {node.cfg.writes.length > 0 && (
        <Line label="sets">{varNames(model, node.cfg.writes.map((w) => w.varId))}</Line>
      )}
    </>
  );
};

const ServiceBody = ({ model, node, activeEndpoint }: Context & { node: ServiceNode }) => {
  if (!node.cfg.endpoints.length) return <Line>No endpoints yet</Line>;
  return (
    <>
      {node.cfg.endpoints.map((endpoint) => {
        const db = endpoint.dbId ? model.nodes.find((n) => n.id === endpoint.dbId) : undefined;
        return (
          <div
            key={endpoint.id}
            className={styles.endpointLine}
            data-endpoint={endpoint.id}
            data-active={endpoint.id === activeEndpoint}
            title={endpointLabel(endpoint) + (db ? ` queries ${db.name}` : "")}
          >
            <MethodBadge method={endpoint.method} />
            <code className={styles.endpointPath}>{endpoint.path}</code>
            {db && <span className={styles.endpointDb}>{db.name}</span>}
          </div>
        );
      })}
    </>
  );
};

const LayerBody = ({ model, node }: { model: ArchModel; node: LayerNode }) => {
  const members = model.nodes.filter((n) => n.layer === node.lid && !n.parent);
  if (!members.length) return <div className={styles.layerEmpty}>Empty. Click to open and start adding.</div>;
  return (
    <div className={styles.layerMembers}>
      {members.slice(0, MAX_LAYER_TAGS).map((member) => (
        <span key={member.id} className={styles.layerMember} data-member-id={member.id} data-cat={NODE_REGISTRY[member.type].cat}>
          <i className={styles.dot} />
          {member.name}
          <span className={styles.layerMemberKind}>{NODE_REGISTRY[member.type].label}</span>
        </span>
      ))}
      {members.length > MAX_LAYER_TAGS && <span className={styles.muted}>+{members.length - MAX_LAYER_TAGS} more</span>}
    </div>
  );
};

const columnSummary = (names: string[]): string =>
  names.slice(0, MAX_COLUMNS_SHOWN).join(", ") + (names.length > MAX_COLUMNS_SHOWN ? ` +${names.length - MAX_COLUMNS_SHOWN}` : "");

const SqlBody = ({ node }: { node: SqlNode }) => {
  if (!node.cfg.tables.length) return <Line>No tables</Line>;
  return (
    <>
      {node.cfg.tables.slice(0, MAX_TABLE_LINES).map((table) => (
        <Line key={table.name} label={table.name}>
          {columnSummary(table.columns.map((c) => c.name + (c.pk ? " pk" : c.fk ? " fk" : "")))}
        </Line>
      ))}
    </>
  );
};

const NosqlBody = ({ node }: { node: NosqlNode }) => {
  if (!node.cfg.collections.length) return <Line>No collections</Line>;
  return (
    <>
      {node.cfg.collections.slice(0, MAX_TABLE_LINES).map((collection) => (
        <Line key={collection.name} label={collection.name}>
          {columnSummary(collection.fields.map((f) => f.name))}
        </Line>
      ))}
    </>
  );
};

const InfraBody = ({ node }: { node: InfraNode }) => <Line>{NODE_REGISTRY[node.type].sum(node.cfg)}</Line>;

const bodyFor = (node: ArchNode, context: Context): ReactNode => {
  switch (node.type) {
    case "component":
      return <ComponentBody {...context} node={node} />;
    case "layer":
      return <LayerBody model={context.model} node={node} />;
    case "function":
      return <FunctionBody {...context} node={node} />;
    case "service":
      return <ServiceBody {...context} node={node} />;
    case "sqldb":
      return <SqlBody node={node} />;
    case "nosql":
      return <NosqlBody node={node} />;
    default:
      return <InfraBody node={node} />;
  }
};

export const FlowIo = ({ flow, nodeId }: { flow: FlowState; nodeId: string }) => {
  const io = flow.nodes[nodeId];
  if (!io || (io.in === undefined && io.out === undefined)) return null;
  return (
    <div className={styles.io}>
      in {payloadLabel(io.in) || "-"} · out {payloadLabel(io.out) || "-"}
    </div>
  );
};

interface NodeBodyProps extends Context {
  node: ArchNode;
}

export const NodeBody = ({ node, ...context }: NodeBodyProps) => <>{bodyFor(node, context)}</>;
