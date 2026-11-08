import { FN_TRIGGERS, reach, type FunctionNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Field, Note, Section } from "../../ui/Controls";
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

export const FunctionPanel = ({ node, editor }: Props) => {
  const { model } = useArch();
  return (
    <>
      <TriggerSection node={node} editor={editor} />
      <Section title="Data contract">
        <Field label="Expects from the component, JSON">
          <BoundArea editor={editor} path="cfg.input" value={node.cfg.input} rows={3} json />
        </Field>
        <Field label="Sends onward, JSON (blank = pass the input through)">
          <BoundArea editor={editor} path="cfg.output" value={node.cfg.output} rows={3} json />
        </Field>
      </Section>
      <Section title="Connected">
        <Note>
          Attached to: <NodeLinks nodes={reach(model, node.id, "bwd", ["component"])} />
        </Note>
        <Note>
          Calls: <NodeLinks nodes={reach(model, node.id, "fwd", ["api"])} />
        </Note>
        <Note>Draw a connection from this function to an API, or to infrastructure such as TanStack Query first.</Note>
      </Section>
      <Section title="State">
        <StateLinks node={node} editor={editor} />
      </Section>
    </>
  );
};
