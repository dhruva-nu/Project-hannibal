import { litVal, short } from "./json";
import { allRefs, sourceDb, tbl, tblRows } from "./model";
import type {
  AggFn,
  ArchModel,
  QuerySource,
  ConnectorQuery,
  DbNode,
  FilterClause,
  FilterOp,
  Params,
  Row,
  SqlNode,
} from "./types";

export interface PlanColumn {
  field: string;
  table: string | null;
  col: string;
  key: string;
}

export interface QueryPlan {
  tabs: string[];
  cols: PlanColumn[];
  agg: boolean;
}

export interface QueryResult {
  rows: Row[];
  error?: string;
}

export interface BuiltQuery {
  sql: string;
  binds: { name: string; value: unknown }[];
}

type Comparable = string | number;

const hasOwn = (target: object, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key);

const looselyEqual = (a: unknown, b: unknown): boolean => a == b;

export const getF = (row: Row, field: string): unknown => {
  if (!field) return undefined;
  const parts = String(field).split(".");
  let current: unknown;
  if (hasOwn(row, parts[0])) {
    current = row[parts[0]];
    parts.shift();
  } else {
    const keys = Object.keys(row);
    current = keys.length === 1 ? row[keys[0]] : undefined;
  }
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Row)[part];
  }
  return current;
};

export const testOp = (a: unknown, op: FilterOp, b: unknown): boolean => {
  const left = a as Comparable;
  const right = b as Comparable;
  switch (op) {
    case "=":
      return looselyEqual(a, b);
    case "!=":
      return !looselyEqual(a, b);
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case "contains":
      return a !== null && a !== undefined && String(a).toLowerCase().includes(String(b).toLowerCase());
    case "in":
      return Array.isArray(b) && b.some((x) => looselyEqual(x, a));
  }
};

const valueText = (value: unknown): string => String(value === null || value === undefined ? "" : value);

export const bindVal = (value: unknown, params: Params): unknown => {
  const text = valueText(value);
  if (text[0] === ":") return params[text.slice(1)];
  return litVal(text);
};

export const splitField = (field: string, tables: string[]): [string, string] => {
  const parts = String(field).split(".");
  if (tables.includes(parts[0]) && parts.length > 1) return [parts[0], parts.slice(1).join(".")];
  return [tables[0], field];
};

export const aggFn = (fn: AggFn, values: unknown[]): number | null => {
  const numbers = values.filter((v) => v !== null && v !== undefined && !isNaN(Number(v))).map(Number);
  switch (fn) {
    case "count":
      return values.filter((v) => v !== null && v !== undefined).length;
    case "sum":
      return numbers.length ? numbers.reduce((a, b) => a + b, 0) : null;
    case "avg":
      return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
    case "min":
      return numbers.length ? Math.min(...numbers) : null;
    case "max":
      return numbers.length ? Math.max(...numbers) : null;
  }
};

const aggregateKey = (aggregation: { fn: AggFn; field: string; as: string }): string =>
  aggregation.as || aggregation.fn + "_" + short(aggregation.field || "all");

export const planCols = (model: ArchModel, source: QuerySource): QueryPlan => {
  const db = sourceDb(model, source);
  const query = source.q;
  if (!db) return { tabs: [], cols: [], agg: false };
  const tabs = query.tables.filter((t) => tbl(db, t));
  const agg = query.aggs.length > 0 || query.group.length > 0;
  if (agg) return { tabs, cols: aggregateColumns(query), agg: true };
  const selection = query.select.length ? query.select : allRefs(db, tabs).map((f) => ({ field: f, as: "" }));
  const duplicates: Record<string, number> = {};
  const parts = selection.map((s) => {
    const [table, col] = splitField(s.field, tabs);
    duplicates[col] = (duplicates[col] || 0) + 1;
    return { s, table, col };
  });
  return {
    tabs,
    agg: false,
    cols: parts.map((p) => ({
      field: p.s.field,
      table: p.table,
      col: p.s.as || p.col,
      key: p.s.as || (duplicates[p.col] > 1 ? p.table + "_" + p.col : p.col),
    })),
  };
};

