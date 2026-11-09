import type { Group } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, ToolButton } from "@/shared/components/atoms";
import { FormField, PanelSection } from "@/shared/components/molecules";
import { BoundText } from "./Bound";
import { ArchNodeLinks } from "@/shared/components/molecules";
import { PanelHeader } from "./PanelHeader";
import { useEditor } from "./panelEditor";

export const GroupPanel = ({ group }: { group: Group }) => {
  const { model, ungroup, askDeleteSelection } = useArch();
  const editor = useEditor("group", group.id);
  const members = model.nodes.filter((n) => n.group === group.id);
  return (
    <>
      <PanelHeader
        title={group.name}
        subtitle={`Group of ${members.length} components`}
        actions={
          <>
            <ToolButton small onClick={() => ungroup(group.id)}>
              Ungroup
            </ToolButton>
            <ToolButton small danger onClick={askDeleteSelection}>
              Delete
            </ToolButton>
          </>
        }
      />
      <PanelSection title="General">
        <FormField label="Name">
          <BoundText editor={editor} path="name" value={group.name} />
        </FormField>
      </PanelSection>
      <PanelSection title="Members">
        <HintText>
          <ArchNodeLinks nodes={members} />
        </HintText>
        <HintText>Drag the group label to move everything inside it.</HintText>
      </PanelSection>
    </>
  );
};
