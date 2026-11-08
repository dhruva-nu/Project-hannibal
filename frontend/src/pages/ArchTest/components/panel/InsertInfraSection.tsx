import { useState } from "react";
import { INFRA_KEYS, REG, type InfraType } from "../../engine";
import { useArch } from "../../state/archApi";
import { Note, Row, Section, SelectInput, ToolButton } from "../../ui/Controls";

const PLAIN_INFRA = INFRA_KEYS.filter((key) => !REG[key].container);

export const InsertInfraSection = ({ edgeId, description }: { edgeId: string; description: string }) => {
  const { insertOnEdge } = useArch();
  const [type, setType] = useState<InfraType>(PLAIN_INFRA[0]);
  return (
    <Section title="Insert infrastructure">
      <Note>{description}</Note>
      <Row>
        <SelectInput
          aria-label="Infrastructure type"
          value={type}
          onChange={(value) => setType(value as InfraType)}
          options={PLAIN_INFRA.map((key) => [key, REG[key].label] as const)}
        />
        <ToolButton small fixed onClick={() => insertOnEdge(edgeId, type)}>
          Insert
        </ToolButton>
      </Row>
    </Section>
  );
};
