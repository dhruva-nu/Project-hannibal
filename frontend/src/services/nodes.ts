import { api } from "./api";

export interface PlacedNode {
  id: string;
  type: "service" | "module" | "component";
  label: string;
  parent_id: string | null;
  default_x: number | null;
  default_y: number | null;
  default_w: number | null;
  linked_node_ids: string[];
}

export async function getNodePlacement(nodeId: string): Promise<PlacedNode[]> {
  const result = await api.get<{ nodes: PlacedNode[] }>(`/api/v1/nodes/${nodeId}/placement`);
  return result.nodes;
}
