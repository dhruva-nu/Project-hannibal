import type { InfraType, LayerId, PlacedType } from "../../engine";
import { Menu, MenuButton, MenuHeading } from "./Menu";
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
    <Menu anchor={menu} onClose={props.onClose}>
      {menu.kind === "file" && (
        <>
          <MenuButton onClick={props.onLoadExample}>Load the user profile example</MenuButton>
          <MenuButton onClick={props.onNewBlank}>New blank diagram</MenuButton>
          <MenuButton onClick={props.onOpenIo}>Export or import JSON</MenuButton>
        </>
      )}
      {menu.kind === "insert" && (
        <>
          <MenuHeading>{INSERT_HEADING}</MenuHeading>
          {insertMenuItems().map((item) => (
            <MenuButton key={item.type} onClick={() => props.onInsert(item.type)}>
              {item.label}
            </MenuButton>
          ))}
        </>
      )}
      {menu.kind === "add" && (
        <>
          {addMenuGroups(props.scope).map((group) => (
            <div key={group.heading}>
              <MenuHeading>{group.heading}</MenuHeading>
              {group.items.map((item) => (
                <MenuButton key={item.type} onClick={() => props.onAdd(item.type)}>
                  {item.label}
                </MenuButton>
              ))}
            </div>
          ))}
          {!props.scope && <MenuHeading>{OPEN_LAYER_HINT}</MenuHeading>}
        </>
      )}
    </Menu>
  );
};
