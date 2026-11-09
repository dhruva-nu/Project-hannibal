import type { ArchNode, Category, InfraBehaviour, InfraCfg, InfraType, LayerId, NodeType } from "./types";

interface InfraFieldBase {
  k: string;
  label: string;
  def: string | number;
}

export type InfraField = (InfraFieldBase & { t: "text" | "number" }) | (InfraFieldBase & { t: "select"; opts: string[] });

export interface RegEntry {
  label: string;
  cat: Category;
  layer?: LayerId;
  w: number;
  h: number;
  def: () => ArchNode["cfg"];
  beh?: InfraBehaviour;
  container?: boolean;
  fields?: InfraField[];
  sum?: (cfg: InfraCfg) => string;
}

export interface InfraRegEntry extends RegEntry {
  beh: InfraBehaviour;
  fields: InfraField[];
  sum: (cfg: InfraCfg) => string;
}

export type NodeRegistry = { [K in NodeType]: K extends InfraType ? InfraRegEntry : RegEntry };

export interface LayerDef {
  id: LayerId;
  label: string;
  y: number;
  h: number;
}
