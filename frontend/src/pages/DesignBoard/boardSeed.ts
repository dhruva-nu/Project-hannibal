import type { BoardNodeData, BoardEdge } from "./boardTypes";

let uidCounter = 0;
export const nextId = (prefix: string) => `${prefix}_${++uidCounter}`;

export function buildSeedData(): { nodes: Record<string, BoardNodeData>; edges: BoardEdge[] } {
  const c1 = nextId("c");
  const s1 = nextId("s");
  const db = nextId("c");
  const rd = nextId("c");
  const ob = nextId("c");
  const authMod = nextId("m");
  const gw = nextId("m");

  const nodes: Record<string, BoardNodeData> = {
    [c1]: { id: c1, type: "component", x: 60, y: 220, label: "Client" },
    [s1]: {
      id: s1, type: "service", x: 280, y: 150, w: 220, label: "BE",
      modules: [{ id: authMod, label: "Auth Module" }, { id: gw, label: "Gateway" }],
    },
    [db]: { id: db, type: "component", x: 580, y: 150, label: "DB" },
    [rd]: { id: rd, type: "component", x: 580, y: 220, label: "Redis" },
    [ob]: { id: ob, type: "component", x: 360, y: 360, label: "OAuth Provider" },
  };

  const edges: BoardEdge[] = [
    { id: nextId("e"), from: { nodeId: c1, port: "r" }, to: { nodeId: s1, port: "l" } },
    { id: nextId("e"), from: { nodeId: s1, moduleId: authMod, port: "r" }, to: { nodeId: db, port: "l" } },
    { id: nextId("e"), from: { nodeId: s1, moduleId: gw, port: "r" }, to: { nodeId: rd, port: "l" } },
    { id: nextId("e"), from: { nodeId: s1, port: "b" }, to: { nodeId: ob, port: "t" } },
  ];

  return { nodes, edges };
}
