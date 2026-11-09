import { lastSegment, parseLiteral } from "./json";
import { sourceDb } from "./model";
import { aggregateKey, planColumns, valueText, type BuiltQuery, type QueryPlan } from "./query";
import type { ArchModel, ConnectorQuery, FilterOp, Params, QuerySource } from "./types";

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
  return isSql ? sqlLiteral(parseLiteral(text)) : JSON.stringify(parseLiteral(text));
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
      ? "{ " + query.group.map((g) => lastSegment(g) + ': "$' + g + '"').join(", ") + " }"
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
  const plan = planColumns(model, source);
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

