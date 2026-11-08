import { inE, node, outE, type ArchNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Note, Section } from "../../ui/Controls";
import { NodeLinks } from "../../ui/NodeLinks";

export const ConnectionList = ({ nodeId }: { nodeId: string }) => {
  const { model } = useArch();
  const resolve = (ids: string[]) => ids.map((id) => node(model, id)).filter((n): n is ArchNode => !!n);
  return (
    <Section title="Connections">
      <Note>
        Receives from:{" "}
        <NodeLinks nodes={resolve(inE(model, nodeId).map((e) => e.from))} />
      </Note>
      <Note>
        Sends to: <NodeLinks nodes={resolve(outE(model, nodeId).map((e) => e.to))} />
      </Note>
    </Section>
  );
};
