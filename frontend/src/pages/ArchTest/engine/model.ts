import { pj, uid } from "./json";
import { FN_TRIGGERS, REG, isContainer } from "./registry";
import type {
  ArchEdge,
  ArchModel,
  ArchNode,
  ConnectorNode,
  DbNode,
  FunctionNode,
  Group,
  LayerId,
  LayerNode,
  MapRow,
  NodeType,
  PlacedNode,
  PlacedType,
  Row,
  StateVarRef,
  TableLike,
} from "./types";

export { isContainer };

export const DEFAULT_VIEW = { x: 60, y: 40, k: 0.8 };
const LAYER_NODE_X = 280;
const LAYER_NODE_WIDTH = 440;
const LAYER_NODE_HEIGHT = 160;

export const node = (model: ArchModel, id: string): ArchNode | undefined =>
  model.lnodes.find((n) => n.id === id) ?? model.nodes.find((n) => n.id === id);

export const outE = (model: ArchModel, id: string): ArchEdge[] => model.edges.filter((e) => e.from === id);
export const inE = (model: ArchModel, id: string): ArchEdge[] => model.edges.filter((e) => e.to === id);
export const grp = (model: ArchModel, id: string): Group | undefined => model.groups.find((g) => g.id === id);

export const descendants = (model: ArchModel, id: string): string[] => {
  const found: string[] = [];
  model.nodes.forEach((n) => {
    if (n.parent !== id) return;
    found.push(n.id);
    descendants(model, n.id).forEach((child) => found.push(child));
  });
  return found;
};

export const defaultLayerNodes = (): LayerNode[] =>
  (
    [
      ["client", "Client layer", 40],
      ["backend", "Backend layer", 330],
      ["db", "Database layer", 620],
    ] as const
  ).map(([lid, name, y]) => ({
    id: "L_" + lid,
    type: "layer" as const,
    lid,
    x: LAYER_NODE_X,
    y,
    w: LAYER_NODE_WIDTH,
    h: LAYER_NODE_HEIGHT,
    name,
    group: null,
    parent: null,
    layer: null,
    cfg: {},
  }));

export interface MakeNodeOptions {
  id?: string;
  w?: number;
  h?: number;
  name?: string;
  layer?: LayerId | null;
  cfg?: Record<string, unknown>;
}

export const mkNode = (type: PlacedType, x: number, y: number, options: MakeNodeOptions = {}): PlacedNode => {
  const entry = REG[type];
  return {
    id: options.id || uid("n"),
    type,
    x,
    y,
    w: options.w || entry.w,
    h: options.h || entry.h,
    name: options.name || entry.label,
    group: null,
    parent: null,
    layer: options.layer !== undefined ? options.layer : (entry.layer ?? null),
    cfg: Object.assign(entry.def(), options.cfg ?? {}),
  } as PlacedNode;
};

export const mkEdge = (from: string, to: string, map: MapRow[] = []): ArchEdge => ({
  id: uid("e"),
  from,
  to,
  label: "",
  map,
});

export const uniqueName = (model: ArchModel, base: string): string => {
  let counter = 1;
  let name = base;
  while (model.nodes.some((n) => n.name === name)) {
    counter++;
    name = base + " " + counter;
  }
  return name;
};

export const allVars = (model: ArchModel): StateVarRef[] =>
  model.nodes.flatMap((n) => (n.type === "state" ? n.cfg.vars.map((v) => ({ node: n.id, ...v })) : []));

export const readsOf = (n: ArchNode): string[] => (n.type === "component" || n.type === "function" ? n.cfg.reads : []);

export const writesOf = (n: ArchNode) => (n.type === "component" || n.type === "function" ? n.cfg.writes : []);

export const readersOf = (model: ArchModel, id: string): PlacedNode[] =>
  model.nodes.filter((n) => readsOf(n).includes(id));

export const writersOf = (model: ArchModel, id: string): PlacedNode[] =>
  model.nodes.filter((n) => writesOf(n).some((w) => w.varId === id));

const functionOrder = (a: FunctionNode, b: FunctionNode): number =>
  FN_TRIGGERS.indexOf(a.cfg.trigger) - FN_TRIGGERS.indexOf(b.cfg.trigger) || a.y - b.y || a.x - b.x;

export const attachedFns = (model: ArchModel, componentId: string): FunctionNode[] =>
  outE(model, componentId)
    .map((e) => node(model, e.to))
    .filter((n): n is FunctionNode => n?.type === "function")
    .sort(functionOrder);

export const reach = (model: ArchModel, id: string, direction: "fwd" | "bwd", types: NodeType[]): ArchNode[] => {
  const seen = new Set([id]);
  const queue = [id];
  const found: ArchNode[] = [];
  while (queue.length) {
    const current = queue.shift() as string;
    const edges = direction === "fwd" ? outE(model, current) : inE(model, current);
    for (const e of edges) {
      const nextId = direction === "fwd" ? e.to : e.from;
      if (seen.has(nextId)) continue;
      seen.add(nextId);
      const next = node(model, nextId);
      if (!next) continue;
      if (types.includes(next.type)) found.push(next);
      queue.push(nextId);
    }
  }
  return found;
};

