import { useState } from "react";
import { FN_TRIGGERS, attachedFns, reach, type ComponentNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Field, Fixed, LinkButton, Note, Row, Section, SelectInput, Tag, ToolButton } from "../../ui/Controls";
import { BoundArea, BoundText } from "./Bound";
import { NodeLinks } from "../../ui/NodeLinks";
import type { Editor } from "./panelEditor";
import { StateLinks } from "./StateLinks";

interface Props {
  node: ComponentNode;
  editor: Editor;
}

const FunctionsSection = ({ node, editor }: Props) => {
  const { model, reveal, connect, addFunctionTo } = useArch();
  const [trigger, setTrigger] = useState<string>(FN_TRIGGERS[0]);
  const [attachChoice, setAttachChoice] = useState("");
  const attached = attachedFns(model, node.id);
  const free = model.nodes.filter((n) => n.type === "function" && !attached.some((f) => f.id === n.id));
  const attachTarget = free.some((f) => f.id === attachChoice) ? attachChoice : free[0]?.id;

  const detach = (functionId: string) =>
    editor.edit<ComponentNode>((_target, draft) => {
      draft.edges = draft.edges.filter((e) => !(e.from === node.id && e.to === functionId));
    });

  return (
    <Section title="Functions">
      <Note>Functions run on lifecycle events and call your APIs. The tracer runs them in this order.</Note>
      {attached.length ? (
        attached.map((fn) => (
          <Row key={fn.id}>
            <Fixed>
              <Tag>{fn.cfg.trigger}</Tag>
            </Fixed>
            <LinkButton onClick={() => reveal(fn.id)}>{fn.name}</LinkButton>
            <ToolButton small fixed onClick={() => detach(fn.id)} aria-label={`Detach ${fn.name}`}>
              Detach
            </ToolButton>
          </Row>
        ))
      ) : (
        <Note>No functions attached.</Note>
      )}
      <Row>
        <SelectInput aria-label="New function trigger" value={trigger} options={FN_TRIGGERS} onChange={setTrigger} />
        <ToolButton small fixed onClick={() => addFunctionTo(node.id, trigger)}>
          Add function
        </ToolButton>
      </Row>
      {attachTarget && (
        <Row>
          <SelectInput
            aria-label="Existing function"
            value={attachTarget}
            options={free.map((f) => [f.id, f.name] as const)}
            onChange={setAttachChoice}
          />
          <ToolButton small fixed onClick={() => connect(node.id, attachTarget, false)}>
            Attach existing
          </ToolButton>
        </Row>
      )}
    </Section>
  );
};

export const ComponentPanel = ({ node, editor }: Props) => {
  const { model } = useArch();
  return (
    <>
      <Section title="Data contract">
        <Field label="Short description of the data it expects">
          <BoundText editor={editor} path="cfg.desc" value={node.cfg.desc} />
        </Field>
        <Field label="Expected input, JSON">
          <BoundArea editor={editor} path="cfg.input" value={node.cfg.input} rows={6} json />
        </Field>
        <Field label="Output sent when the user interacts, JSON">
          <BoundArea editor={editor} path="cfg.output" value={node.cfg.output} rows={4} json />
        </Field>
      </Section>
      <FunctionsSection node={node} editor={editor} />
      <Section title="Data comes from">
        <Note>Backend APIs that can provide data to this component:</Note>
        <NodeLinks nodes={reach(model, node.id, "fwd", ["api"])} />
      </Section>
      <Section title="State">
        <StateLinks node={node} editor={editor} />
      </Section>
    </>
  );
};
