import { callersOf, endpointLabel, sourceDb, type Endpoint, type ServiceNode } from "../../../engine";
import { useArch } from "../../../state/archApi";
import { Code, FieldCaption, MethodBadge, Note } from "../../../ui/Controls";
import { NodeLinks } from "../../../ui/NodeLinks";
import { curlExample } from "../curlExample";
import { Modal } from "../Modal";
import { QueryResultView } from "./QueryResultView";
import styles from "../overlays.module.css";

const EndpointDetail = ({ endpoint }: { endpoint: Endpoint }) => {
  const { model } = useArch();
  const queriesDb = Boolean(sourceDb(model, endpoint) && endpoint.q.tables.length);
  return (
    <section className={styles.endpointDetail} aria-label={endpointLabel(endpoint)}>
      <h3 className={styles.endpointHeading}>
        <MethodBadge method={endpoint.method} /> <code>{endpoint.path}</code>
      </h3>
      <Note>
        Called by: <NodeLinks nodes={callersOf(model, endpoint.id)} />
      </Note>
      <FieldCaption>Example</FieldCaption>
      <Code>{curlExample(endpoint)}</Code>
      {queriesDb ? (
        <QueryResultView endpoint={endpoint} />
      ) : (
        endpoint.responses.map((r) => (
          <div key={`${r.status}-${r.desc}`}>
            <FieldCaption>
              Response {r.status} {r.desc}
            </FieldCaption>
            <Code>{r.body}</Code>
          </div>
        ))
      )}
    </section>
  );
};

export const ServiceDetail = ({ node, onClose }: { node: ServiceNode; onClose: () => void }) => (
  <Modal title={`${node.name} (${node.cfg.framework})`} wide onClose={onClose}>
    {node.cfg.endpoints.length ? (
      node.cfg.endpoints.map((endpoint) => <EndpointDetail key={endpoint.id} endpoint={endpoint} />)
    ) : (
      <Note>This service has no endpoints yet.</Note>
    )}
  </Modal>
);
