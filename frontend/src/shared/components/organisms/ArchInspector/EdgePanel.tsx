import { edgeInfo, requireNode, toPrettyJson, warnText, type ArchEdge } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { Callout, CodeBlock, FieldCaption, HintText, ToolButton } from "@/shared/components/atoms";
import { FixedCell, FormField, FormRow, PanelSection } from "@/shared/components/molecules";
import { BoundText } from "./Bound";
import { InsertInfraSection } from "./InsertInfraSection";
import { PanelHeader } from "./PanelHeader";
import { useEditor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";

export const EdgePanel = ({ edge }: { edge: ArchEdge }) => {
  const { model, flow, flipEdge, askDeleteEdge, openFlow } = useArch();
  const editor = useEditor("edge", edge.id);
  const source = requireNode(model, edge.from);
  const target = requireNode(model, edge.to);
  const info = edgeInfo(model, flow, edge);
  const title = `${source.name} → ${target.name}`;
  return (
    <>
      <PanelHeader
        title={title}
        subtitle="Connection"
        actions={
          <>
            <ToolButton small onClick={() => flipEdge(edge.id)}>
              Flip direction
            </ToolButton>
            <ToolButton small danger onClick={() => askDeleteEdge(edge.id)}>
              Delete
            </ToolButton>
          </>
        }
      />
      <PanelSection title="General">
        <FormField label="Label">
          <BoundText editor={editor} path="label" value={edge.label} placeholder="optional" />
        </FormField>
      </PanelSection>
      <InsertInfraSection
        edgeId={edge.id}
        description="Place a cache, load balancer, gateway or other component in the middle of this connection."
      />
      <PanelSection
        title="Field mapping"
        action={<AddRowButton label="Add mapping" editor={editor} path="map" item={{ from: "", to: "", value: "" }} />}
      >
        <HintText>
          Rename a field, or add a constant when the source has no value for it. Fields left alone pass through unchanged.
        </HintText>
        <RowList
          items={edge.map}
          path="map"
          editor={editor}
          renderRow={(mapping, _i, rowPath, removeButton) => (
            <FormRow>
              <BoundText editor={editor} path={`${rowPath}.from`} value={mapping.from} monospace placeholder="from field" aria-label="From field" />
              <FixedCell>→</FixedCell>
              <BoundText editor={editor} path={`${rowPath}.to`} value={mapping.to} monospace placeholder="to field" aria-label="To field" />
              <BoundText editor={editor} path={`${rowPath}.value`} value={mapping.value} monospace placeholder="or constant" aria-label="Constant value" />
              {removeButton}
            </FormRow>
          )}
        />
      </PanelSection>
      <PanelSection title="Data on this connection">
        {info.warns.length ? (
          <Callout tone="warning">
            <b>Schema mismatch</b>
            {info.warns.map((w) => (
              <div key={w.path + w.kind}>{warnText(w)}</div>
            ))}
          </Callout>
        ) : (
          <Callout tone="success">The payload matches what {target.name} expects.</Callout>
        )}
        <FieldCaption>Request</FieldCaption>
        <CodeBlock>{toPrettyJson(info.req)}</CodeBlock>
        {info.res !== undefined && (
          <>
            <FieldCaption>Response</FieldCaption>
            <CodeBlock>{toPrettyJson(info.res)}</CodeBlock>
          </>
        )}
        <ToolButton small onClick={() => openFlow(edge.id)}>
          Compare fields
        </ToolButton>
      </PanelSection>
    </>
  );
};
