import { incomingEdges, findNode, outgoingEdges, type ArchNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText } from "@/shared/components/atoms";
import { PanelSection } from "@/shared/components/molecules";
import { ArchNodeLinks } from "@/shared/components/molecules";

export const ConnectionList = ({ nodeId }: { nodeId: string }) => {
  const { model } = useArch();
  const resolve = (ids: string[]) => ids.map((id) => findNode(model, id)).filter((n): n is ArchNode => !!n);
  return (
    <PanelSection title="Connections">
      <HintText>
        Receives from:{" "}
        <ArchNodeLinks nodes={resolve(incomingEdges(model, nodeId).map((e) => e.from))} />
      </HintText>
      <HintText>
        Sends to: <ArchNodeLinks nodes={resolve(outgoingEdges(model, nodeId).map((e) => e.to))} />
      </HintText>
    </PanelSection>
  );
};
