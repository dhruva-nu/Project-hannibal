import { parseLiteral, lastSegment } from "./json";
import { columnRefs, sourceDb, findTable, tableRows } from "./model";
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

export const readField = (row: Row, field: string): unknown => {
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

export const valueText = (value: unknown): string => String(value === null || value === undefined ? "" : value);

export const bindParameter = (value: unknown, params: Params): unknown => {
  const text = valueText(value);
  if (text[0] === ":") return params[text.slice(1)];
  return parseLiteral(text);
};

export const splitField = (field: string, tables: string[]): [string, string] => {
  const parts = String(field).split(".");
  if (tables.includes(parts[0]) && parts.length > 1) return [parts[0], parts.slice(1).join(".")];
  return [tables[0], field];
};

export const aggregate = (fn: AggFn, values: unknown[]): number | null => {
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

export const aggregateKey = (aggregation: { fn: AggFn; field: string; as: string }): string =>
  aggregation.as || aggregation.fn + "_" + lastSegment(aggregation.field || "all");

export const planColumns = (model: ArchModel, source: QuerySource): QueryPlan => {
  const db = sourceDb(model, source);
  const query = source.q;
  if (!db) return { tabs: [], cols: [], agg: false };
  const tabs = query.tables.filter((t) => findTable(db, t));
  const agg = query.aggs.length > 0 || query.group.length > 0;
  if (agg) return { tabs, cols: aggregateColumns(query), agg: true };
  const selection = query.select.length ? query.select : columnRefs(db, tabs).map((f) => ({ field: f, as: "" }));
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
  ...query.group.map((g) => ({ field: g, table: null, col: lastSegment(g), key: lastSegment(g) })),
  ...query.aggs.map((a) => ({ field: a.field, table: null, col: aggregateKey(a), key: aggregateKey(a) })),
];

const joinRows = (db: DbNode, query: ConnectorQuery, baseRows: Row[]): Row[] => {
  let rows = baseRows;
  for (const join of query.joins) {
    if (!findTable(db, join.table) || !join.left || !join.right) continue;
    const right = tableRows(db, join.table);
    const joined: Row[] = [];
    rows.forEach((left) => {
      const matches = right.filter((r) => {
        const merged = Object.assign({}, left, { [join.table]: r });
        return looselyEqual(readField(merged, join.left), readField(merged, join.right));
      });
      if (matches.length) matches.forEach((m) => joined.push(Object.assign({}, left, { [join.table]: m })));
      else if (join.type === "LEFT") joined.push(Object.assign({}, left, { [join.table]: null }));
    });
    rows = joined;
  }
  return rows;
};

const matchesFilters = (row: Row, filters: FilterClause[], params: Params): boolean =>
  filters.every((f) => testOp(readField(row, f.field), f.op, bindParameter(f.value, params)));

const aggregateRows = (query: ConnectorQuery, rows: Row[]): Row[] => {
  const groups = new Map<string, Row[]>();
  rows.forEach((row) => {
    const key = JSON.stringify(query.group.map((g) => readField(row, g)));
    if (!groups.has(key)) groups.set(key, []);
    (groups.get(key) as Row[]).push(row);
  });
  if (!groups.size && !query.group.length) groups.set("", []);
  return [...groups.values()].map((groupRows) => {
    const out: Row = {};
    query.group.forEach((g) => {
      out[lastSegment(g)] = readField(groupRows[0], g);
    });
    query.aggs.forEach((a) => {
      out[aggregateKey(a)] = aggregate(
        a.fn,
        groupRows.map((r) => (a.field ? readField(r, a.field) : 1)),
      );
    });
    return out;
  });
};

const projectRows = (plan: QueryPlan, rows: Row[]): Row[] =>
  rows.map((row) => {
    const out: Row = {};
    plan.cols.forEach((c) => {
      const value = readField(row, c.field);
      out[c.key] = value === undefined ? null : value;
    });
    return out;
  });

export const runQuery = (model: ArchModel, source: QuerySource, params: Params): QueryResult => {
  const db = sourceDb(model, source);
  const query = source.q;
  if (!db) return { rows: [], error: "No database selected" };
  const plan = planColumns(model, source);
  if (!plan.tabs.length) return { rows: [], error: "No table selected" };
  const base = plan.tabs[0];
  const joined = joinRows(
    db,
    query,
    tableRows(db, base).map((r) => ({ [base]: r })),
  );
  const filtered = joined.filter((r) => matchesFilters(r, query.where, params));
  let out = plan.agg ? aggregateRows(query, filtered) : projectRows(plan, filtered);
  const limit = parseInt(String(query.limit), 10);
  if (limit > 0) out = out.slice(0, limit);
  return { rows: out };
};

export const shapeRows = (model: ArchModel, source: QuerySource, flat: Row[]): Row[] => {
  const plan = planColumns(model, source);
  if (!source.q.nest || plan.agg || plan.tabs.length < 2) return flat;
  const base = plan.tabs[0];
  const others = plan.tabs.slice(1);
  const baseCols = plan.cols.filter((x) => x.table === base);
  const grouped = new Map<string, Row>();
  flat.forEach((row) => {
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
