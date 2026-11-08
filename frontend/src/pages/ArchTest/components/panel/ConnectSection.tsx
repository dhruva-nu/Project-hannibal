import { useState } from "react";
import { LAYERS, type PlacedNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Note, Row, Section, SelectInput, ToolButton } from "../../ui/Controls";

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
    <Section title="Connect to">
      <Note>Draw an arrow from this to another box, including boxes in other layers.</Note>
      <Row>
        <SelectInput
          aria-label="Connection target"
          value={target}
          onChange={setChosen}
          options={candidates.map((n) => [n.id, `${n.name} (${layerLabelOf(n)})`] as const)}
        />
        <ToolButton small fixed onClick={() => connect(nodeId, target, false)}>
          Connect
        </ToolButton>
      </Row>
    </Section>
  );
};
