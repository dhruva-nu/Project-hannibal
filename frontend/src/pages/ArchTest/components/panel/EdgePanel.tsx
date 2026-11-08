import { edgeInfo, node, pretty, warnText, type ArchEdge } from "../../engine";
import { useArch } from "../../state/archApi";
import { Code, Field, FieldCaption, Fixed, Note, OkBox, Row, Section, ToolButton, WarnBox } from "../../ui/Controls";
import { BoundText } from "./Bound";
import { InsertInfraSection } from "./InsertInfraSection";
import { PanelHeader } from "./PanelHeader";
import { useEditor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";

export const EdgePanel = ({ edge }: { edge: ArchEdge }) => {
  const { model, flow, flipEdge, askDeleteEdge, openFlow } = useArch();
  const editor = useEditor("edge", edge.id);
  const source = node(model, edge.from);
  const target = node(model, edge.to);
  const info = edgeInfo(model, flow, edge);
  const title = `${source?.name ?? "?"} → ${target?.name ?? "?"}`;
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
      <Section title="General">
        <Field label="Label">
          <BoundText editor={editor} path="label" value={edge.label} placeholder="optional" />
        </Field>
      </Section>
      <InsertInfraSection
        edgeId={edge.id}
        description="Place a cache, load balancer, gateway or other component in the middle of this connection."
      />
      <Section
        title="Field mapping"
        action={<AddRowButton label="Add mapping" editor={editor} path="map" item={{ from: "", to: "", value: "" }} />}
      >
        <Note>
          Rename a field, or add a constant when the source has no value for it. Fields left alone pass through unchanged.
        </Note>
        <RowList
          items={edge.map}
          path="map"
          editor={editor}
          renderRow={(mapping, _i, rowPath, removeButton) => (
            <Row>
              <BoundText editor={editor} path={`${rowPath}.from`} value={mapping.from} mono placeholder="from field" aria-label="From field" />
              <Fixed>→</Fixed>
              <BoundText editor={editor} path={`${rowPath}.to`} value={mapping.to} mono placeholder="to field" aria-label="To field" />
              <BoundText editor={editor} path={`${rowPath}.value`} value={mapping.value} mono placeholder="or constant" aria-label="Constant value" />
              {removeButton}
            </Row>
          )}
        />
      </Section>
      <Section title="Data on this connection">
        {info.warns.length ? (
          <WarnBox>
            <b>Schema mismatch</b>
            {info.warns.map((w) => (
              <div key={w.path + w.kind}>{warnText(w)}</div>
            ))}
          </WarnBox>
        ) : (
          <OkBox>The payload matches what {target?.name} expects.</OkBox>
        )}
        <FieldCaption>Request</FieldCaption>
        <Code>{pretty(info.req)}</Code>
        {info.res !== undefined && (
          <>
            <FieldCaption>Response</FieldCaption>
            <Code>{pretty(info.res)}</Code>
          </>
        )}
        <ToolButton small onClick={() => openFlow(edge.id)}>
          Compare fields
        </ToolButton>
      </Section>
    </>
  );
};
