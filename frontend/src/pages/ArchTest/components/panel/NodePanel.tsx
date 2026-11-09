import { REG, type InfraNode, type PlacedNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Field, Section, ToolButton } from "../../ui/Controls";
import { BoundSelect, BoundText } from "./Bound";
import { ComponentPanel } from "./ComponentPanel";
import { ConnectionList } from "./ConnectionList";
import { ConnectSection } from "./ConnectSection";
import { FunctionPanel } from "./FunctionPanel";
import { InfraPanel } from "./InfraPanel";
import { NosqlPanel } from "./NosqlPanel";
import { PanelHeader } from "./PanelHeader";
import { ServicePanel } from "./ServicePanel";
import { useEditor, type Editor } from "./panelEditor";
import { SqlPanel } from "./SqlPanel";

const NodeBody = ({ node, editor }: { node: PlacedNode; editor: Editor }) => {
  switch (node.type) {
    case "component":
      return <ComponentPanel node={node} editor={editor} />;
    case "function":
      return <FunctionPanel node={node} editor={editor} />;
    case "service":
      return (
        <>
          <ServicePanel node={node} editor={editor} />
          <ConnectionList nodeId={node.id} />
        </>
      );
    case "sqldb":
      return (
        <>
          <SqlPanel node={node} editor={editor} />
          <ConnectionList nodeId={node.id} />
        </>
      );
    case "nosql":
      return (
        <>
          <NosqlPanel node={node} editor={editor} />
          <ConnectionList nodeId={node.id} />
        </>
      );
    default:
      return (
        <>
          <InfraPanel node={node as InfraNode} editor={editor} />
          <ConnectionList nodeId={node.id} />
        </>
      );
  }
};

export const NodePanel = ({ node }: { node: PlacedNode }) => {
  const { model, openDetail, startTrace, askDeleteSelection } = useArch();
  const editor = useEditor("node", node.id);
  return (
    <>
      <PanelHeader
        title={node.name}
        subtitle={REG[node.type].label}
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
      <Section title="General">
        <Field label="Name">
          <BoundText editor={editor} path="name" value={node.name} />
        </Field>
        <Field label="Group">
          <BoundSelect
            editor={editor}
            path="group"
            value={node.group ?? ""}
            options={[["", "None"] as const, ...model.groups.map((g) => [g.id, g.name] as const)]}
          />
        </Field>
      </Section>
      <NodeBody node={node} editor={editor} />
      <ConnectSection nodeId={node.id} />
    </>
  );
};
