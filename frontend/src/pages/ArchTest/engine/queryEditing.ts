import { columnRefs, sourceDb } from "./model";
import type { ArchModel, ConnectorQuery, QuerySource, SqlNode } from "./types";

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
  const refs = columnRefs(db, query.tables);
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
