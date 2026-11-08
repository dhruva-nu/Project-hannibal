import { METHODS, VAR_TYPES, pathParamKeys, reach, type ApiNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Note, Row, Section, ToolButton } from "../../ui/Controls";
import { BoundArea, BoundCheck, BoundNumber, BoundSelect, BoundText } from "./Bound";
import { NodeLinks } from "../../ui/NodeLinks";
import type { Editor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";

interface Props {
  node: ApiNode;
  editor: Editor;
}

const EndpointSection = ({ node, editor }: Props) => (
  <Section title="Endpoint">
    <Row>
      <BoundSelect editor={editor} path="cfg.method" value={node.cfg.method} options={METHODS} fixedWidth={92} aria-label="HTTP method" />
      <BoundText editor={editor} path="cfg.path" value={node.cfg.path} mono aria-label="Path" />
    </Row>
    <BoundCheck
      editor={editor}
      path="cfg.single"
      checked={node.cfg.single}
      label="Return a single object (first connector row, 404 if empty)"
    />
  </Section>
);

const HeadersSection = ({ node, editor }: Props) => (
  <Section title="Request headers" action={<AddRowButton label="Add" editor={editor} path="cfg.headers" item={{ k: "", v: "" }} />}>
    <RowList
      items={node.cfg.headers}
      path="cfg.headers"
      editor={editor}
      emptyNote="No headers."
      renderRow={(header, _i, rowPath, removeButton) => (
        <Row>
          <BoundText editor={editor} path={`${rowPath}.k`} value={header.k} mono placeholder="name" aria-label="Header name" />
          <BoundText editor={editor} path={`${rowPath}.v`} value={header.v} mono placeholder="value" aria-label="Header value" />
          {removeButton}
        </Row>
      )}
    />
  </Section>
);

const PathParamsSection = ({ node, editor }: Props) => {
  const syncFromPath = () =>
    editor.edit<ApiNode>((target) => {
      pathParamKeys(target.cfg.path).forEach((k) => {
        if (!target.cfg.pathParams.some((p) => p.k === k)) target.cfg.pathParams.push({ k, type: "string" });
      });
    });
  return (
    <Section
      title="Path parameters"
      action={
        <span>
          <ToolButton small onClick={syncFromPath}>
            Sync from path
          </ToolButton>{" "}
          <AddRowButton label="Add" editor={editor} path="cfg.pathParams" item={{ k: "", type: "string" }} />
        </span>
      }
    >
      <RowList
        items={node.cfg.pathParams}
        path="cfg.pathParams"
        editor={editor}
        emptyNote="None."
        renderRow={(param, _i, rowPath, removeButton) => (
          <Row>
            <BoundText editor={editor} path={`${rowPath}.k`} value={param.k} mono aria-label="Path parameter name" />
            <BoundSelect editor={editor} path={`${rowPath}.type`} value={param.type} options={VAR_TYPES} fixedWidth={92} aria-label="Path parameter type" />
            {removeButton}
          </Row>
        )}
      />
    </Section>
  );
};

const QueryParamsSection = ({ node, editor }: Props) => (
  <Section
    title="Query parameters"
    action={<AddRowButton label="Add" editor={editor} path="cfg.query" item={{ k: "", type: "string", required: false }} />}
  >
    <RowList
      items={node.cfg.query}
      path="cfg.query"
      editor={editor}
      emptyNote="None."
      renderRow={(param, _i, rowPath, removeButton) => (
        <Row>
          <BoundText editor={editor} path={`${rowPath}.k`} value={param.k} mono aria-label="Query parameter name" />
          <BoundSelect editor={editor} path={`${rowPath}.type`} value={param.type} options={VAR_TYPES} fixedWidth={92} aria-label="Query parameter type" />
          <BoundCheck editor={editor} path={`${rowPath}.required`} checked={param.required} label="required" fixed />
          {removeButton}
        </Row>
      )}
    />
  </Section>
);

const NEW_RESPONSE = { status: 400, desc: "Bad request", body: '{\n  "error": "Bad request"\n}' };

const ResponsesSection = ({ node, editor }: Props) => (
  <Section title="Responses" action={<AddRowButton label="Add" editor={editor} path="cfg.responses" item={NEW_RESPONSE} />}>
    <RowList
      items={node.cfg.responses}
      path="cfg.responses"
      editor={editor}
      renderRow={(response, _i, rowPath, removeButton) => (
        <div>
          <Row>
            <BoundNumber editor={editor} path={`${rowPath}.status`} value={response.status} fixedWidth={72} aria-label="Response status" />
            <BoundText editor={editor} path={`${rowPath}.desc`} value={response.desc} placeholder="description" aria-label="Response description" />
            {removeButton}
          </Row>
          <BoundArea editor={editor} path={`${rowPath}.body`} value={response.body} rows={3} json aria-label="Response body" />
        </div>
      )}
    />
  </Section>
);

export const ApiPanel = ({ node, editor }: Props) => {
  const { model } = useArch();
  return (
    <>
      <EndpointSection node={node} editor={editor} />
      <HeadersSection node={node} editor={editor} />
      <PathParamsSection node={node} editor={editor} />
      <QueryParamsSection node={node} editor={editor} />
      <Section title="Request body, JSON">
        <BoundArea editor={editor} path="cfg.body" value={node.cfg.body} rows={4} json aria-label="Request body" />
      </Section>
      <ResponsesSection node={node} editor={editor} />
      <Section title="Response shape (optional)">
        <Note>
          Template for the body. $ is the connector result, for example {'{"user":"$.profile"}'}. Leave blank to return the
          connector result as is.
        </Note>
        <BoundArea editor={editor} path="cfg.responseMap" value={node.cfg.responseMap} rows={4} json aria-label="Response shape" />
      </Section>
      <Section title="Relationships">
        <Note>
          Used by components: <NodeLinks nodes={reach(model, node.id, "bwd", ["component"])} />
        </Note>
        <Note>
          Calls connectors: <NodeLinks nodes={reach(model, node.id, "fwd", ["connector"])} />
        </Note>
      </Section>
    </>
  );
};
