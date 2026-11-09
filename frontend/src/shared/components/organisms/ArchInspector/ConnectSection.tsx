import { useState } from "react";
import { LAYERS, type PlacedNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, SelectInput, ToolButton } from "@/shared/components/atoms";
import { FormRow, PanelSection } from "@/shared/components/molecules";

const layerLabelOf = (n: PlacedNode) => {
  const layer = LAYERS.find((l) => l.id === n.layer);
  return layer ? layer.label.replace(" layer", "") : "infra";
};

export const ConnectSection = ({ nodeId }: { nodeId: string }) => {
  const { model, connect } = useArch();
  const [chosen, setChosen] = useState("");
  const candidates = model.nodes.filter(
    (n) => n.id !== nodeId && !model.edges.some((e) => e.from === nodeId && e.to === n.id),
  );
  if (!candidates.length) return null;
  const target = candidates.some((n) => n.id === chosen) ? chosen : candidates[0].id;
  return (
    <PanelSection title="Connect to">
      <HintText>Draw an arrow from this to another box, including boxes in other layers.</HintText>
      <FormRow>
        <SelectInput
          aria-label="Connection target"
          value={target}
          onChange={setChosen}
          options={candidates.map((n) => [n.id, `${n.name} (${layerLabelOf(n)})`] as const)}
        />
        <ToolButton small keepWidth onClick={() => connect(nodeId, target, false)}>
          Connect
        </ToolButton>
      </FormRow>
    </PanelSection>
  );
};
