import { newQueryCall } from "./appServices";
import { parseJsonOr, uid } from "./json";
import { FN_TRIGGERS, NODE_REGISTRY, isContainer } from "./registry";
import type {
  ArchEdge,
  ArchModel,
  ArchNode,
  DbNode,
  Endpoint,
  FunctionNode,
  Group,
  LayerId,
  LayerNode,
  MapRow,
  NodeType,
  PlacedNode,
  SidebarNode,
  PlacedType,
  QuerySource,
  Row,
  ServiceNode,
  StateVarRef,
  TableLike,
} from "./types";
import { fittedHeight } from "./cardHeight";

export { isContainer };

export const DEFAULT_VIEW = { x: 60, y: 40, k: 0.8 };
const LAYER_NODE_X = 280;
const LAYER_NODE_WIDTH = 560;
const LAYER_NODE_HEIGHT = 110;

export const findNode = (model: ArchModel, id: string): ArchNode | undefined =>
  model.lnodes.find((n) => n.id === id) ?? model.nodes.find((n) => n.id === id);

export const requireNode = (model: ArchModel, id: string): ArchNode => {
  const node = findNode(model, id);
  if (!node) throw new Error(`Node "${id}" is not in the diagram`);
  return node;
};

export const findPlacedNode = (model: ArchModel, id: string): PlacedNode | undefined =>
  model.nodes.find((n) => n.id === id);

export const outgoingEdges = (model: ArchModel, id: string): ArchEdge[] => model.edges.filter((e) => e.from === id);
export const incomingEdges = (model: ArchModel, id: string): ArchEdge[] => model.edges.filter((e) => e.to === id);
export const findGroup = (model: ArchModel, id: string): Group | undefined => model.groups.find((g) => g.id === id);

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
      ["backend", "Backend layer", 250],
      ["db", "Database layer", 460],
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

export type PlacedNodeOfType<T extends PlacedType> = PlacedNode & { type: T };

export const createNode = <T extends PlacedType>(type: T, x: number, y: number, options: MakeNodeOptions = {}): PlacedNodeOfType<T> => {
  const entry = NODE_REGISTRY[type];
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
  } as PlacedNodeOfType<T>;
};

export const createEdge = (from: string, to: string, map: MapRow[] = []): ArchEdge => ({
  id: uid("e"),
  from,
  to,
  label: "",
  map,
});

/** Throws for node types this version no longer understands (e.g. the old api / connector / state boxes). */
export const assertKnownNodeTypes = (nodes: Array<{ type: string }>): void => {
  const unknown = nodes.find((n) => n.type === "layer" || !(n.type in NODE_REGISTRY));
  if (unknown) throw new Error('unknown node type "' + unknown.type + '"');
};

export const uniqueName = (model: ArchModel, base: string): string => {
  let counter = 1;
  let name = base;
  while (model.nodes.some((n) => n.name === name)) {
    counter++;
    name = base + " " + counter;
  }
  return name;
};

export const allVars = (model: ArchModel): StateVarRef[] => [
  ...model.store.map((v) => ({ ...v, owner: null })),
  ...model.nodes.flatMap((n) => (n.type === "component" ? n.cfg.state.map((v) => ({ ...v, owner: n.id })) : [])),
];

/** Variables a component or function may read or write: the app store plus the owning component's local state. */
export const visibleVarsFor = (model: ArchModel, n: ArchNode): StateVarRef[] => {
  const owners = new Set(
    n.type === "function" ? incomingEdges(model, n.id).map((e) => e.from) : n.type === "component" ? [n.id] : [],
  );
  return allVars(model).filter((v) => v.owner === null || owners.has(v.owner));
};

export const varById = (model: ArchModel, id: string): StateVarRef | undefined =>
  allVars(model).find((v) => v.id === id);

export interface EndpointRef {
  service: ServiceNode;
  endpoint: Endpoint;
}

export const allEndpoints = (model: ArchModel): EndpointRef[] =>
  model.nodes.flatMap((n) => (n.type === "service" ? n.cfg.endpoints.map((endpoint) => ({ service: n, endpoint })) : []));

export const endpointById = (model: ArchModel, id: string): EndpointRef | undefined =>
  allEndpoints(model).find((ref) => ref.endpoint.id === id);

export const endpointLabel = (endpoint: Endpoint): string => endpoint.method + " " + endpoint.path;

export const callersOf = (model: ArchModel, endpointId: string): FunctionNode[] =>
  model.nodes.filter((n): n is FunctionNode => n.type === "function" && n.cfg.endpoint === endpointId);

export const readsOf = (n: ArchNode): string[] => (n.type === "component" || n.type === "function" ? n.cfg.reads : []);

export const writesOf = (n: ArchNode) => (n.type === "component" || n.type === "function" ? n.cfg.writes : []);

export const readersOf = (model: ArchModel, id: string): PlacedNode[] =>
  model.nodes.filter((n) => readsOf(n).includes(id));

export const writersOf = (model: ArchModel, id: string): PlacedNode[] =>
  model.nodes.filter((n) => writesOf(n).some((w) => w.varId === id));

const functionOrder = (a: FunctionNode, b: FunctionNode): number =>
  FN_TRIGGERS.indexOf(a.cfg.trigger) - FN_TRIGGERS.indexOf(b.cfg.trigger) || a.y - b.y || a.x - b.x;

export const attachedFunctions = (model: ArchModel, componentId: string): FunctionNode[] =>
  outgoingEdges(model, componentId)
    .map((e) => findNode(model, e.to))
    .filter((n): n is FunctionNode => n?.type === "function")
    .sort(functionOrder);

