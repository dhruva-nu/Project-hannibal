import { createEdge, createNode } from "./model";
import { emptyQuery, newEndpoint } from "./registry";
import { starter } from "./starter";
import type {
  ArchEdge,
  ArchModel,
  ConnectorQuery,
  Endpoint,
  MapRow,
  PlacedNode,
  PlacedType,
  QuerySource,
  ServiceNode,
} from "./types";

export const STARTER_SERVICE = "User service";
export const GET_USER_ENDPOINT = "ep_get_user";
export const LIST_USERS_ENDPOINT = "ep_list_users";
export const CREATE_USER_ENDPOINT = "ep_create_user";

export const byName = <T extends PlacedNode>(model: ArchModel, name: string): T => {
  const found = model.nodes.find((n) => n.name === name);
  if (!found) throw new Error("fixture node missing: " + name);
  return found as T;
};

export const addNode = <T extends PlacedNode>(
  model: ArchModel,
  type: PlacedType,
  name: string,
  cfg: Record<string, unknown> = {},
  options: { x?: number; y?: number; w?: number; h?: number } = {},
): T => {
  const created = createNode(type, options.x ?? 0, options.y ?? 0, { name, cfg, w: options.w, h: options.h });
  model.nodes.push(created);
  return created as T;
};

export const addService = (model: ArchModel, name: string, endpoints: Endpoint[]): ServiceNode =>
  addNode<ServiceNode>(model, "service", name, { endpoints });

export const sampleOnlyEndpoint = (body: string, status: number | "" = 200): Endpoint =>
  newEndpoint({ pathParams: [], responses: [{ status, desc: "sample", body }] });

export const link = (model: ArchModel, from: PlacedNode, to: PlacedNode, map: MapRow[] = []): ArchEdge => {
  const created = createEdge(from.id, to.id, map);
  model.edges.push(created);
  return created;
};

export const removeEdgeBetween = (model: ArchModel, from: PlacedNode, to: PlacedNode): void => {
  model.edges = model.edges.filter((e) => !(e.from === from.id && e.to === to.id));
};

export const starterModel = (): ArchModel => starter();

export const starterService = (model: ArchModel): ServiceNode => byName<ServiceNode>(model, STARTER_SERVICE);

export const endpointOf = (model: ArchModel, endpointId = GET_USER_ENDPOINT): Endpoint => {
  const found = starterService(model).cfg.endpoints.find((e) => e.id === endpointId);
  if (!found) throw new Error("fixture endpoint missing: " + endpointId);
  return found;
};

/** Clears every query clause except the chosen tables, then applies the patch. */
export const resetQuery = (source: QuerySource, patch: Partial<ConnectorQuery>): void => {
  source.q = { ...emptyQuery(), tables: source.q.tables, ...patch };
};
