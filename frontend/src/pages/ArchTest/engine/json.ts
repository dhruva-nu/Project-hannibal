import type { JsonObject } from "./types";

type Bag = Record<string, unknown>;

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const uid = (prefix: string): string => prefix + Math.random().toString(36).slice(2, 8);

export const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

export const parseJsonOr = (source: unknown, fallback: unknown): unknown => {
  if (source === null || source === undefined) return fallback;
  if (typeof source !== "string") return source;
  if (!source.trim()) return fallback;
  try {
    return JSON.parse(source);
  } catch {
    return fallback;
  }
};

export const isValidJson = (source: unknown): boolean => {
  if (typeof source !== "string" || !source.trim()) return true;
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
};

export const toPrettyJson = (value: unknown): string =>
  value === undefined ? "" : JSON.stringify(value, null, 2);

export const pathSegments = (path: string): string[] =>
  String(path)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment !== "");

export const getPath = (root: unknown, path: string): unknown => {
  let current = root;
  for (const segment of pathSegments(path)) {
    if (current === null || current === undefined) return undefined;
    current = (current as Bag)[segment];
  }
  return current;
};

export const setPath = (root: unknown, path: string, value: unknown): void => {
  const segments = pathSegments(path);
  let current = root as Bag;
  for (let i = 0; i < segments.length - 1; i++) {
    const existing = current[segments[i]];
    if (existing === null || existing === undefined || typeof existing !== "object") {
      current[segments[i]] = /^\d+$/.test(segments[i + 1]) ? [] : {};
    }
    current = current[segments[i]] as Bag;
  }
  current[segments[segments.length - 1]] = value;
};

export const deletePath = (root: unknown, path: string): void => {
  const segments = pathSegments(path);
  let current = root as Bag | null | undefined;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || current === undefined) return;
    current = current[segments[i]] as Bag | null | undefined;
  }
  if (current !== null && current !== undefined) delete current[segments[segments.length - 1]];
};

export const parseLiteral = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const lastSegment = (field: string | null | undefined): string => String(field || "").split(".").pop() as string;

export const jsonTypeOf = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

export const emptyValueOfType = (type: string): unknown =>
  ({ number: 0, boolean: false, object: {}, array: [], string: "" })[type as "number"];
