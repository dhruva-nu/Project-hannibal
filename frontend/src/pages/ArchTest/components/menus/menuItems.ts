import type { InfraType, LayerId, PlacedType } from "../../engine";
import { INFRA_KEYS, REG } from "../../engine";

export interface MenuItem<T extends PlacedType = PlacedType> {
  type: T;
  label: string;
}

export interface MenuGroup {
  heading: string;
  items: MenuItem[];
}

export type MenuKind = "add" | "insert" | "file";

const itemsOf = <T extends PlacedType>(types: T[]): Array<MenuItem<T>> =>
  types.map((type) => ({ type, label: REG[type].label }));

const plainInfra = (): InfraType[] => INFRA_KEYS.filter((key) => !REG[key].container);
const containers = (): InfraType[] => INFRA_KEYS.filter((key) => REG[key].container);

const LAYER_GROUPS: Record<LayerId, MenuGroup[]> = {
  client: [{ heading: "Client", items: itemsOf(["component", "function", "state"]) }],
  backend: [
    { heading: "Backend", items: itemsOf(["api", "connector"]) },
    { heading: "Containers (put APIs inside)", items: itemsOf(containers()) },
  ],
  db: [{ heading: "Database", items: itemsOf(["sqldb", "nosql"]) }],
};

export const INSERT_HEADING = "Insert into this connection";

export const insertMenuItems = (): Array<MenuItem<InfraType>> => itemsOf(plainInfra());

export const addMenuGroups = (scope: LayerId | null): MenuGroup[] => {
  if (!scope) return [{ heading: "Infrastructure outside the layers", items: itemsOf(plainInfra()) }];
  const extraContainers = scope === "backend" ? [] : [{ heading: "Containers", items: itemsOf(containers()) }];
  return [...LAYER_GROUPS[scope], ...extraContainers, { heading: "Infrastructure", items: itemsOf(plainInfra()) }];
};

export const OPEN_LAYER_HINT = "Open a layer to add its components";