export const reachableNodes = (model: ArchModel, id: string, direction: "fwd" | "bwd", types: NodeType[]): ArchNode[] => {
  const seen = new Set([id]);
  const queue = [id];
  const found: ArchNode[] = [];
  while (queue.length) {
    const current = queue.shift() as string;
    const edges = direction === "fwd" ? outgoingEdges(model, current) : incomingEdges(model, current);
    for (const e of edges) {
      const nextId = direction === "fwd" ? e.to : e.from;
      if (seen.has(nextId)) continue;
      seen.add(nextId);
      const next = findNode(model, nextId);
      if (!next) continue;
      if (types.includes(next.type)) found.push(next);
      queue.push(nextId);
    }
  }
  return found;
};

export const tablesOf = (db: DbNode): TableLike[] => (db.type === "sqldb" ? db.cfg.tables : db.cfg.collections);

export const tableNames = (db: DbNode | undefined): string[] => (db ? tablesOf(db).map((t) => t.name) : []);

export const findTable = (db: DbNode | undefined, name: string): TableLike | undefined =>
  db ? tablesOf(db).find((t) => t.name === name) : undefined;

export const tableRows = (db: DbNode | undefined, name: string): Row[] => {
  const table = findTable(db, name);
  const rows = table ? parseJsonOr(table.data, []) : [];
  return Array.isArray(rows) ? (rows as Row[]) : [];
};

export const columnNames = (db: DbNode, tableName: string): string[] => {
  const table = findTable(db, tableName);
  if (!table) return [];
  if ("columns" in table) return table.columns.map((c) => c.name);
  const fieldNames = table.fields.map((f) => f.name);
  return fieldNames.length ? fieldNames : Object.keys(tableRows(db, tableName)[0] ?? {});
};

export const columnRefs = (db: DbNode, tables: string[]): string[] =>
  tables.flatMap((t) => columnNames(db, t).map((c) => (db.type === "sqldb" ? t + "." + c : c)));

export const isSidebarNode = (n: ArchNode | undefined): n is SidebarNode =>
  n !== undefined && n.type !== "layer" && n.type !== "service" && !isDbNode(n);

export const isDbNode = (n: ArchNode | undefined): n is DbNode => n?.type === "sqldb" || n?.type === "nosql";

export const sourceDb = (model: ArchModel, source: QuerySource): DbNode | undefined => {
  const db = findNode(model, source.dbId);
  return isDbNode(db) ? db : undefined;
};

export const initQuerySource = (model: ArchModel, source: QuerySource): void => {
  const db = sourceDb(model, source);
  if (!db) return;
  const names = tableNames(db);
  const query = source.q;
  query.tables = query.tables.filter((t) => names.includes(t));
  if (!query.tables.length && names.length) query.tables = [names[0]];
  query.joins = query.joins.filter((j) => query.tables.includes(j.table));
};

const repairEndpoints = (model: ArchModel, service: ServiceNode, ids: Set<string>): void => {
  service.cfg.endpoints.forEach((endpoint) => {
    if (endpoint.dbId && !ids.has(endpoint.dbId)) endpoint.dbId = "";
    if (endpoint.dbId) initQuerySource(model, endpoint);
  });
};

const repairAppServices = (service: ServiceNode): void => {
  if (!Array.isArray(service.cfg.appServices)) service.cfg.appServices = [];
  const known = new Set(service.cfg.appServices.map((a) => a.id));
  service.cfg.endpoints.forEach((endpoint) => {
    if (!Array.isArray(endpoint.calls)) endpoint.calls = [newQueryCall()];
    endpoint.calls = endpoint.calls.filter((c) => c.kind === "query" || known.has(c.appServiceId));
  });
};

const dropDanglingEndpointCalls = (model: ArchModel): void => {
  const endpoints = new Set(allEndpoints(model).map((ref) => ref.endpoint.id));
  model.nodes.forEach((n) => {
    if (n.type !== "function") return;
    if (n.cfg.endpoint === undefined || !endpoints.has(n.cfg.endpoint)) n.cfg.endpoint = "";
  });
};

const backfillStateFields = (model: ArchModel): void => {
  if (!Array.isArray(model.store)) model.store = [];
  model.nodes.forEach((n) => {
    if (n.type === "component" && !Array.isArray(n.cfg.state)) n.cfg.state = [];
  });
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
  backfillStateFields(model);
  model.nodes.forEach((n) => {
    if (n.layer === undefined) n.layer = NODE_REGISTRY[n.type].layer ?? null;
    if (n.parent === undefined) n.parent = null;
  });
  const ids = new Set(model.nodes.map((n) => n.id));
  model.nodes.forEach((n) => {
    if (n.parent && (!ids.has(n.parent) || n.parent === n.id)) n.parent = null;
  });
  model.edges = model.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  dropDanglingStateRefs(model);
  dropDanglingEndpointCalls(model);
  model.nodes.forEach((n) => {
    if (n.type !== "service") return;
    repairAppServices(n);
    repairEndpoints(model, n, ids);
  });
  model.nodes.forEach((n) => {
    n.h = fittedHeight(n) ?? n.h;
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

export const switchEndpointDatabase = (model: ArchModel, service: ServiceNode, endpoint: Endpoint): void => {
  endpoint.q = { tables: [], joins: [], where: [], select: [], group: [], aggs: [], nest: false, limit: endpoint.q.limit };
  initQuerySource(model, endpoint);
  const db = sourceDb(model, endpoint);
  const alreadyWired = db && reachableNodes(model, service.id, "fwd", ["sqldb", "nosql"]).some((d) => d.id === db.id);
  if (db && !alreadyWired) model.edges.push(createEdge(service.id, db.id));
};
