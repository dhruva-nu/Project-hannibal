import { clone, deletePath, getPath, isObject, parseLiteral, parseJsonOr, emptyValueOfType, setPath, jsonTypeOf } from "./json";
import type { ArchNode, Endpoint, JsonObject, MapRow, PayloadDiff, SchemaWarning } from "./types";

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
      deletePath(out, row.from);
      setPath(out, row.to, moved);
    } else {
      setPath(out, row.to, parseLiteral(row.value));
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

export const flattenToPaths = (
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
        .forEach((item, i) => flattenToPaths(item, path + "[" + i + "]", out, depth + 1));
    } else {
      const keys = Object.keys(value);
      if (!keys.length) out[path || "{}"] = "{}";
      keys.forEach((k) => flattenToPaths((value as JsonObject)[k], path ? path + "." + k : k, out, depth + 1));
    }
  } else {
    out[path || "(value)"] = value;
  }
  return out;
};

export const diffPayload = (before: unknown, after: unknown): PayloadDiff[] => {
  const flatBefore = flattenToPaths(before);
  const flatAfter = flattenToPaths(after);
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
    out.push({ path: path || "(root)", kind: "missing", exp: jsonTypeOf(expected) });
    return out;
  }
  if (actual === null) return out;
  const expectedType = jsonTypeOf(expected);
  const actualType = jsonTypeOf(actual);
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

export const expectedForEndpoint = (endpoint: Endpoint): unknown => {
  const expected: JsonObject = {};
  endpoint.pathParams.forEach((p) => {
    if (p.k) expected[p.k] = emptyValueOfType(p.type);
  });
  endpoint.query
    .filter((q) => q.required && q.k)
    .forEach((q) => {
      expected[q.k] = emptyValueOfType(q.type);
    });
  const body = parseJsonOr(endpoint.body, null);
  if (isObject(body)) Object.assign(expected, body);
  return Object.keys(expected).length ? expected : null;
};

/** What a node expects to receive. A service's expectation depends on which endpoint is being called. */
export const expectedFor = (node: ArchNode, endpointId = ""): unknown => {
  if (node.type === "function") return parseJsonOr(node.cfg.input, null);
  if (node.type === "service") {
    const endpoint = node.cfg.endpoints.find((e) => e.id === endpointId);
    return endpoint ? expectedForEndpoint(endpoint) : null;
  }
  return null;
};

export const declaredOutputOf = (node: ArchNode): unknown => {
  if (node.type === "component") return parseJsonOr(node.cfg.output, {});
  if (node.type === "function") return parseJsonOr(node.cfg.output, parseJsonOr(node.cfg.input, {}));
  return {};
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
