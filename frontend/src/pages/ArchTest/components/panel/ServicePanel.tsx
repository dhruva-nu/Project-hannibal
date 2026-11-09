import {
  FRAMEWORKS,
  callersOf,
  newEndpoint,
  reach,
  type Endpoint,
  type ServiceNode,
} from "../../engine";
import { useArch } from "../../state/archApi";
import { MethodBadge, Note, Section, ToolButton } from "../../ui/Controls";
import { NodeLinks } from "../../ui/NodeLinks";
import { BoundSelect } from "./Bound";
import { EndpointPanel } from "./EndpointPanel";
import { EndpointQueryPanel } from "./EndpointQueryPanel";
import { scopeEditor, type Editor } from "./panelEditor";
import styles from "./panel.module.css";

interface Props {
  node: ServiceNode;
  editor: Editor;
}

const EndpointRow = ({ endpoint, open, onToggle, onRemove }: {
  endpoint: Endpoint;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) => (
  <div className={styles.endpointRow} data-open={open}>
    <button type="button" className={styles.endpointToggle} onClick={onToggle} aria-expanded={open}>
      <MethodBadge method={endpoint.method} />
      <code className={styles.endpointPath}>{endpoint.path}</code>
      <span className={styles.chevron} aria-hidden="true">
        {open ? "▾" : "▸"}
      </span>
    </button>
    <ToolButton small fixed onClick={onRemove} aria-label={`Remove ${endpoint.method} ${endpoint.path}`}>
      ✕
    </ToolButton>
  </div>
);

const OpenEndpoint = ({ node, endpoint, editor }: Props & { endpoint: Endpoint }) => {
  const scoped = scopeEditor(editor, `${node.id}:${endpoint.id}`, (target: ServiceNode) => {
    const found = target.cfg.endpoints.find((e) => e.id === endpoint.id);
    if (!found) throw new Error(`Endpoint "${endpoint.id}" no longer exists`);
    return found;
  });
  const { model } = useArch();
  return (
    <div className={styles.endpointBody}>
      <Note>
        Called by: <NodeLinks nodes={callersOf(model, endpoint.id)} />
      </Note>
      <EndpointPanel endpoint={endpoint} editor={scoped} />
      <EndpointQueryPanel endpoint={endpoint} editor={scoped} serviceId={node.id} />
    </div>
  );
};

const EndpointsSection = ({ node, editor }: Props) => {
  const { model, endpointFocus, focusEndpoint } = useArch();
  const addEndpoint = () => {
    const db = reach(model, node.id, "fwd", ["sqldb", "nosql"])[0];
    const created = newEndpoint({ path: `/endpoint${node.cfg.endpoints.length + 1}`, pathParams: [], dbId: db?.id ?? "" });
    editor.push("cfg.endpoints", created);
    focusEndpoint(created.id);
  };
  const removeEndpoint = (index: number, id: string) => {
    editor.remove("cfg.endpoints", index);
    if (endpointFocus === id) focusEndpoint(null);
  };
  return (
    <Section title="Endpoints" action={<ToolButton small onClick={addEndpoint}>Add endpoint</ToolButton>}>
      {!node.cfg.endpoints.length && <Note>No endpoints yet. Add the routes this service exposes.</Note>}
      {node.cfg.endpoints.map((endpoint, index) => {
        const open = endpointFocus === endpoint.id;
        return (
          <div key={endpoint.id}>
            <EndpointRow
              endpoint={endpoint}
              open={open}
              onToggle={() => focusEndpoint(open ? null : endpoint.id)}
              onRemove={() => removeEndpoint(index, endpoint.id)}
            />
            {open && <OpenEndpoint node={node} endpoint={endpoint} editor={editor} />}
          </div>
        );
      })}
    </Section>
  );
};

export const ServicePanel = ({ node, editor }: Props) => (
  <>
    <Section title="Service">
      <BoundSelect editor={editor} path="cfg.framework" value={node.cfg.framework} options={FRAMEWORKS} aria-label="Framework" />
    </Section>
    <EndpointsSection node={node} editor={editor} />
  </>
);
