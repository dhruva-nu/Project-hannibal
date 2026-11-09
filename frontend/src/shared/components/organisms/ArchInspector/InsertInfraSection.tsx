import { useState } from "react";
import { INFRA_KEYS, NODE_REGISTRY, type InfraType } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, SelectInput, ToolButton } from "@/shared/components/atoms";
import { FormRow, PanelSection } from "@/shared/components/molecules";

const PLAIN_INFRA = INFRA_KEYS.filter((key) => !NODE_REGISTRY[key].container);

export const InsertInfraSection = ({ edgeId, description }: { edgeId: string; description: string }) => {
  const { insertOnEdge } = useArch();
  const [type, setType] = useState<InfraType>(PLAIN_INFRA[0]);
  return (
    <PanelSection title="Insert infrastructure">
      <HintText>{description}</HintText>
      <FormRow>
        <SelectInput
          aria-label="Infrastructure type"
          value={type}
          onChange={(value) => setType(value as InfraType)}
          options={PLAIN_INFRA.map((key) => [key, NODE_REGISTRY[key].label] as const)}
        />
        <ToolButton small keepWidth onClick={() => insertOnEdge(edgeId, type)}>
          Insert
        </ToolButton>
      </FormRow>
    </PanelSection>
  );
};
