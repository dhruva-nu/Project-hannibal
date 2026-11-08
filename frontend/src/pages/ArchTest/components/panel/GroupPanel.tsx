import type { Group } from "../../engine";
import { useArch } from "../../state/archApi";
import { Field, Note, Section, ToolButton } from "../../ui/Controls";
import { BoundText } from "./Bound";
import { NodeLinks } from "../../ui/NodeLinks";
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
      <Section title="General">
        <Field label="Name">
          <BoundText editor={editor} path="name" value={group.name} />
        </Field>
      </Section>
      <Section title="Members">
        <Note>
          <NodeLinks nodes={members} />
        </Note>
        <Note>Drag the group label to move everything inside it.</Note>
      </Section>
    </>
  );
};
