import { reach, type ApiNode } from "../../../engine";
import { useArch } from "../../../state/archApi";
import { Code, FieldCaption, Note } from "../../../ui/Controls";
import { curlExample } from "../curlExample";
import { Modal } from "../Modal";
import { NodeLinks } from "../../../ui/NodeLinks";

export const ApiDetail = ({ node, onClose }: { node: ApiNode; onClose: () => void }) => {
  const { model } = useArch();
  return (
    <Modal title={node.name} wide onClose={onClose}>
      <FieldCaption>Example</FieldCaption>
      <Code>{curlExample(node.cfg)}</Code>
      {node.cfg.responses.map((r) => (
        <div key={`${r.status}-${r.desc}`}>
          <FieldCaption>
            Response {r.status} {r.desc}
          </FieldCaption>
          <Code>{r.body}</Code>
        </div>
      ))}
      <Note>
        Used by: <NodeLinks nodes={reach(model, node.id, "bwd", ["component"])} />
      </Note>
      <Note>
        Calls: <NodeLinks nodes={reach(model, node.id, "fwd", ["connector"])} />
      </Note>
    </Modal>
  );
};
