import { FN_TRIGGERS, allEndpoints, endpointById, endpointLabel, createEdge, reachableNodes, type FunctionNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, SelectInput } from "@/shared/components/atoms";
import { FormField, PanelSection } from "@/shared/components/molecules";
import { BoundJsonArea, BoundNumber, BoundSelect, BoundText } from "./Bound";
import { ArchNodeLinks } from "@/shared/components/molecules";
import type { Editor } from "./panelEditor";
import { StateLinks } from "./StateLinks";

interface Props {
  node: FunctionNode;
  editor: Editor;
}

const TriggerSection = ({ node, editor }: Props) => {
  const { cfg } = node;
  return (
    <PanelSection title="Trigger">
      <FormField label="Runs on">
        <BoundSelect editor={editor} path="cfg.trigger" value={cfg.trigger} options={FN_TRIGGERS} />
      </FormField>
      {cfg.trigger === "Polling" && (
        <FormField label="Interval (ms)">
          <BoundNumber editor={editor} path="cfg.interval" value={cfg.interval} />
        </FormField>
      )}
      {cfg.trigger === "On Component Change" && (
        <FormField label="Watches (comma separated state or props)">
          <BoundText editor={editor} path="cfg.deps" value={cfg.deps} />
        </FormField>
      )}
      {cfg.trigger === "WebSocket" && (
        <FormField label="Socket URL">
          <BoundText editor={editor} path="cfg.url" value={cfg.url} monospace />
        </FormField>
      )}
    </PanelSection>
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
      const wired = ref && reachableNodes(draft, target.id, "fwd", ["service"]).some((s) => s.id === ref.service.id);
      if (ref && !wired) draft.edges.push(createEdge(target.id, ref.service.id));
    });
  return (
    <PanelSection title="Calls">
      <FormField label="Endpoint">
        <SelectInput value={node.cfg.endpoint} options={options} onChange={chooseEndpoint} aria-label="Endpoint" />
      </FormField>
      <HintText>
        Attached to: <ArchNodeLinks nodes={reachableNodes(model, node.id, "bwd", ["component"])} />
      </HintText>
      <HintText>Choosing an endpoint draws the connection to its service. Insert caches or gateways on that connection.</HintText>
    </PanelSection>
  );
};

export const FunctionPanel = ({ node, editor }: Props) => {
  return (
    <>
      <TriggerSection node={node} editor={editor} />
      <CallSection node={node} editor={editor} />
      <PanelSection title="Data contract">
        <FormField label="Expects from the component, JSON">
          <BoundJsonArea editor={editor} path="cfg.input" value={node.cfg.input} rows={3} />
        </FormField>
        <FormField label="Sends onward, JSON (blank = pass the input through)">
          <BoundJsonArea editor={editor} path="cfg.output" value={node.cfg.output} rows={3} />
        </FormField>
      </PanelSection>
      <PanelSection title="Reads and modifies">
        <StateLinks node={node} editor={editor} />
      </PanelSection>
    </>
  );
};
