export type LayerId = "client" | "backend" | "db";
export type Category = "client" | "backend" | "db" | "infra";

export type FnTrigger = "Initial Load" | "On Load" | "On Component Change" | "Polling" | "WebSocket";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type VarType = "string" | "number" | "boolean" | "object" | "array";
export type FilterOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "in";
export type AggFn = "count" | "sum" | "avg" | "min" | "max";
export type JoinType = "LEFT" | "INNER";

export type InfraBehaviour = "cache" | "lb" | "gateway" | "pass";
export type InfraType =
  | "redis"
  | "tanstack"
  | "cdn"
  | "lb"
  | "gateway"
  | "instance"
  | "docker"
  | "k8s"
  | "s3"
  | "queue"
  | "bus"
  | "other";
export type PlacedType =
  | "component"
  | "function"
  | "service"
  | "sqldb"
  | "nosql"
  | InfraType;
export type NodeType = PlacedType | "layer";
export type Behaviour = InfraBehaviour | "db" | "component" | "function" | "layer" | "service";

export type Json = unknown;
export type JsonObject = Record<string, unknown>;
export type Params = Record<string, unknown>;
export type Row = Record<string, unknown>;

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface WriteRef {
  varId: string;
  from: string;
}

export interface StateVar {
  id: string;
  name: string;
  type: VarType;
  init: string;
}

export interface KeyValue {
  k: string;
  v: string;
}

export interface TypedKey {
  k: string;
  type: VarType;
}

export interface QueryParam extends TypedKey {
  required: boolean;
}

export interface ApiResponse {
  status: number | "";
  desc: string;
  body: string;
}

export interface JoinClause {
  type: JoinType;
  table: string;
  left: string;
  right: string;
}

export interface FilterClause {
  field: string;
  op: FilterOp;
  value: string;
}

export interface Selection {
  field: string;
  as: string;
}

export interface Aggregation {
  fn: AggFn;
  field: string;
  as: string;
}

export interface ConnectorQuery {
  tables: string[];
  joins: JoinClause[];
  where: FilterClause[];
  select: Selection[];
  group: string[];
  aggs: Aggregation[];
  nest: boolean;
  limit: number | string;
}

export interface SqlColumn {
  name: string;
  type: string;
  pk: boolean;
  fk: string;
}

export interface IndexDef {
  name: string;
  columns: string;
  unique: boolean;
}

export interface SqlTable {
  name: string;
  columns: SqlColumn[];
  indexes: IndexDef[];
  data: string;
}

export interface NosqlField {
  name: string;
  type: string;
}

export interface NosqlCollection {
  name: string;
  fields: NosqlField[];
  indexes: IndexDef[];
  data: string;
}

export interface StoredProcedure {
  name: string;
  params: string;
  body: string;
  sample: string;
}

export interface ComponentCfg {
  desc: string;
  input: string;
  output: string;
  state: StateVar[];
  reads: string[];
  writes: WriteRef[];
}

export interface FunctionCfg {
  trigger: FnTrigger;
  interval: number | "";
  deps: string;
  url: string;
  endpoint: string;
  input: string;
  output: string;
  reads: string[];
  writes: WriteRef[];
}

export type EmptyCfg = Record<string, never>;

export interface QuerySource {
  dbId: string;
  q: ConnectorQuery;
}

export type AppStepKind =
  | "db-read"
  | "db-write"
  | "s3-get"
  | "s3-put"
  | "redis-get"
  | "redis-set"
  | "http-call"
  | "custom";

/** One action inside an in-app service, e.g. "fetch object from S3". */
export interface AppStep {
  id: string;
  kind: AppStepKind;
  /** What the step touches: a table, bucket/key, cache key or URL. */
  target: string;
  detail: string;
}

/** A reusable backend function an endpoint can call, built from ordered steps. */
export interface AppService {
  id: string;
  name: string;
  steps: AppStep[];
}

/** One link in an endpoint's ordered call chain: its own DB query or an in-app service. */
export interface EndpointCall {
  id: string;
  kind: "query" | "appService";
  /** Only meaningful when kind is "appService". */
  appServiceId: string;
}

export interface Endpoint extends QuerySource {
  id: string;
  method: HttpMethod;
  path: string;
  headers: KeyValue[];
  pathParams: TypedKey[];
  query: QueryParam[];
  body: string;
  responses: ApiResponse[];
  single: boolean;
  responseMap: string;
  sample: string;
  calls: EndpointCall[];
}

export interface ServiceCfg {
  framework: string;
  endpoints: Endpoint[];
  appServices: AppService[];
}

export interface SqlCfg {
  engine: string;
  tables: SqlTable[];
  sps: StoredProcedure[];
}

export interface NosqlCfg {
  engine: string;
  collections: NosqlCollection[];
}

export type InfraCfg = Record<string, string | number>;

interface NodeBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  group: string | null;
  parent: string | null;
  layer: LayerId | null;
}

export interface ComponentNode extends NodeBase {
  type: "component";
  cfg: ComponentCfg;
}
export interface FunctionNode extends NodeBase {
  type: "function";
  cfg: FunctionCfg;
}
export interface ServiceNode extends NodeBase {
  type: "service";
  cfg: ServiceCfg;
}
export interface SqlNode extends NodeBase {
  type: "sqldb";
  cfg: SqlCfg;
}
export interface NosqlNode extends NodeBase {
  type: "nosql";
  cfg: NosqlCfg;
}
export interface InfraNode extends NodeBase {
  type: InfraType;
  cfg: InfraCfg;
}
export interface LayerNode extends NodeBase {
  type: "layer";
  lid: LayerId;
  cfg: EmptyCfg;
}

export type DbNode = SqlNode | NosqlNode;
export type PlacedNode =
  | ComponentNode
  | FunctionNode
  | ServiceNode
  | SqlNode
  | NosqlNode
  | InfraNode;
export type ArchNode = PlacedNode | LayerNode;
export type SidebarNode = ComponentNode | FunctionNode | InfraNode;
export type TableLike = SqlTable | NosqlCollection;

export interface MapRow {
  from: string;
  to: string;
  value: string;
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  map: MapRow[];
  derived?: false;
}

export interface DerivedEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  map: MapRow[];
  derived: true;
  ids: string[];
}

export type AnyEdge = ArchEdge | DerivedEdge;

export interface EdgeLike {
  id: string | null;
  from: string;
  to: string;
  map: MapRow[];
}

export interface Group {
  id: string;
  name: string;
}

export interface ArchModel {
  name: string;
  store: StateVar[];
  nodes: PlacedNode[];
  edges: ArchEdge[];
  groups: Group[];
  lnodes: LayerNode[];
  view: View;
  views: Record<string, View>;
}

export interface Snapshot {
  name: string;
  store?: StateVar[];
  nodes: PlacedNode[];
  edges: ArchEdge[];
  groups: Group[];
  lnodes?: LayerNode[];
}

export type * from "./traceTypes";
export type * from "./registryTypes";
