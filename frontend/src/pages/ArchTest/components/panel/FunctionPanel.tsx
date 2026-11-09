import { FN_TRIGGERS, allEndpoints, endpointById, endpointLabel, mkEdge, reach, type FunctionNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Field, Note, Section, SelectInput } from "../../ui/Controls";
import { BoundArea, BoundNumber, BoundSelect, BoundText } from "./Bound";
import { NodeLinks } from "../../ui/NodeLinks";
import type { Editor } from "./panelEditor";
import { StateLinks } from "./StateLinks";

interface Props {
  node: FunctionNode;
  editor: Editor;
}

const TriggerSection = ({ node, editor }: Props) => {
  const { cfg } = node;
  return (
    <Section title="Trigger">
      <Field label="Runs on">
        <BoundSelect editor={editor} path="cfg.trigger" value={cfg.trigger} options={FN_TRIGGERS} />
      </Field>
      {cfg.trigger === "Polling" && (
        <Field label="Interval (ms)">
          <BoundNumber editor={editor} path="cfg.interval" value={cfg.interval} />
        </Field>
      )}
      {cfg.trigger === "On Component Change" && (
        <Field label="Watches (comma separated state or props)">
          <BoundText editor={editor} path="cfg.deps" value={cfg.deps} />
        </Field>
      )}
      {cfg.trigger === "WebSocket" && (
        <Field label="Socket URL">
          <BoundText editor={editor} path="cfg.url" value={cfg.url} mono />
        </Field>
      )}
    </Section>
  );
};

const CallSection = ({ node, editor }: Props) => {
  const { model } = useArch();
  const options = [
    ["", "Nothing yet"] as const,
    ...allEndpoints(model).map(({ service, endpoint }) => [endpoint.id, `${service.name}  ${endpointLabel(endpoint)}`] as const),
  ];
  const chooseEndpoint = (endpointId: string) =>
    editor.edit<FunctionNode>((target, draft) => {
      target.cfg.endpoint = endpointId;
      const ref = endpointById(draft, endpointId);
      const wired = ref && reach(draft, target.id, "fwd", ["service"]).some((s) => s.id === ref.service.id);
      if (ref && !wired) draft.edges.push(mkEdge(target.id, ref.service.id));
    });
  return (
    <Section title="Calls">
      <Field label="Endpoint">
        <SelectInput value={node.cfg.endpoint} options={options} onChange={chooseEndpoint} aria-label="Endpoint" />
      </Field>
      <Note>
        Attached to: <NodeLinks nodes={reach(model, node.id, "bwd", ["component"])} />
      </Note>
      <Note>Choosing an endpoint draws the connection to its service. Insert caches or gateways on that connection.</Note>
    </Section>
  );
};

export const FunctionPanel = ({ node, editor }: Props) => {
  return (
    <>
      <TriggerSection node={node} editor={editor} />
      <CallSection node={node} editor={editor} />
      <Section title="Data contract">
        <Field label="Expects from the component, JSON">
          <BoundArea editor={editor} path="cfg.input" value={node.cfg.input} rows={3} json />
        </Field>
        <Field label="Sends onward, JSON (blank = pass the input through)">
          <BoundArea editor={editor} path="cfg.output" value={node.cfg.output} rows={3} json />
        </Field>
      </Section>
      <Section title="Reads and modifies">
        <StateLinks node={node} editor={editor} />
      </Section>
    </>
  );
};
