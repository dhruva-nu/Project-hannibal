import { useState } from "react";
import { FN_TRIGGERS, attachedFunctions, endpointById, endpointLabel, type ComponentNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, LinkButton, Pill, SelectInput, ToolButton } from "@/shared/components/atoms";
import { FixedCell, FormField, FormRow, PanelSection } from "@/shared/components/molecules";
import { BoundJsonArea, BoundText } from "./Bound";
import type { Editor } from "./panelEditor";
import { StateLinks } from "./StateLinks";
import { VariableList } from "./VariableList";

interface Props {
  node: ComponentNode;
  editor: Editor;
}

const FunctionsSection = ({ node, editor }: Props) => {
  const { model, reveal, connect, addFunctionTo } = useArch();
  const [trigger, setTrigger] = useState<string>(FN_TRIGGERS[0]);
  const [attachChoice, setAttachChoice] = useState("");
  const attached = attachedFunctions(model, node.id);
  const free = model.nodes.filter((n) => n.type === "function" && !attached.some((f) => f.id === n.id));
  const attachTarget = free.some((f) => f.id === attachChoice) ? attachChoice : free[0]?.id;

  const detach = (functionId: string) =>
    editor.edit<ComponentNode>((_target, draft) => {
      draft.edges = draft.edges.filter((e) => !(e.from === node.id && e.to === functionId));
    });

  return (
    <PanelSection title="Functions">
      <HintText>Functions run on lifecycle events and call service endpoints. The tracer runs them in this order.</HintText>
      {attached.length ? (
        attached.map((fn) => (
          <FormRow key={fn.id}>
            <FixedCell>
              <Pill>{fn.cfg.trigger}</Pill>
            </FixedCell>
            <LinkButton onClick={() => reveal(fn.id)}>{fn.name}</LinkButton>
            <ToolButton small keepWidth onClick={() => detach(fn.id)} aria-label={`Detach ${fn.name}`}>
              Detach
            </ToolButton>
          </FormRow>
        ))
      ) : (
        <HintText>No functions attached.</HintText>
      )}
      <FormRow>
        <SelectInput aria-label="New function trigger" value={trigger} options={FN_TRIGGERS} onChange={setTrigger} />
        <ToolButton small keepWidth onClick={() => addFunctionTo(node.id, trigger)}>
          Add function
        </ToolButton>
      </FormRow>
      {attachTarget && (
        <FormRow>
          <SelectInput
            aria-label="Existing function"
            value={attachTarget}
            options={free.map((f) => [f.id, f.name] as const)}
            onChange={setAttachChoice}
          />
          <ToolButton small keepWidth onClick={() => connect(node.id, attachTarget, false)}>
            Attach existing
          </ToolButton>
        </FormRow>
      )}
    </PanelSection>
  );
};

const EndpointsUsedSection = ({ node }: { node: ComponentNode }) => {
  const { model, reveal, focusEndpoint } = useArch();
  const used = attachedFunctions(model, node.id)
    .map((fn) => endpointById(model, fn.cfg.endpoint))
    .filter((ref) => ref !== undefined);
  return (
    <PanelSection title="Data comes from">
      {used.length ? (
        used.map(({ service, endpoint }) => (
          <FormRow key={endpoint.id}>
            <LinkButton
              onClick={() => {
                reveal(service.id);
                focusEndpoint(endpoint.id);
              }}
            >
              {endpointLabel(endpoint)}
            </LinkButton>
            <FixedCell>
              <Pill>{service.name}</Pill>
            </FixedCell>
          </FormRow>
        ))
      ) : (
        <HintText>None of this component's functions call an endpoint yet.</HintText>
      )}
    </PanelSection>
  );
};

export const ComponentPanel = ({ node, editor }: Props) => {
  return (
    <>
      <PanelSection title="Data contract">
        <FormField label="Short description of the data it expects">
          <BoundText editor={editor} path="cfg.desc" value={node.cfg.desc} />
        </FormField>
        <FormField label="Expected input, JSON">
          <BoundJsonArea editor={editor} path="cfg.input" value={node.cfg.input} rows={6} />
        </FormField>
        <FormField label="Output sent when the user interacts, JSON">
          <BoundJsonArea editor={editor} path="cfg.output" value={node.cfg.output} rows={4} />
        </FormField>
      </PanelSection>
      <FunctionsSection node={node} editor={editor} />
      <EndpointsUsedSection node={node} />
      <PanelSection title="Local state">
        <VariableList items={node.cfg.state} path="cfg.state" editor={editor} emptyNote="No local state. Values only this component uses go here." />
      </PanelSection>
      <PanelSection title="Reads and modifies">
        <StateLinks node={node} editor={editor} />
      </PanelSection>
    </>
  );
};
