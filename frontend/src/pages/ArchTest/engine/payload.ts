import { clone, delPath, getPath, isObject, litVal, pj, sampleOf, setPath, tOf } from "./json";
import { paramsUsed } from "./query";
import type { ArchNode, JsonObject, MapRow, PayloadDiff, SchemaWarning } from "./types";

const MAX_FLATTEN_DEPTH = 6;
const MAX_FLATTENED_ARRAY_ITEMS = 3;
const MAX_LABEL_KEYS = 3;

export const ANY_VALUE = "__any__";

export const applyEdge = (edge: { map: MapRow[] } | null | undefined, payload: unknown): unknown => {
  const mappings = edge?.map ?? [];
  if (!mappings.length || payload === null || payload === undefined || typeof payload !== "object") return payload;
  const out = clone(payload);
  mappings.forEach((row) => {
    if (!row.to) return;
    if (row.from) {
      const moved = getPath(out, row.from);
      delPath(out, row.from);
      setPath(out, row.to, moved);
    } else {
      setPath(out, row.to, litVal(row.value));
    }
  });
  return out;
};

export const applyMap = (template: unknown, root: unknown, named: Record<string, unknown>): unknown => {
  if (typeof template === "string" && template[0] === "$") {
    const match = /^\$([A-Za-z0-9_]*)\.?([\s\S]*)$/.exec(template) as RegExpExecArray;
    const base = match[1] ? named[match[1]] : root;
    return match[2] ? getPath(base, match[2]) : base;
  }
  if (Array.isArray(template)) return template.map((item) => applyMap(item, root, named));
  if (template && typeof template === "object") {
    const out: JsonObject = {};
    Object.keys(template).forEach((key) => {
      out[key] = applyMap((template as JsonObject)[key], root, named);
    });
    return out;
  }
  return template;
};

export const flat = (
  value: unknown,
  path = "",
  out: Record<string, unknown> = {},
  depth = 0,
): Record<string, unknown> => {
  if (value && typeof value === "object" && depth < MAX_FLATTEN_DEPTH) {
    if (Array.isArray(value)) {
      if (!value.length) out[path || "[]"] = "[]";
      value
        .slice(0, MAX_FLATTENED_ARRAY_ITEMS)
        .forEach((item, i) => flat(item, path + "[" + i + "]", out, depth + 1));
    } else {
      const keys = Object.keys(value);
      if (!keys.length) out[path || "{}"] = "{}";
      keys.forEach((k) => flat((value as JsonObject)[k], path ? path + "." + k : k, out, depth + 1));
    }
  } else {
    out[path || "(value)"] = value;
  }
  return out;
};

export const diffPayload = (before: unknown, after: unknown): PayloadDiff[] => {
  const flatBefore = flat(before);
  const flatAfter = flat(after);
  const diffs: PayloadDiff[] = [];
  Object.keys(flatAfter).forEach((k) => {
    if (!(k in flatBefore)) diffs.push({ k, t: "add", to: flatAfter[k] });
    else if (JSON.stringify(flatBefore[k]) !== JSON.stringify(flatAfter[k]))
      diffs.push({ k, t: "chg", from: flatBefore[k], to: flatAfter[k] });
  });
  Object.keys(flatBefore).forEach((k) => {
    if (!(k in flatAfter)) diffs.push({ k, t: "rem", from: flatBefore[k] });
  });
  return diffs;
};

export const shapeDiff = (expected: unknown, actual: unknown, path = "", out: SchemaWarning[] = []): SchemaWarning[] => {
  if (expected === undefined || expected === null || expected === ANY_VALUE) return out;
  if (actual === undefined) {
    out.push({ path: path || "(root)", kind: "missing", exp: tOf(expected) });
    return out;
  }
  if (actual === null) return out;
  const expectedType = tOf(expected);
  const actualType = tOf(actual);
  if (expectedType !== actualType) {
    out.push({ path: path || "(root)", kind: "type", exp: expectedType, act: actualType });
    return out;
  }
  if (expectedType === "object") {
    Object.keys(expected as JsonObject).forEach((k) =>
      shapeDiff((expected as JsonObject)[k], (actual as JsonObject)[k], path ? path + "." + k : k, out),
    );
  } else if (expectedType === "array" && (expected as unknown[]).length && (actual as unknown[]).length) {
    shapeDiff((expected as unknown[])[0], (actual as unknown[])[0], path + "[0]", out);
  }
  return out;
};

export const warnText = (warning: SchemaWarning): string =>
  warning.kind === "missing"
    ? warning.path + " is expected (" + warning.exp + ") but not provided"
    : warning.path + " should be " + warning.exp + " but is " + warning.act;

const expectedForApi = (node: Extract<ArchNode, { type: "api" }>): unknown => {
  const expected: JsonObject = {};
  node.cfg.pathParams.forEach((p) => {
    if (p.k) expected[p.k] = sampleOf(p.type);
  });
  node.cfg.query
    .filter((q) => q.required && q.k)
    .forEach((q) => {
      expected[q.k] = sampleOf(q.type);
    });
  const body = pj(node.cfg.body, null);
  if (isObject(body)) Object.assign(expected, body);
  return Object.keys(expected).length ? expected : null;
};

export const expectedFor = (node: ArchNode): unknown => {
  if (node.type === "function") return pj(node.cfg.input, null);
  if (node.type === "api") return expectedForApi(node);
  if (node.type === "connector") {
    const expected: JsonObject = {};
    paramsUsed(node).forEach((k) => {
      expected[k] = ANY_VALUE;
    });
    return Object.keys(expected).length ? expected : null;
  }
  return null;
};

export const outOf = (node: ArchNode): unknown => {
  if (node.type === "component") return pj(node.cfg.output, {});
  if (node.type === "function") return pj(node.cfg.output, pj(node.cfg.input, {}));
  const expected = expectedFor(node);
  return expected && node.type !== "connector" ? expected : {};
};

export const payloadLabel = (value: unknown): string => {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (Array.isArray(value)) return "[" + value.length + "]";
  if (typeof value === "object") {
    if ("sql" in value && "params" in value) return "SQL query";
    const keys = Object.keys(value);
    return (
      "{ " +
      keys.slice(0, MAX_LABEL_KEYS).join(", ") +
      (keys.length > MAX_LABEL_KEYS ? ", +" + (keys.length - MAX_LABEL_KEYS) : "") +
      " }"
    );
  }
  return String(value);
};
