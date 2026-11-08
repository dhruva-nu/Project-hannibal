import type { ReactNode } from "react";
import type {
  ApiNode,
  ArchModel,
  ComponentNode,
  ConnectorNode,
  FlowState,
  FunctionNode,
  InfraNode,
  LayerNode,
  NosqlNode,
  SqlNode,
  StateNode,
  StateVar,
} from "../../engine";
import {
  attachedFns,
  node as nodeOf,
  payloadLabel,
  reach,
  readersOf,
  REG,
  writersOf,
} from "../../engine";
import type { ArchNode } from "../../engine";
import type { TraceView } from "../../state/archApi";
import styles from "./canvas.module.css";

const MAX_STATE_ROWS = 8;
const MAX_SQL_TABLES = 7;
const MAX_NOSQL_COLLECTIONS = 6;
const MAX_COLUMNS_SHOWN = 5;
const MAX_LAYER_TAGS = 6;
const STATE_VALUE_PREVIEW = 28;

const Tags = ({ items }: { items: Array<string | number> }) => (
  <div className={styles.tags}>
    {items.map((item, index) => (
      <span key={`${item}-${index}`} className={styles.tag}>
        {item}
      </span>
    ))}
  </div>
);

interface Context {
  model: ArchModel;
  trace: TraceView | null;
}

const changedStateValue = (trace: TraceView | null, variable: StateVar): string | null => {
  if (!trace) return null;
  const latest = trace.result.writes
    .filter((w) => w.varId === variable.id && (w.stepI ?? 0) <= trace.index)
    .at(-1);
  return latest ? JSON.stringify(latest.value) : null;
};

const StateBody = ({ model, trace, node }: Context & { node: StateNode }) => {
  if (!node.cfg.vars.length) return <>No variables yet</>;
  return (
    <>
      {node.cfg.vars.slice(0, MAX_STATE_ROWS).map((variable) => {
        const changed = changedStateValue(trace, variable);
        const readers = readersOf(model, variable.id).length;
        const writers = writersOf(model, variable.id).length;
        return (
          <div key={variable.id} className={changed === null ? styles.valueLine : `${styles.valueLine} ${styles.changed}`}>
            <span>
              {variable.name} <span className={styles.muted}>{variable.type}</span>
            </span>
            <b>{changed === null ? `R${readers} W${writers}` : changed.slice(0, STATE_VALUE_PREVIEW)}</b>
          </div>
        );
      })}
    </>
  );
};

const LayerBody = ({ model, node }: { model: ArchModel; node: LayerNode }) => {
  const members = model.nodes.filter((n) => n.layer === node.lid);
  const counts: Record<string, number> = {};
  members.forEach((member) => {
    const label = REG[member.type].label.toLowerCase();
    counts[label] = (counts[label] ?? 0) + 1;
  });
  const summary = Object.entries(counts)
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
  const topLevel = members.filter((m) => !m.parent).slice(0, MAX_LAYER_TAGS);
  return (
    <>
      <div className={styles.description}>{summary || "Empty. Click to open and start adding."}</div>
      <Tags items={topLevel.map((m) => m.name)} />
    </>
  );
};

const functionTag = (node: FunctionNode): string => {
  const { trigger, interval, deps, url } = node.cfg;
  if (trigger === "Polling") return `every ${interval} ms`;
  if (trigger === "On Component Change") return `deps: ${deps || "none"}`;
  if (trigger === "WebSocket") return url;
  return trigger === "Initial Load" ? "once at boot" : "on mount";
};

const ComponentBody = ({ model, node }: { model: ArchModel; node: ComponentNode }) => (
  <>
    <div className={styles.description}>{node.cfg.desc}</div>
    <Tags items={[`${attachedFns(model, node.id).length} functions`, `${node.cfg.reads.length} state read`]} />
  </>
);

const ApiBody = ({ model, node }: { model: ArchModel; node: ApiNode }) => (
  <>
    <div>
      <span className={styles.method}>{node.cfg.method}</span>
      <code>{node.cfg.path}</code>
    </div>
    <Tags items={node.cfg.responses.map((r) => r.status)} />
    <div className={styles.usedBy}>Used by {reach(model, node.id, "bwd", ["component"]).length} component(s)</div>
  </>
);

const ConnectorBody = ({ model, node }: { model: ArchModel; node: ConnectorNode }) => {
  const db = nodeOf(model, node.cfg.dbId);
  if (!db) return <div>No database chosen</div>;
  const joins = node.cfg.q.joins.length ? [`${node.cfg.q.joins.length} join(s)`] : [];
  return (
    <>
      <div>
        {db.name}
        {db.type === "sqldb" ? " (SQL)" : " (NoSQL)"}
      </div>
      <Tags items={[...node.cfg.q.tables, ...joins]} />
    </>
  );
};

const SqlBody = ({ node }: { node: SqlNode }) => {
  if (!node.cfg.tables.length) return <>No tables</>;
  return (
    <>
      {node.cfg.tables.slice(0, MAX_SQL_TABLES).map((table) => (
        <div key={table.name} className={styles.tableLine}>
          <b>{table.name}</b>{" "}
          {table.columns
            .slice(0, MAX_COLUMNS_SHOWN)
            .map((c) => c.name + (c.pk ? " (pk)" : c.fk ? " (fk)" : ""))
            .join(", ")}
          {table.columns.length > MAX_COLUMNS_SHOWN ? ` +${table.columns.length - MAX_COLUMNS_SHOWN}` : ""}
        </div>
      ))}
    </>
  );
};

const NosqlBody = ({ node }: { node: NosqlNode }) => {
  if (!node.cfg.collections.length) return <>No collections</>;
  return (
    <>
      {node.cfg.collections.slice(0, MAX_NOSQL_COLLECTIONS).map((collection) => (
        <div key={collection.name} className={styles.tableLine}>
          <b>{collection.name}</b> {collection.fields.slice(0, MAX_COLUMNS_SHOWN).map((f) => f.name).join(", ")}
        </div>
      ))}
    </>
  );
};

const InfraBody = ({ node }: { node: InfraNode }) => <>{REG[node.type].sum?.(node.cfg) ?? ""}</>;

const bodyFor = (node: ArchNode, context: Context): ReactNode => {
  switch (node.type) {
    case "component":
      return <ComponentBody model={context.model} node={node} />;
    case "layer":
      return <LayerBody model={context.model} node={node} />;
    case "function":
      return <Tags items={[functionTag(node)]} />;
    case "state":
      return <StateBody {...context} node={node} />;
    case "api":
      return <ApiBody model={context.model} node={node} />;
    case "connector":
      return <ConnectorBody model={context.model} node={node} />;
    case "sqldb":
      return <SqlBody node={node} />;
    case "nosql":
      return <NosqlBody node={node} />;
    default:
      return <InfraBody node={node} />;
  }
};

const FlowIo = ({ flow, nodeId }: { flow: FlowState; nodeId: string }) => {
  const io = flow.nodes[nodeId];
  if (!io || (io.in === undefined && io.out === undefined)) return null;
  return (
    <div className={styles.io}>
      in {payloadLabel(io.in) || "-"}
      <br />
      out {payloadLabel(io.out) || "-"}
    </div>
  );
};

interface NodeBodyProps extends Context {
  node: ArchNode;
  flow: FlowState;
  showFlow: boolean;
}

export const NodeBody = ({ node, model, trace, flow, showFlow }: NodeBodyProps) => (
  <>
    {bodyFor(node, { model, trace })}
    {showFlow && <FlowIo flow={flow} nodeId={node.id} />}
  </>
);
