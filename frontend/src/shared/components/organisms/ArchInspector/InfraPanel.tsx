import { NODE_REGISTRY, isContainer, type InfraBehaviour, type InfraNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText } from "@/shared/components/atoms";
import { FormField, PanelSection } from "@/shared/components/molecules";
import { BoundNumber, BoundSelect, BoundText } from "./Bound";
import { ArchNodeLinks } from "@/shared/components/molecules";
import type { Editor } from "./panelEditor";

const BEHAVIOUR_NOTES: Record<InfraBehaviour, string> = {
  cache: "Caches the response that passes through it. Trace it twice (cold, then warm) to watch a miss become a hit.",
  lb: "Spreads requests across the nodes it points to.",
  gateway: "Authenticates and rate limits traffic on the way to the backend.",
  pass: "Passes requests through unchanged. Connect it to the next hop.",
};

export const InfraPanel = ({ node, editor }: { node: InfraNode; editor: Editor }) => {
  const { model } = useArch();
  const entry = NODE_REGISTRY[node.type];
  return (
    <>
      <PanelSection title="Configuration">
        {entry.fields.map((field) => (
          <FormField key={field.k} label={field.label}>
            {field.t === "select" ? (
              <BoundSelect editor={editor} path={`cfg.${field.k}`} value={node.cfg[field.k]} options={field.opts} />
            ) : field.t === "number" ? (
              <BoundNumber editor={editor} path={`cfg.${field.k}`} value={node.cfg[field.k]} />
            ) : (
              <BoundText editor={editor} path={`cfg.${field.k}`} value={node.cfg[field.k]} />
            )}
          </FormField>
        ))}
        <HintText>{BEHAVIOUR_NOTES[entry.beh]}</HintText>
      </PanelSection>
      {isContainer(node) && (
        <PanelSection title="Contains">
          <HintText>
            Drag a box onto this container to place it inside. Moving or resizing the container carries what is inside.
          </HintText>
          <HintText>
            <ArchNodeLinks nodes={model.nodes.filter((c) => c.parent === node.id)} />
          </HintText>
        </PanelSection>
      )}
    </>
  );
};
