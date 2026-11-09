import type { InfraType, LayerId, PlacedType } from "@/pages/ArchTest/engine";
import { MenuHeading, MenuItem, PopoverMenu } from "@/shared/components/molecules";
import { addMenuGroups, INSERT_HEADING, insertMenuItems, OPEN_LAYER_HINT } from "./menuItems";

export interface OpenMenu {
  kind: "add" | "insert" | "file";
  anchorElement: HTMLElement;
  left: number;
  bottom: number;
}

interface ArchMenuProps {
  menu: OpenMenu | null;
  scope: LayerId | null;
  onClose: () => void;
  onAdd: (type: PlacedType) => void;
  onInsert: (type: InfraType) => void;
  onLoadExample: () => void;
  onNewBlank: () => void;
  onOpenIo: () => void;
}

export const ArchMenu = (props: ArchMenuProps) => {
  const { menu } = props;
  if (!menu) return null;
  return (
    <PopoverMenu anchor={menu} onClose={props.onClose}>
      {menu.kind === "file" && (
        <>
          <MenuItem onClick={props.onLoadExample}>Load the user profile example</MenuItem>
          <MenuItem onClick={props.onNewBlank}>New blank diagram</MenuItem>
          <MenuItem onClick={props.onOpenIo}>Export or import JSON</MenuItem>
        </>
      )}
      {menu.kind === "insert" && (
        <>
          <MenuHeading>{INSERT_HEADING}</MenuHeading>
          {insertMenuItems().map((item) => (
            <MenuItem key={item.type} onClick={() => props.onInsert(item.type)}>
              {item.label}
            </MenuItem>
          ))}
        </>
      )}
      {menu.kind === "add" && (
        <>
          {addMenuGroups(props.scope).map((group) => (
            <div key={group.heading}>
              <MenuHeading>{group.heading}</MenuHeading>
              {group.items.map((item) => (
                <MenuItem key={item.type} onClick={() => props.onAdd(item.type)}>
                  {item.label}
                </MenuItem>
              ))}
            </div>
          ))}
          {!props.scope && <MenuHeading>{OPEN_LAYER_HINT}</MenuHeading>}
        </>
      )}
    </PopoverMenu>
  );
};
