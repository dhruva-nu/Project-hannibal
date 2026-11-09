import { NODE_REGISTRY, type SidebarNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { ToolButton } from "@/shared/components/atoms";
import { FormField, PanelSection } from "@/shared/components/molecules";
import { BoundSelect, BoundText } from "./Bound";
import { ComponentPanel } from "./ComponentPanel";
import { ConnectionList } from "./ConnectionList";
import { ConnectSection } from "./ConnectSection";
import { FunctionPanel } from "./FunctionPanel";
import { InfraPanel } from "./InfraPanel";
import { PanelHeader } from "./PanelHeader";
import { useEditor, type Editor } from "./panelEditor";

const NodeBody = ({ node, editor }: { node: SidebarNode; editor: Editor }) => {
  switch (node.type) {
    case "component":
      return <ComponentPanel node={node} editor={editor} />;
    case "function":
      return <FunctionPanel node={node} editor={editor} />;
    default:
      return (
        <>
          <InfraPanel node={node} editor={editor} />
          <ConnectionList nodeId={node.id} />
        </>
      );
  }
};

export const NodePanel = ({ node }: { node: SidebarNode }) => {
  const { model, openDetail, startTrace, askDeleteSelection } = useArch();
  const editor = useEditor("node", node.id);
  return (
    <>
      <PanelHeader
        title={node.name}
        subtitle={NODE_REGISTRY[node.type].label}
        actions={
          <>
            {node.type === "component" && (
              <ToolButton small onClick={() => startTrace(node.id)}>
                Trace request
              </ToolButton>
            )}
            <ToolButton small onClick={() => openDetail(node.id)}>
              Detail view
            </ToolButton>
            <ToolButton small danger onClick={askDeleteSelection}>
              Delete
            </ToolButton>
          </>
        }
      />
      <PanelSection title="General">
        <FormField label="Name">
          <BoundText editor={editor} path="name" value={node.name} />
        </FormField>
        <FormField label="Group">
          <BoundSelect
            editor={editor}
            path="group"
            value={node.group ?? ""}
            options={[["", "None"] as const, ...model.groups.map((g) => [g.id, g.name] as const)]}
          />
        </FormField>
      </PanelSection>
      <NodeBody node={node} editor={editor} />
      <ConnectSection nodeId={node.id} />
    </>
  );
};
