import { inE, outE, pretty, REG, node as lookupNode, type ArchNode } from "../../../engine";
import { useArch } from "../../../state/archApi";
import { Code, FieldCaption, Note, ToolButton } from "../../../ui/Controls";
import { Modal } from "../Modal";
import { NodeLinks } from "../../../ui/NodeLinks";

const isNode = (n: ArchNode | undefined): n is ArchNode => n !== undefined;

export const GenericDetail = ({ node, onClose }: { node: ArchNode; onClose: () => void }) => {
  const api = useArch();
  const senders = inE(api.model, node.id).map((e) => lookupNode(api.model, e.from)).filter(isNode);
  const receivers = outE(api.model, node.id).map((e) => lookupNode(api.model, e.to)).filter(isNode);
  return (
    <Modal title={node.name} onClose={onClose}>
      <Note>{REG[node.type].label}</Note>
      <Note>
        Receives from: <NodeLinks nodes={senders} />
      </Note>
      <Note>
        Sends to: <NodeLinks nodes={receivers} />
      </Note>
      {node.type === "component" ? (
        <>
          <FieldCaption>Expected input</FieldCaption>
          <Code>{node.cfg.input}</Code>
          <FieldCaption>Output</FieldCaption>
          <Code>{node.cfg.output}</Code>
          <ToolButton
            onClick={() => {
              api.closeModal();
              api.startTrace(node.id);
            }}
          >
            Trace this component
          </ToolButton>
        </>
      ) : (
        <>
          <FieldCaption>Configuration</FieldCaption>
          <Code>{pretty(node.cfg)}</Code>
        </>
      )}
    </Modal>
  );
};
