import { METHODS, VAR_TYPES, pathParamKeys, type Endpoint } from "../../engine";
import { Note, Row, Section, ToolButton } from "../../ui/Controls";
import { BoundArea, BoundCheck, BoundNumber, BoundSelect, BoundText } from "./Bound";
import type { Editor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";

interface Props {
  endpoint: Endpoint;
  /** Scoped to the endpoint: paths are relative to it. */
  editor: Editor;
}

const EndpointSection = ({ endpoint, editor }: Props) => (
  <Section title="Endpoint">
    <Row>
      <BoundSelect editor={editor} path="method" value={endpoint.method} options={METHODS} fixedWidth={92} aria-label="HTTP method" />
      <BoundText editor={editor} path="path" value={endpoint.path} mono aria-label="Path" />
    </Row>
    <BoundCheck
      editor={editor}
      path="single"
      checked={endpoint.single}
      label="Return a single object (first row, 404 if empty)"
    />
  </Section>
);

const HeadersSection = ({ endpoint, editor }: Props) => (
  <Section title="Request headers" action={<AddRowButton label="Add" editor={editor} path="headers" item={{ k: "", v: "" }} />}>
    <RowList
      items={endpoint.headers}
      path="headers"
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

const PathParamsSection = ({ endpoint, editor }: Props) => {
  const syncFromPath = () =>
    editor.edit<Endpoint>((target) => {
      pathParamKeys(target.path).forEach((k) => {
        if (!target.pathParams.some((p) => p.k === k)) target.pathParams.push({ k, type: "string" });
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
          <AddRowButton label="Add" editor={editor} path="pathParams" item={{ k: "", type: "string" }} />
        </span>
      }
    >
      <RowList
        items={endpoint.pathParams}
        path="pathParams"
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

const QueryParamsSection = ({ endpoint, editor }: Props) => (
  <Section
    title="Query parameters"
    action={<AddRowButton label="Add" editor={editor} path="query" item={{ k: "", type: "string", required: false }} />}
  >
    <RowList
      items={endpoint.query}
      path="query"
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

const ResponsesSection = ({ endpoint, editor }: Props) => (
  <Section title="Responses" action={<AddRowButton label="Add" editor={editor} path="responses" item={NEW_RESPONSE} />}>
    <RowList
      items={endpoint.responses}
      path="responses"
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

export const EndpointPanel = ({ endpoint, editor }: Props) => (
  <>
    <EndpointSection endpoint={endpoint} editor={editor} />
    <HeadersSection endpoint={endpoint} editor={editor} />
    <PathParamsSection endpoint={endpoint} editor={editor} />
    <QueryParamsSection endpoint={endpoint} editor={editor} />
    <Section title="Request body, JSON">
      <BoundArea editor={editor} path="body" value={endpoint.body} rows={4} json aria-label="Request body" />
    </Section>
    <ResponsesSection endpoint={endpoint} editor={editor} />
    <Section title="Response shape (optional)">
      <Note>
        Template for the body. $ is the query result, for example {'{"user":"$.profile"}'}. Leave blank to return the
        query result as is.
      </Note>
      <BoundArea editor={editor} path="responseMap" value={endpoint.responseMap} rows={4} json aria-label="Response shape" />
    </Section>
  </>
);
