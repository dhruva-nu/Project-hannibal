import { METHODS, VAR_TYPES, pathParamKeys, type Endpoint } from "@/pages/ArchTest/engine";
import { HintText, ToolButton } from "@/shared/components/atoms";
import { FormRow, PanelSection } from "@/shared/components/molecules";
import { BoundJsonArea, BoundCheck, BoundNumber, BoundSelect, BoundText } from "./Bound";
import type { Editor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";

interface Props {
  endpoint: Endpoint;
  /** Scoped to the endpoint: paths are relative to it. */
  editor: Editor;
}

const EndpointSection = ({ endpoint, editor }: Props) => (
  <PanelSection title="Endpoint">
    <FormRow>
      <BoundSelect editor={editor} path="method" value={endpoint.method} options={METHODS} width={92} aria-label="HTTP method" />
      <BoundText editor={editor} path="path" value={endpoint.path} monospace aria-label="Path" />
    </FormRow>
    <BoundCheck
      editor={editor}
      path="single"
      checked={endpoint.single}
      label="Return a single object (first row, 404 if empty)"
    />
  </PanelSection>
);

const HeadersSection = ({ endpoint, editor }: Props) => (
  <PanelSection title="Request headers" action={<AddRowButton label="Add" editor={editor} path="headers" item={{ k: "", v: "" }} />}>
    <RowList
      items={endpoint.headers}
      path="headers"
      editor={editor}
      emptyNote="No headers."
      renderRow={(header, _i, rowPath, removeButton) => (
        <FormRow>
          <BoundText editor={editor} path={`${rowPath}.k`} value={header.k} monospace placeholder="name" aria-label="Header name" />
          <BoundText editor={editor} path={`${rowPath}.v`} value={header.v} monospace placeholder="value" aria-label="Header value" />
          {removeButton}
        </FormRow>
      )}
    />
  </PanelSection>
);

const PathParamsSection = ({ endpoint, editor }: Props) => {
  const syncFromPath = () =>
    editor.edit<Endpoint>((target) => {
      pathParamKeys(target.path).forEach((k) => {
        if (!target.pathParams.some((p) => p.k === k)) target.pathParams.push({ k, type: "string" });
      });
    });
  return (
    <PanelSection
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
          <FormRow>
            <BoundText editor={editor} path={`${rowPath}.k`} value={param.k} monospace aria-label="Path parameter name" />
            <BoundSelect editor={editor} path={`${rowPath}.type`} value={param.type} options={VAR_TYPES} width={92} aria-label="Path parameter type" />
            {removeButton}
          </FormRow>
        )}
      />
    </PanelSection>
  );
};

const QueryParamsSection = ({ endpoint, editor }: Props) => (
  <PanelSection
    title="Query parameters"
    action={<AddRowButton label="Add" editor={editor} path="query" item={{ k: "", type: "string", required: false }} />}
  >
    <RowList
      items={endpoint.query}
      path="query"
      editor={editor}
      emptyNote="None."
      renderRow={(param, _i, rowPath, removeButton) => (
        <FormRow>
          <BoundText editor={editor} path={`${rowPath}.k`} value={param.k} monospace aria-label="Query parameter name" />
          <BoundSelect editor={editor} path={`${rowPath}.type`} value={param.type} options={VAR_TYPES} width={92} aria-label="Query parameter type" />
          <BoundCheck editor={editor} path={`${rowPath}.required`} checked={param.required} label="required" keepWidth />
          {removeButton}
        </FormRow>
      )}
    />
  </PanelSection>
);

const NEW_RESPONSE = { status: 400, desc: "Bad request", body: '{\n  "error": "Bad request"\n}' };

const ResponsesSection = ({ endpoint, editor }: Props) => (
  <PanelSection title="Responses" action={<AddRowButton label="Add" editor={editor} path="responses" item={NEW_RESPONSE} />}>
    <RowList
      items={endpoint.responses}
      path="responses"
      editor={editor}
      renderRow={(response, _i, rowPath, removeButton) => (
        <div>
          <FormRow>
            <BoundNumber editor={editor} path={`${rowPath}.status`} value={response.status} width={72} aria-label="Response status" />
            <BoundText editor={editor} path={`${rowPath}.desc`} value={response.desc} placeholder="description" aria-label="Response description" />
            {removeButton}
          </FormRow>
          <BoundJsonArea editor={editor} path={`${rowPath}.body`} value={response.body} rows={3} aria-label="Response body" />
        </div>
      )}
    />
  </PanelSection>
);

export const EndpointPanel = ({ endpoint, editor }: Props) => (
  <>
    <EndpointSection endpoint={endpoint} editor={editor} />
    <HeadersSection endpoint={endpoint} editor={editor} />
    <PathParamsSection endpoint={endpoint} editor={editor} />
    <QueryParamsSection endpoint={endpoint} editor={editor} />
    <PanelSection title="Request body, JSON">
      <BoundJsonArea editor={editor} path="body" value={endpoint.body} rows={4} aria-label="Request body" />
    </PanelSection>
    <ResponsesSection endpoint={endpoint} editor={editor} />
    <PanelSection title="Response shape (optional)">
      <HintText>
        Template for the body. $ is the query result, for example {'{"user":"$.profile"}'}. Leave blank to return the
        query result as is.
      </HintText>
      <BoundJsonArea editor={editor} path="responseMap" value={endpoint.responseMap} rows={4} aria-label="Response shape" />
    </PanelSection>
  </>
);