const aggregateColumns = (query: ConnectorQuery): PlanColumn[] => [
  ...query.group.map((g) => ({ field: g, table: null, col: short(g), key: short(g) })),
  ...query.aggs.map((a) => ({ field: a.field, table: null, col: aggregateKey(a), key: aggregateKey(a) })),
];

const joinRows = (db: DbNode, query: ConnectorQuery, baseRows: Row[]): Row[] => {
  let rows = baseRows;
  for (const join of query.joins) {
    if (!tbl(db, join.table) || !join.left || !join.right) continue;
    const right = tblRows(db, join.table);
    const joined: Row[] = [];
    rows.forEach((left) => {
      const matches = right.filter((r) => {
        const merged = Object.assign({}, left, { [join.table]: r });
        return looselyEqual(getF(merged, join.left), getF(merged, join.right));
      });
      if (matches.length) matches.forEach((m) => joined.push(Object.assign({}, left, { [join.table]: m })));
      else if (join.type === "LEFT") joined.push(Object.assign({}, left, { [join.table]: null }));
    });
    rows = joined;
  }
  return rows;
};

const matchesFilters = (row: Row, filters: FilterClause[], params: Params): boolean =>
  filters.every((f) => testOp(getF(row, f.field), f.op, bindVal(f.value, params)));

const aggregateRows = (query: ConnectorQuery, rows: Row[]): Row[] => {
  const groups = new Map<string, Row[]>();
  rows.forEach((row) => {
    const key = JSON.stringify(query.group.map((g) => getF(row, g)));
    if (!groups.has(key)) groups.set(key, []);
    (groups.get(key) as Row[]).push(row);
  });
  if (!groups.size && !query.group.length) groups.set("", []);
  return [...groups.values()].map((groupRows) => {
    const out: Row = {};
    query.group.forEach((g) => {
      out[short(g)] = getF(groupRows[0], g);
    });
    query.aggs.forEach((a) => {
      out[aggregateKey(a)] = aggFn(
        a.fn,
        groupRows.map((r) => (a.field ? getF(r, a.field) : 1)),
      );
    });
    return out;
  });
};

const projectRows = (plan: QueryPlan, rows: Row[]): Row[] =>
  rows.map((row) => {
    const out: Row = {};
    plan.cols.forEach((c) => {
      const value = getF(row, c.field);
      out[c.key] = value === undefined ? null : value;
    });
    return out;
  });

export const runQuery = (model: ArchModel, source: QuerySource, params: Params): QueryResult => {
  const db = sourceDb(model, source);
  const query = source.q;
  if (!db) return { rows: [], error: "No database selected" };
  const plan = planCols(model, source);
  if (!plan.tabs.length) return { rows: [], error: "No table selected" };
  const base = plan.tabs[0];
  const joined = joinRows(
    db,
    query,
    tblRows(db, base).map((r) => ({ [base]: r })),
  );
  const filtered = joined.filter((r) => matchesFilters(r, query.where, params));
  let out = plan.agg ? aggregateRows(query, filtered) : projectRows(plan, filtered);
  const limit = parseInt(String(query.limit), 10);
  if (limit > 0) out = out.slice(0, limit);
  return { rows: out };
};

export const shapeRows = (model: ArchModel, source: QuerySource, flat: unknown): unknown => {
  const plan = planCols(model, source);
  if (!source.q.nest || plan.agg || plan.tabs.length < 2 || !Array.isArray(flat)) return flat;
  const base = plan.tabs[0];
  const others = plan.tabs.slice(1);
  const baseCols = plan.cols.filter((x) => x.table === base);
  const grouped = new Map<string, Row>();
  (flat as Row[]).forEach((row) => {
    const baseObject: Row = {};
    baseCols.forEach((x) => {
      baseObject[x.col] = row[x.key];
    });
    const key = JSON.stringify(baseObject);
    let item = grouped.get(key);
    if (!item) {
      item = Object.assign({}, baseObject);
      others.forEach((t) => {
        item![t] = [];
      });
      grouped.set(key, item);
    }
    others.forEach((t) => {
      const child: Row = {};
      let hasValue = false;
      plan.cols
        .filter((x) => x.table === t)
        .forEach((x) => {
          child[x.col] = row[x.key];
          if (row[x.key] !== null && row[x.key] !== undefined) hasValue = true;
        });
      if (hasValue) (item![t] as Row[]).push(child);
    });
  });
  return [...grouped.values()];
};

