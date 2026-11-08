import { REG, isContainer, type InfraBehaviour, type InfraNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Field, Note, Section } from "../../ui/Controls";
import { BoundNumber, BoundSelect, BoundText } from "./Bound";
import { NodeLinks } from "../../ui/NodeLinks";
import type { Editor } from "./panelEditor";

const BEHAVIOUR_NOTES: Record<InfraBehaviour, string> = {
  cache: "Caches the response that passes through it. Trace it twice (cold, then warm) to watch a miss become a hit.",
  lb: "Spreads requests across the nodes it points to.",
  gateway: "Authenticates and rate limits traffic on the way to the backend.",
  pass: "Passes requests through unchanged. Connect it to the next hop.",
};

export const InfraPanel = ({ node, editor }: { node: InfraNode; editor: Editor }) => {
  const { model } = useArch();
  const entry = REG[node.type];
  const fields = entry.fields ?? [];
  return (
    <>
      <Section title="Configuration">
        {fields.map((field) => (
          <Field key={field.k} label={field.label}>
            {field.t === "select" ? (
              <BoundSelect editor={editor} path={`cfg.${field.k}`} value={node.cfg[field.k]} options={field.opts ?? []} />
            ) : field.t === "number" ? (
              <BoundNumber editor={editor} path={`cfg.${field.k}`} value={node.cfg[field.k]} />
            ) : (
              <BoundText editor={editor} path={`cfg.${field.k}`} value={node.cfg[field.k]} />
            )}
          </Field>
        ))}
        <Note>{BEHAVIOUR_NOTES[entry.beh ?? "pass"]}</Note>
      </Section>
      {isContainer(node) && (
        <Section title="Contains">
          <Note>
            Drag a box onto this container to place it inside. Moving or resizing the container carries what is inside.
          </Note>
          <Note>
            <NodeLinks nodes={model.nodes.filter((c) => c.parent === node.id)} />
          </Note>
        </Section>
      )}
    </>
  );
};
