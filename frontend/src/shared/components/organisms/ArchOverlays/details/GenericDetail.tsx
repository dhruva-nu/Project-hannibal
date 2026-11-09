import { incomingEdges, outgoingEdges, toPrettyJson, NODE_REGISTRY, findNode as lookupNode, type ArchNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { CodeBlock, FieldCaption, HintText, ToolButton } from "@/shared/components/atoms";
import { Modal } from "@/shared/components/molecules";
import { ArchNodeLinks } from "@/shared/components/molecules";

const isNode = (n: ArchNode | undefined): n is ArchNode => n !== undefined;

export const GenericDetail = ({ node, onClose }: { node: ArchNode; onClose: () => void }) => {
  const api = useArch();
  const senders = incomingEdges(api.model, node.id).map((e) => lookupNode(api.model, e.from)).filter(isNode);
  const receivers = outgoingEdges(api.model, node.id).map((e) => lookupNode(api.model, e.to)).filter(isNode);
  return (
    <Modal title={node.name} onClose={onClose}>
      <HintText>{NODE_REGISTRY[node.type].label}</HintText>
      <HintText>
        Receives from: <ArchNodeLinks nodes={senders} />
      </HintText>
      <HintText>
        Sends to: <ArchNodeLinks nodes={receivers} />
      </HintText>
      {node.type === "component" ? (
        <>
          <FieldCaption>Expected input</FieldCaption>
          <CodeBlock>{node.cfg.input}</CodeBlock>
          <FieldCaption>Output</FieldCaption>
          <CodeBlock>{node.cfg.output}</CodeBlock>
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
          <CodeBlock>{toPrettyJson(node.cfg)}</CodeBlock>
        </>
      )}
    </Modal>
  );
};