const SQL_OPERATORS: Record<FilterOp, string> = {
  "=": "=",
  "!=": "<>",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
  contains: "LIKE",
  in: "IN",
};

const MONGO_OPERATORS: Record<Exclude<FilterOp, "=">, string> = {
  "!=": "$ne",
  ">": "$gt",
  ">=": "$gte",
  "<": "$lt",
  "<=": "$lte",
  contains: "$regex",
  in: "$in",
};

const sqlLiteral = (value: unknown): string =>
  typeof value === "string" ? "'" + value.replace(/'/g, "''") + "'" : JSON.stringify(value);

const parsedLimit = (query: ConnectorQuery): number => parseInt(String(query.limit), 10);

const createValueRenderer = (isSql: boolean, params: Params, binds: BuiltQuery["binds"]) => (value: unknown) => {
  const text = valueText(value);
  if (text[0] === ":") {
    const name = text.slice(1);
    binds.push({ name, value: params[name] });
    return isSql ? "$" + binds.length : JSON.stringify(params[name] ?? null);
  }
  return isSql ? sqlLiteral(litVal(text)) : JSON.stringify(litVal(text));
};

type ValueRenderer = ReturnType<typeof createValueRenderer>;

const buildSql = (plan: QueryPlan, query: ConnectorQuery, render: ValueRenderer): string => {
  let selected: string;
  if (plan.agg) {
    const aggregates = query.aggs.map(
      (a) => a.fn.toUpperCase() + "(" + (a.field || "*") + ") AS " + aggregateKey(a),
    );
    selected = [...query.group, ...aggregates].join(", ");
  } else {
    selected =
      query.select.length
        ? query.select.map((s) => s.field + (s.as ? " AS " + s.as : "")).join(", ")
        : "*";
  }
  let text = "SELECT " + selected + "\nFROM " + query.tables[0];
  query.joins.forEach((j) => {
    if (j.left && j.right) text += "\n" + j.type + " JOIN " + j.table + " ON " + j.left + " = " + j.right;
  });
  if (query.where.length) {
    text +=
      "\nWHERE " +
      query.where
        .map(
          (f) =>
            f.field +
            " " +
            SQL_OPERATORS[f.op] +
            " " +
            (f.op === "contains" ? "'%' || " + render(f.value) + " || '%'" : render(f.value)),
        )
        .join("\n  AND ");
  }
  if (query.group.length) text += "\nGROUP BY " + query.group.join(", ");
  if (parsedLimit(query) > 0) text += "\nLIMIT " + parsedLimit(query);
  return text + ";";
};

const buildMongo = (plan: QueryPlan, query: ConnectorQuery, render: ValueRenderer): string => {
  const collection = query.tables[0];
  const filter: Record<string, unknown> = {};
  query.where.forEach((f) => {
    const value = JSON.parse(render(f.value));
    filter[f.field] = f.op === "=" ? value : { [MONGO_OPERATORS[f.op as Exclude<FilterOp, "=">]]: value };
  });
  if (plan.agg) {
    const id = query.group.length
      ? "{ " + query.group.map((g) => short(g) + ': "$' + g + '"').join(", ") + " }"
      : "null";
    const accumulators = query.aggs
      .map(
        (a) =>
          ", " +
          aggregateKey(a) +
          ": { $" +
          (a.fn === "count" ? "sum: 1" : a.fn + ': "$' + a.field + '"') +
          " }",
      )
      .join("");
    return (
      "db." +
      collection +
      ".aggregate([\n  { $match: " +
      JSON.stringify(filter) +
      " },\n  { $group: { _id: " +
      id +
      accumulators +
      " } }\n])"
    );
  }
  const projection: Record<string, number> = {};
  query.select.forEach((s) => {
    projection[s.field] = 1;
  });
  const hasProjection = query.select.length > 0;
  return (
    "db." +
    collection +
    ".find(" +
    JSON.stringify(filter) +
    (hasProjection ? ", " + JSON.stringify(projection) : "") +
    ")" +
    (parsedLimit(query) > 0 ? ".limit(" + parsedLimit(query) + ")" : "")
  );
};

export const buildQuery = (model: ArchModel, source: QuerySource, params: Params): BuiltQuery => {
  const db = sourceDb(model, source);
  const query = source.q;
  if (!db || !query.tables.length) return { sql: "-- choose a database and a table", binds: [] };
  const binds: BuiltQuery["binds"] = [];
  const isSql = db.type === "sqldb";
  const plan = planCols(model, source);
  const render = createValueRenderer(isSql, params, binds);
  const sql = isSql ? buildSql(plan, query, render) : buildMongo(plan, query, render);
  return { sql, binds };
};

export const paramsUsed = (source: QuerySource): string[] => {
  const used: string[] = [];
  source.q.where.forEach((f) => {
    const value = String(f.value || "");
    if (value[0] === ":" && !used.includes(value.slice(1))) used.push(value.slice(1));
  });
  return used;
};

export const schemaOf = (value: unknown): unknown => {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? [schemaOf(value[0])] : [];
  if (typeof value === "object") {
    const out: Row = {};
    Object.keys(value).forEach((k) => {
      out[k] = schemaOf((value as Row)[k]);
    });
    return out;
  }
  return typeof value;
};

export const autoJoin = (model: ArchModel, source: QuerySource): void => {
  const db = sourceDb(model, source);
  const query = source.q;
  if (!db || db.type !== "sqldb") return;
  const joins: ConnectorQuery["joins"] = [];
  query.tables.slice(1).forEach((tableName) => {
    const found = joinFromOwnForeignKey(db, query, tableName) ?? joinFromReferencingTable(db, query, tableName);
    if (found) joins.push(found);
  });
  query.joins = joins;
};

const joinFromOwnForeignKey = (db: SqlNode, query: ConnectorQuery, tableName: string) => {
  const table = db.cfg.tables.find((t) => t.name === tableName);
  for (const column of table?.columns ?? []) {
    if (!column.fk) continue;
    const foreignTable = column.fk.split(".")[0];
    if (foreignTable !== tableName && query.tables.includes(foreignTable)) {
      return { type: "LEFT" as const, table: tableName, left: column.fk, right: tableName + "." + column.name };
    }
  }
  return null;
};

const joinFromReferencingTable = (db: SqlNode, query: ConnectorQuery, tableName: string) => {
  for (const other of query.tables.filter((t) => t !== tableName)) {
    const otherTable = db.cfg.tables.find((t) => t.name === other);
    for (const column of otherTable?.columns ?? []) {
      if (column.fk && column.fk.split(".")[0] === tableName) {
        return { type: "LEFT" as const, table: tableName, left: other + "." + column.name, right: column.fk };
      }
    }
  }
  return null;
};

export const pruneQuery = (model: ArchModel, source: QuerySource): void => {
  const db = sourceDb(model, source);
  const query = source.q;
  if (!db) return;
  const refs = allRefs(db, query.tables);
  query.joins = query.joins.filter((j) => query.tables.includes(j.table));
  query.select = query.select.filter((s) => refs.includes(s.field));
  query.where = query.where.filter((w) => !w.field || refs.includes(w.field));
  query.group = query.group.filter((g) => refs.includes(g));
  query.aggs = query.aggs.filter((a) => !a.field || refs.includes(a.field));
  query.joins.forEach((j) => {
    if (!refs.includes(j.left)) j.left = "";
    if (!refs.includes(j.right)) j.right = "";
  });
  if (!query.joins.length && query.tables.length > 1) autoJoin(model, source);
};
