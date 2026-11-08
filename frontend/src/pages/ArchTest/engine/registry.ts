import { pretty } from "./json";
import type {
  ArchNode,
  Behaviour,
  FnTrigger,
  HttpMethod,
  InfraBehaviour,
  InfraCfg,
  InfraField,
  InfraType,
  LayerDef,
  NodeType,
  NosqlCollection,
  RegEntry,
  SqlTable,
  VarType,
  FilterOp,
} from "./types";

export const FN_TRIGGERS: readonly FnTrigger[] = [
  "Initial Load",
  "On Load",
  "On Component Change",
  "Polling",
  "WebSocket",
];
export const SQL_TYPES: readonly string[] = [
  "int",
  "bigint",
  "text",
  "varchar",
  "boolean",
  "numeric",
  "timestamp",
  "date",
  "uuid",
  "json",
];
export const NOSQL_TYPES: readonly string[] = ["string", "number", "boolean", "date", "objectId", "array", "object"];
export const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
export const VAR_TYPES: readonly VarType[] = ["string", "number", "boolean", "object", "array"];
export const OPS: readonly FilterOp[] = ["=", "!=", ">", ">=", "<", "<=", "contains", "in"];
export const LAYERS: readonly LayerDef[] = [
  { id: "client", label: "Client layer", y: 0, h: 520 },
  { id: "backend", label: "Backend layer", y: 560, h: 520 },
  { id: "db", label: "Database layer", y: 1120, h: 560 },
];

const INFRA_DEFAULT_WIDTH = 190;
const INFRA_DEFAULT_HEIGHT = 84;

const infra = (
  label: string,
  beh: InfraBehaviour,
  fields: InfraField[],
  sum: (cfg: InfraCfg) => string,
  w?: number,
  h?: number,
  container?: boolean,
): RegEntry => ({
  label,
  cat: "infra",
  beh,
  container: !!container,
  w: w || INFRA_DEFAULT_WIDTH,
  h: h || INFRA_DEFAULT_HEIGHT,
  fields,
  sum,
  def: () => Object.fromEntries(fields.map((field) => [field.k, field.def])),
});

const CACHE_BEHAVIOUR_FIELD: InfraField = {
  k: "behavior",
  label: "Simulated cache behavior",
  t: "select",
  opts: ["auto", "always hit", "always miss"],
  def: "auto",
};

export const newTable = (name: string): SqlTable => ({
  name,
  columns: [
    { name: "id", type: "int", pk: true, fk: "" },
    { name: "name", type: "text", pk: false, fk: "" },
  ],
  indexes: [],
  data: pretty([
    { id: 1, name: name + "_1" },
    { id: 2, name: name + "_2" },
  ]),
});

export const newCollection = (name: string): NosqlCollection => ({
  name,
  fields: [
    { name: "_id", type: "objectId" },
    { name: "name", type: "string" },
  ],
  indexes: [{ name: "name_1", columns: "name", unique: false }],
  data: pretty([
    { _id: "64a1", name: "first" },
    { _id: "64a2", name: "second" },
  ]),
});