export const tablesOf = (db: DbNode): TableLike[] => (db.type === "sqldb" ? db.cfg.tables : db.cfg.collections);

export const tblNames = (db: DbNode | undefined): string[] => (db ? tablesOf(db).map((t) => t.name) : []);

export const tbl = (db: DbNode | undefined, name: string): TableLike | undefined =>
  db ? tablesOf(db).find((t) => t.name === name) : undefined;

export const tblRows = (db: DbNode | undefined, name: string): Row[] => {
  const table = tbl(db, name);
  const rows = table ? pj(table.data, []) : [];
  return Array.isArray(rows) ? (rows as Row[]) : [];
};

export const colNames = (db: DbNode, tableName: string): string[] => {
  const table = tbl(db, tableName);
  if (!table) return [];
  if ("columns" in table) return table.columns.map((c) => c.name);
  const fieldNames = table.fields.map((f) => f.name);
  return fieldNames.length ? fieldNames : Object.keys(tblRows(db, tableName)[0] ?? {});
};

export const allRefs = (db: DbNode, tables: string[]): string[] =>
  tables.flatMap((t) => colNames(db, t).map((c) => (db.type === "sqldb" ? t + "." + c : c)));

export const isDbNode = (n: ArchNode | undefined): n is DbNode => n?.type === "sqldb" || n?.type === "nosql";

export const connectorDb = (model: ArchModel, connector: ConnectorNode): DbNode | undefined => {
  const db = node(model, connector.cfg.dbId);
  return isDbNode(db) ? db : undefined;
};

export const initConnector = (model: ArchModel, connector: ConnectorNode): void => {
  const db = connectorDb(model, connector);
  if (!db) return;
  const names = tblNames(db);
  const query = connector.cfg.q;
  query.tables = query.tables.filter((t) => names.includes(t));
  if (!query.tables.length && names.length) query.tables = [names[0]];
  query.joins = query.joins.filter((j) => query.tables.includes(j.table));
};

const repairConnector = (model: ArchModel, connector: ConnectorNode, ids: Set<string>): void => {
  if (connector.cfg.dbId && !ids.has(connector.cfg.dbId)) connector.cfg.dbId = "";
  if (!connector.cfg.dbId) {
    const db = reach(model, connector.id, "fwd", ["sqldb", "nosql"])[0];
    if (db) connector.cfg.dbId = db.id;
  }
  if (connector.cfg.dbId) initConnector(model, connector);
};

const dropDanglingStateRefs = (model: ArchModel): void => {
  const vars = new Set(allVars(model).map((v) => v.id));
  model.nodes.forEach((n) => {
    if (n.type !== "component" && n.type !== "function") return;
    n.cfg.reads = n.cfg.reads.filter((v) => vars.has(v));
    n.cfg.writes = n.cfg.writes.filter((w) => vars.has(w.varId));
  });
};

export const normalize = (model: ArchModel): void => {
  if (!model.lnodes || model.lnodes.length !== 3) model.lnodes = defaultLayerNodes();
  model.nodes.forEach((n) => {
    if (n.layer === undefined) n.layer = REG[n.type].layer ?? null;
    if (n.parent === undefined) n.parent = null;
  });
  const ids = new Set(model.nodes.map((n) => n.id));
  model.nodes.forEach((n) => {
    if (n.parent && (!ids.has(n.parent) || n.parent === n.id)) n.parent = null;
  });
  model.edges = model.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  dropDanglingStateRefs(model);
  model.nodes.forEach((n) => {
    if (n.type === "connector") repairConnector(model, n, ids);
  });
  model.groups = model.groups.filter((g) => model.nodes.some((n) => n.group === g.id));
  model.nodes.forEach((n) => {
    if (n.group && !model.groups.some((g) => g.id === n.group)) n.group = null;
  });
};

export const reparent = (model: ArchModel, n: ArchNode | undefined): void => {
  if (!n || n.type === "layer") return;
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const excluded = new Set(descendants(model, n.id));
  let best: PlacedNode | null = null;
  model.nodes.forEach((c) => {
    if (!isContainer(c) || c.id === n.id || c.layer !== n.layer || excluded.has(c.id)) return;
    const inside = cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h;
    if (inside && (!best || c.w * c.h < best.w * best.h)) best = c;
  });
  n.parent = best ? (best as PlacedNode).id : null;
};

export const switchConnectorDatabase = (model: ArchModel, connector: ConnectorNode): void => {
  const query = connector.cfg.q;
  query.tables = [];
  query.joins = [];
  query.where = [];
  query.select = [];
  query.group = [];
  query.aggs = [];
  query.nest = false;
  initConnector(model, connector);
  const db = connectorDb(model, connector);
  const alreadyWired = db && reach(model, connector.id, "fwd", ["sqldb", "nosql"]).some((d) => d.id === db.id);
  if (db && !alreadyWired) model.edges.push(mkEdge(connector.id, db.id));
};
