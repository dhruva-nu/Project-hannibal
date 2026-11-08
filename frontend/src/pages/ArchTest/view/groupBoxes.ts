import type { ArchModel, LayerId } from "../engine";
import { boundsOf, type Box } from "./geometry";
import { isVisible } from "./visibility";

export interface GroupBox extends Box {
  id: string;
  name: string;
}

const PADDING_X = 24;
const PADDING_TOP = 34;
const PADDING_BOTTOM = 24;

export const groupBoxes = (model: ArchModel, scope: LayerId | null): GroupBox[] =>
  model.groups.flatMap((group) => {
    const members = model.nodes.filter((n) => n.group === group.id && isVisible(n, scope));
    const bounds = boundsOf(members);
    if (!bounds) return [];
    return [
      {
        id: group.id,
        name: group.name,
        x: bounds.minX - PADDING_X,
        y: bounds.minY - PADDING_TOP,
        w: bounds.maxX - bounds.minX + PADDING_X * 2,
        h: bounds.maxY - bounds.minY + PADDING_TOP + PADDING_BOTTOM,
      },
    ];
  });
