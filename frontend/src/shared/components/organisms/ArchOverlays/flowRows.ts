import { flattenToPaths, jsonTypeOf, ANY_VALUE } from "@/pages/ArchTest/engine";
import type { MapRow } from "@/pages/ArchTest/engine";

export type FlowStatus = "removed" | "added" | "mapped" | "modified" | "missing" | "unused" | "type" | "";

export interface FlowRow {
  path: string;
  source: string;
  wire: string;
  expected: string;
  status: FlowStatus;
}

const MAX_CELL_LENGTH = 60;

const formatCell = (value: unknown): string =>
  value === undefined ? "" : String(JSON.stringify(value)).slice(0, MAX_CELL_LENGTH);

const changeStatus = (
  path: string,
  source: Record<string, unknown>,
  wire: Record<string, unknown>,
  mappedTargets: string[],
): FlowStatus => {
  const inSource = path in source;
  const inWire = path in wire;
  if (inSource && !inWire) return "removed";
  if (!inSource && inWire) return mappedTargets.includes(path.split(".")[0]) ? "mapped" : "added";
  if (inSource && inWire && JSON.stringify(source[path]) !== JSON.stringify(wire[path])) return "modified";
  return "";
};

const contractStatus = (
  path: string,
  wire: Record<string, unknown>,
  expected: Record<string, unknown>,
  current: FlowStatus,
): FlowStatus => {
  const inWire = path in wire;
  const inExpected = path in expected;
  if (inExpected && !inWire) return "missing";
  if (inWire && !inExpected) return current || "unused";
  const typeClash =
    inWire && inExpected && jsonTypeOf(wire[path]) !== jsonTypeOf(expected[path]) && expected[path] !== ANY_VALUE && wire[path] !== null;
  return typeClash ? "type" : current;
};

export const flowRows = (sourceOutput: unknown, wirePayload: unknown, expectedInput: unknown, map: MapRow[]): FlowRow[] => {
  const source = flattenToPaths(sourceOutput);
  const wire = flattenToPaths(wirePayload);
  const expected = expectedInput ? flattenToPaths(expectedInput) : null;
  const mappedTargets = map.filter((m) => m.from).map((m) => m.to);
  const paths = [...new Set([...Object.keys(source), ...Object.keys(wire), ...(expected ? Object.keys(expected) : [])])];
  return paths.map((path) => {
    const base = changeStatus(path, source, wire, mappedTargets);
    const status = expected ? contractStatus(path, wire, expected, base) : base;
    const expectedValue = expected?.[path];
    return {
      path,
      source: formatCell(source[path]),
      wire: formatCell(wire[path]),
      expected: !expected ? "" : expectedValue === ANY_VALUE ? "any" : formatCell(expectedValue),
      status,
    };
  });
};
