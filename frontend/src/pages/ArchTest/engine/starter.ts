import { pj, pretty } from "./json";
import { DEFAULT_VIEW, mkEdge, mkNode, normalize, tblRows } from "./model";
import { emptyQuery, newEndpoint, newTable } from "./registry";
import type { ArchModel, Endpoint, NosqlField, SqlColumn, SqlNode, SqlTable, StateVar } from "./types";

const newModel = (name: string): ArchModel => {
  const view = { ...DEFAULT_VIEW };
  return { name, store: [], nodes: [], edges: [], groups: [], lnodes: [], view, views: { overview: view } };
};

const USER_EXAMPLE = { id: 1, name: "Ada Lovelace", email: "ada@example.com" };
const USER_WITH_ORDERS = { user: USER_EXAMPLE, orders: [{ id: 101, total: 42.5, status: "paid" }] };

const starterDatabase = (): SqlNode => {
  const users: SqlTable = {
    ...newTable("users"),
    columns: [
      { name: "id", type: "int", pk: true, fk: "" },
      { name: "name", type: "text", pk: false, fk: "" },
      { name: "email", type: "text", pk: false, fk: "" },
      { name: "created_at", type: "timestamp", pk: false, fk: "" },
    ],
    indexes: [{ name: "users_email_key", columns: "email", unique: true }],
    data: pretty([
      { id: 1, name: "Ada Lovelace", email: "ada@example.com", created_at: "2024-01-12T09:00:00Z" },
      { id: 2, name: "Grace Hopper", email: "grace@example.com", created_at: "2024-02-03T11:30:00Z" },
      { id: 3, name: "Alan Turing", email: "alan@example.com", created_at: "2024-03-21T15:45:00Z" },
    ]),
  };
  const orders: SqlTable = {
    ...newTable("orders"),
    columns: [
      { name: "id", type: "int", pk: true, fk: "" },
      { name: "user_id", type: "int", pk: false, fk: "users.id" },
      { name: "total", type: "numeric", pk: false, fk: "" },
      { name: "status", type: "text", pk: false, fk: "" },
    ],
    indexes: [{ name: "idx_orders_user_id", columns: "user_id", unique: false }],
    data: pretty([
      { id: 101, user_id: 1, total: 42.5, status: "paid" },
      { id: 102, user_id: 1, total: 19.99, status: "shipped" },
      { id: 103, user_id: 2, total: 88, status: "paid" },
    ]),
  };
  return mkNode("sqldb", 110, 60, {
    name: "app_db",
    w: 340,
    cfg: {
      engine: "PostgreSQL",
      tables: [users, orders],
      sps: [
        {
          name: "get_user_with_orders",
          params: "user_id int",
          body: "SELECT u.*, o.* FROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.id = user_id;",
          sample: "[]",
        },
      ],
    },
  }) as SqlNode;
};

const getUserEndpoint = (dbId: string): Endpoint =>
  newEndpoint({
    id: "ep_get_user",
    method: "GET",
    path: "/users/:id",
    headers: [{ k: "Authorization", v: "Bearer <token>" }],
    pathParams: [{ k: "id", type: "number" }],
    query: [{ k: "includeOrders", type: "boolean", required: false }],
    single: true,
    responseMap: pretty({ user: { id: "$.id", name: "$.name", email: "$.email" }, orders: "$.orders" }),
    responses: [
      { status: 200, desc: "OK", body: pretty(USER_WITH_ORDERS) },
      { status: 404, desc: "User not found", body: pretty({ error: "User not found" }) },
    ],
    dbId,
    sample: pretty({ id: 1 }),
    q: {
      ...emptyQuery(),
      tables: ["users", "orders"],
      joins: [{ type: "LEFT", table: "orders", left: "users.id", right: "orders.user_id" }],
      where: [{ field: "users.id", op: "=", value: ":id" }],
      select: ["users.id", "users.name", "users.email", "orders.id", "orders.total", "orders.status"].map(
        (field) => ({ field, as: "" }),
      ),
      nest: true,
    },
  });

const listUsersEndpoint = (dbId: string): Endpoint =>
  newEndpoint({
    id: "ep_list_users",
    method: "GET",
    path: "/users",
    pathParams: [],
    responses: [{ status: 200, desc: "OK", body: pretty([USER_EXAMPLE]) }],
    dbId,
    q: { ...emptyQuery(), tables: ["users"], select: ["users.id", "users.name"].map((field) => ({ field, as: "" })), limit: 20 },
  });

