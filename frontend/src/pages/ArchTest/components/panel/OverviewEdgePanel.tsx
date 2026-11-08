import { node, type DerivedEdge } from "../../engine";
import { useArch } from "../../state/archApi";
import { Note, Row, Section, ToolButton } from "../../ui/Controls";
import { InsertInfraSection } from "./InsertInfraSection";
import { PanelHeader } from "./PanelHeader";

export const OverviewEdgePanel = ({ edge }: { edge: DerivedEdge }) => {
  const { model, askDeleteEdge, openFlow } = useArch();
  const nameOf = (id: string) => node(model, id)?.name ?? "?";
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
      <Section title="Connections inside">
        {rows.map((row) => (
          <Row key={row.id}>
            <span>{row.label}</span>
            <ToolButton small fixed onClick={() => openFlow(row.id)} aria-label={`Payload ${row.label}`}>
              Payload
            </ToolButton>
          </Row>
        ))}
        <Note>Open a layer to edit the individual connections.</Note>
      </Section>
    </>
  );
};
