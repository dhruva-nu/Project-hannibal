import { newAppServiceCall, newQueryCall, stepSummary, type Endpoint, type EndpointCall, type ServiceNode } from "../../engine";
import { Note, Section, SelectInput, ToolButton } from "../../ui/Controls";
import type { Editor } from "../panel/panelEditor";
import styles from "./popup.module.css";

interface Props {
  node: ServiceNode;
  endpoint: Endpoint;
  editor: Editor;
}

const describeCall = (node: ServiceNode, call: EndpointCall): { title: string; steps: string } => {
  if (call.kind === "query") return { title: "Database query", steps: "Built in the data source section below" };
  const service = node.cfg.appServices.find((a) => a.id === call.appServiceId);
  if (!service) throw new Error(`Call "${call.id}" points at a missing in-app service`);
  return { title: service.name, steps: service.steps.map(stepSummary).join(" → ") || "No steps yet" };
};

const moveCall = (editor: Editor, index: number, by: -1 | 1) =>
  editor.edit<Endpoint>((target) => {
    const [call] = target.calls.splice(index, 1);
    target.calls.splice(index + by, 0, call);
  });

export const CallChain = ({ node, endpoint, editor }: Props) => {
  const hasQuery = endpoint.calls.some((c) => c.kind === "query");
  const addOptions = [
    ["", "Add a call…"] as const,
    ...(hasQuery ? [] : [["query", "Database query"] as const]),
    ...node.cfg.appServices.map((a) => [a.id, `In-app service: ${a.name}`] as const),
  ];
  const addCall = (value: string) => {
    if (!value) return;
    editor.push("calls", value === "query" ? newQueryCall() : newAppServiceCall(value));
  };
  return (
    <Section title="Calls, in order" action={<SelectInput value="" options={addOptions} onChange={addCall} aria-label="Add a call" />}>
      {!endpoint.calls.length && <Note>This endpoint calls nothing yet; it returns its sample response.</Note>}
      {endpoint.calls.map((call, index) => {
        const { title, steps } = describeCall(node, call);
        return (
          <div key={call.id} className={styles.callRow}>
            <span className={styles.callIndex}>{index + 1}</span>
            <div className={styles.callLabel}>
              <div>{title}</div>
              <div className={styles.callSteps}>{steps}</div>
            </div>
            <ToolButton small fixed disabled={index === 0} onClick={() => moveCall(editor, index, -1)} aria-label={`Move ${title} up`}>
              ↑
            </ToolButton>
            <ToolButton
              small
              fixed
              disabled={index === endpoint.calls.length - 1}
              onClick={() => moveCall(editor, index, 1)}
              aria-label={`Move ${title} down`}
            >
              ↓
            </ToolButton>
            <ToolButton small fixed onClick={() => editor.remove("calls", index)} aria-label={`Remove call ${title}`}>
              ✕
            </ToolButton>
          </div>
        );
      })}
    </Section>
  );
};
