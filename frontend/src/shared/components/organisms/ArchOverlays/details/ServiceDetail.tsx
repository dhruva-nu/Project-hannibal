import { callersOf, endpointLabel, sourceDb, type Endpoint, type ServiceNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { CodeBlock, FieldCaption, HintText, MethodBadge } from "@/shared/components/atoms";
import { ArchNodeLinks } from "@/shared/components/molecules";
import { curlExample } from "../curlExample";
import { Modal } from "@/shared/components/molecules";
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
      <HintText>
        Called by: <ArchNodeLinks nodes={callersOf(model, endpoint.id)} />
      </HintText>
      <FieldCaption>Example</FieldCaption>
      <CodeBlock>{curlExample(endpoint)}</CodeBlock>
      {queriesDb ? (
        <QueryResultView endpoint={endpoint} />
      ) : (
        endpoint.responses.map((r) => (
          <div key={`${r.status}-${r.desc}`}>
            <FieldCaption>
              Response {r.status} {r.desc}
            </FieldCaption>
            <CodeBlock>{r.body}</CodeBlock>
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
      <HintText>This service has no endpoints yet.</HintText>
    )}
  </Modal>
);
