import { requireNode, type DerivedEdge } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, ToolButton } from "@/shared/components/atoms";
import { FormRow, PanelSection } from "@/shared/components/molecules";
import { InsertInfraSection } from "./InsertInfraSection";
import { PanelHeader } from "./PanelHeader";

export const OverviewEdgePanel = ({ edge }: { edge: DerivedEdge }) => {
  const { model, askDeleteEdge, openFlow } = useArch();
  const nameOf = (id: string) => requireNode(model, id).name;
  const rows = edge.ids.flatMap((id) => {
    const real = model.edges.find((e) => e.id === id);
    return real ? [{ id, label: `${nameOf(real.from)} → ${nameOf(real.to)}` }] : [];
  });
  return (
    <>
      <PanelHeader
        title={`${nameOf(edge.from)} → ${nameOf(edge.to)}`}
        subtitle="Connection between layers"
        actions={
          <ToolButton small danger onClick={() => askDeleteEdge(edge.id)}>
            Delete
          </ToolButton>
        }
      />
      <InsertInfraSection
        edgeId={edge.id}
        description="Place a load balancer, gateway, cache or similar in the middle of this connection."
      />
      <PanelSection title="Connections inside">
        {rows.map((row) => (
          <FormRow key={row.id}>
            <span>{row.label}</span>
            <ToolButton small keepWidth onClick={() => openFlow(row.id)} aria-label={`Payload ${row.label}`}>
              Payload
            </ToolButton>
          </FormRow>
        ))}
        <HintText>Open a layer to edit the individual connections.</HintText>
      </PanelSection>
    </>
  );
};
