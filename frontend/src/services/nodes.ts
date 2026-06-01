import { api } from "./api";

export type NodeType = "component" | "service" | "module";

export interface NodeRecord {
  id: string;
  type: NodeType;
  label: string;
  parentId: string | null;
  linkedNodeIds: string[];
  defaultX: number | null;
  defaultY: number | null;
  defaultW: number | null;
}

export interface NodePlacement {
  nodes: NodeRecord[];
}

interface BENodeRecord {
  id: string;
  type: NodeType;
  label: string;
  parent_id: string | null;
  linked_node_ids: string[];
  default_x: number | null;
  default_y: number | null;
  default_w: number | null;
}

interface BENodePlacement {
  nodes: BENodeRecord[];
}

function mapNode(n: BENodeRecord): NodeRecord {
  return {
    id: n.id,
    type: n.type,
    label: n.label,
    parentId: n.parent_id,
    linkedNodeIds: n.linked_node_ids ?? [],
    defaultX: n.default_x,
    defaultY: n.default_y,
    defaultW: n.default_w,
  };
}

export async function getNodePlacement(nodeId: string): Promise<NodePlacement> {
  const result = await api.get<BENodePlacement>(`/api/v1/nodes/${nodeId}/placement`);
  return { nodes: result.nodes.map(mapNode) };
}