const createUserEndpoint = (): Endpoint =>
  newEndpoint({
    id: "ep_create_user",
    method: "POST",
    path: "/users",
    pathParams: [],
    body: pretty({ name: "", email: "" }),
    responses: [{ status: 201, desc: "Created", body: pretty(USER_EXAMPLE) }],
  });

export const starter = (): ArchModel => {
  const model = newModel("User profile example");
  model.store = [
    { id: "v_user", name: "currentUser", type: "object", init: "null" },
    { id: "v_orders", name: "orders", type: "array", init: "[]" },
  ];
  const localState: StateVar[] = [{ id: "v_loading", name: "isLoading", type: "boolean", init: "false" }];
  const component = mkNode("component", 120, 60, {
    name: "UserProfile",
    w: 300,
    cfg: {
      desc: "Shows a user and their recent orders",
      input: pretty(USER_WITH_ORDERS),
      output: pretty({ userId: 1 }),
      state: localState,
      reads: ["v_user", "v_orders"],
      writes: [],
    },
  });
  const database = starterDatabase();
  const service = mkNode("service", 120, 60, {
    name: "User service",
    w: 320,
    cfg: {
      framework: "FastAPI",
      endpoints: [getUserEndpoint(database.id), listUsersEndpoint(database.id), createUserEndpoint()],
    },
  });
  const fetchUser = mkNode("function", 140, 300, {
    name: "fetchUser",
    w: 260,
    cfg: {
      trigger: "On Load",
      endpoint: "ep_get_user",
      input: pretty({ userId: 1 }),
      output: "",
      reads: [],
      writes: [
        { varId: "v_user", from: "user" },
        { varId: "v_orders", from: "orders" },
      ],
    },
  });
  model.nodes.push(component, fetchUser, service, database);
  model.edges.push(
    mkEdge(component.id, fetchUser.id),
    mkEdge(fetchUser.id, service.id, [
      { from: "userId", to: "id", value: "" },
      { from: "", to: "includeOrders", value: "true" },
    ]),
    mkEdge(service.id, database.id),
  );
  normalize(model);
  return model;
};

export const blank = (): ArchModel => {
  const model = newModel("Untitled architecture");
  model.nodes.push(mkNode("component", 200, 100, { name: "Component" }));
  normalize(model);
  return model;
};

export const sampleVal = (column: SqlColumn, index: number): unknown => {
  const type = column.type;
  if (type === "int" || type === "bigint") return column.pk ? index : index * 10;
  if (type === "numeric") return index * 10.5;
  if (type === "boolean") return index % 2 === 1;
  if (type === "timestamp") return "2024-0" + index + "-01T10:00:00Z";
  if (type === "date") return "2024-0" + index + "-01";
  if (type === "uuid") return "00000000-0000-4000-8000-00000000000" + index;
  if (type === "json") return {};
  return column.name + "_" + index;
};

const SAMPLE_ROW_COUNT = 3;

export const genSampleRows = (db: SqlNode, table: SqlTable): string => {
  const rows = Array.from({ length: SAMPLE_ROW_COUNT }, (_, offset) => {
    const index = offset + 1;
    const row: Record<string, unknown> = {};
    table.columns.forEach((column) => {
      if (!column.fk) {
        row[column.name] = sampleVal(column, index);
        return;
      }
      const [parentTable, parentColumn] = column.fk.split(".");
      const parentRows = tblRows(db, parentTable);
      row[column.name] = parentRows.length ? parentRows[(index - 1) % parentRows.length][parentColumn] : index;
    });
    return row;
  });
  return pretty(rows);
};

const ISO_TIMESTAMP_PREFIX = /^\d{4}-\d\d-\d\dT/;

const inferFieldType = (key: string, value: unknown): string => {
  if (key === "_id") return "objectId";
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return "object";
  if (typeof value === "string" && ISO_TIMESTAMP_PREFIX.test(value)) return "date";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
};

export const inferFields = (documentsJson: string): NosqlField[] | null => {
  const documents = pj(documentsJson, []);
  const first = Array.isArray(documents) ? documents[0] : undefined;
  if (!first || typeof first !== "object") return null;
  return Object.keys(first).map((name) => ({ name, type: inferFieldType(name, (first as Record<string, unknown>)[name]) }));
};

export const pathParamKeys = (path: string): string[] => {
  const keys: string[] = [];
  for (const match of path.matchAll(/:(\w+)|\{(\w+)\}/g)) keys.push(match[1] || match[2]);
  return keys;
};