export const REG: Record<NodeType, RegEntry> = {
  component: {
    label: "Component",
    cat: "client",
    layer: "client",
    w: 270,
    h: 140,
    def: () => ({
      desc: "Describe the data this component expects",
      input: "{\n  \n}",
      output: "{\n  \n}",
      reads: [],
      writes: [],
    }),
  },
  function: {
    label: "Function",
    cat: "client",
    layer: "client",
    w: 230,
    h: 92,
    def: () => ({
      trigger: "On Load",
      interval: 5000,
      deps: "",
      url: "wss://example.com/stream",
      input: "",
      output: "",
      reads: [],
      writes: [],
    }),
  },
  state: { label: "State viewer", cat: "client", layer: "client", w: 250, h: 170, def: () => ({ vars: [] }) },
  layer: { label: "Layer", cat: "client", w: 440, h: 160, def: () => ({}) as Record<string, never> },
  api: {
    label: "REST API",
    cat: "backend",
    layer: "backend",
    w: 260,
    h: 112,
    def: () => ({
      method: "GET",
      path: "/resource/:id",
      headers: [],
      pathParams: [{ k: "id", type: "number" }],
      query: [],
      body: "",
      responses: [{ status: 200, desc: "OK", body: '{\n  "ok": true\n}' }],
      single: false,
      responseMap: "",
    }),
  },
  connector: {
    label: "Data connector",
    cat: "backend",
    layer: "backend",
    w: 260,
    h: 130,
    def: () => ({
      dbId: "",
      q: { tables: [], joins: [], where: [], select: [], group: [], aggs: [], nest: false, limit: "" },
      sample: "{}",
    }),
  },
  sqldb: {
    label: "SQL database",
    cat: "db",
    layer: "db",
    w: 340,
    h: 260,
    def: () => ({ engine: "PostgreSQL", tables: [newTable("items")], sps: [] }),
  },
  nosql: {
    label: "NoSQL database",
    cat: "db",
    layer: "db",
    w: 320,
    h: 220,
    def: () => ({ engine: "MongoDB", collections: [newCollection("documents")] }),
  },
  redis: infra(
    "Redis cache",
    "cache",
    [
      { k: "ttl", label: "TTL (seconds)", t: "number", def: 60 },
      { k: "keyPattern", label: "Key pattern", t: "text", def: "cache:{request}" },
      CACHE_BEHAVIOUR_FIELD,
    ],
    (c) => "TTL " + c.ttl + "s, " + c.behavior,
  ),
  tanstack: infra(
    "TanStack Query",
    "cache",
    [
      { k: "queryKey", label: "Query key", t: "text", def: '["resource"]' },
      { k: "staleTime", label: "Stale time (ms)", t: "number", def: 30000 },
      { k: "gcTime", label: "GC time (ms)", t: "number", def: 300000 },
      CACHE_BEHAVIOUR_FIELD,
    ],
    (c) => "key " + c.queryKey + ", " + c.behavior,
  ),
  cdn: infra(
    "CDN",
    "cache",
    [
      { k: "origin", label: "Origin", t: "text", def: "https://origin.example.com" },
      { k: "ttl", label: "Edge TTL (seconds)", t: "number", def: 300 },
      CACHE_BEHAVIOUR_FIELD,
    ],
    (c) => "TTL " + c.ttl + "s, " + c.behavior,
  ),
  lb: infra(
    "Load balancer",
    "lb",
    [
      {
        k: "algorithm",
        label: "Algorithm",
        t: "select",
        opts: ["round robin", "random", "least connections"],
        def: "round robin",
      },
      { k: "health", label: "Health check path", t: "text", def: "/health" },
    ],
    (c) => String(c.algorithm),
  ),
  gateway: infra(
    "API gateway",
    "gateway",
    [
      { k: "auth", label: "Authentication", t: "select", opts: ["none", "JWT", "API key"], def: "JWT" },
      { k: "rate", label: "Rate limit (requests per minute)", t: "number", def: 600 },
      { k: "headers", label: "Adds headers", t: "text", def: "X-Request-Id" },
    ],
    (c) => "auth " + c.auth + ", " + c.rate + "/min",
  ),
  instance: infra(
    "Backend instance",
    "pass",
    [
      { k: "image", label: "Image", t: "text", def: "api:latest" },
      { k: "port", label: "Port", t: "number", def: 8080 },
    ],
    (c) => c.image + " on :" + c.port,
  ),
  docker: infra(
    "Docker container",
    "pass",
    [
      { k: "image", label: "Image", t: "text", def: "app:latest" },
      { k: "port", label: "Port", t: "number", def: 8080 },
    ],
    (c) => String(c.image),
    460,
    300,
    true,
  ),
  k8s: infra(
    "Kubernetes",
    "pass",
    [
      { k: "namespace", label: "Namespace", t: "text", def: "default" },
      { k: "replicas", label: "Replicas", t: "number", def: 3 },
      { k: "autoscale", label: "Autoscaling", t: "select", opts: ["off", "on"], def: "off" },
    ],
    (c) => c.replicas + " replicas in " + c.namespace,
    620,
    400,
    true,
  ),
  s3: infra(
    "Object storage (S3)",
    "pass",
    [
      { k: "bucket", label: "Bucket", t: "text", def: "my-bucket" },
      { k: "region", label: "Region", t: "text", def: "ap-south-1" },
      { k: "access", label: "Access", t: "select", opts: ["private", "public-read"], def: "private" },
    ],
    (c) => "bucket " + c.bucket,
  ),
  queue: infra(
    "Message queue",
    "pass",
    [
      { k: "broker", label: "Broker", t: "select", opts: ["SQS", "RabbitMQ", "Kafka"], def: "SQS" },
      { k: "queueName", label: "Queue name", t: "text", def: "jobs" },
      { k: "retention", label: "Retention (hours)", t: "number", def: 24 },
    ],
    (c) => c.broker + ": " + c.queueName,
  ),
  bus: infra(
    "Event bus",
    "pass",
    [
      { k: "busName", label: "Bus name", t: "text", def: "events" },
      { k: "topics", label: "Topics", t: "text", def: "order.created, user.updated" },
    ],
    (c) => String(c.topics),
  ),
  other: infra(
    "Custom infrastructure",
    "pass",
    [
      { k: "kind", label: "Kind", t: "text", def: "Service" },
      { k: "notes", label: "Notes", t: "text", def: "" },
    ],
    (c) => String(c.kind),
  ),
};

export const INFRA_KEYS = (Object.keys(REG) as NodeType[]).filter((key) => REG[key].cat === "infra") as InfraType[];

export const behOf = (node: ArchNode): Behaviour =>
  node.type === "sqldb" || node.type === "nosql" ? "db" : (REG[node.type].beh ?? (node.type as Behaviour));

export const isContainer = (node: ArchNode | null | undefined): boolean =>
  !!node && !!REG[node.type]?.container;
