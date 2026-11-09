import type { ServiceNode } from "../../engine";
import { Note } from "../../ui/Controls";
import { EndpointQueryPanel } from "../panel/EndpointQueryPanel";
import type { Editor } from "../panel/panelEditor";
import { AppServiceLibrary } from "./AppServiceLibrary";
import { CallChain } from "./CallChain";
import { EndpointPicker } from "./EndpointPicker";
import { useFocusedEndpoint } from "./useFocusedEndpoint";
import styles from "./popup.module.css";

export const ServiceLayerTab = ({ node, editor }: { node: ServiceNode; editor: Editor }) => {
  const focused = useFocusedEndpoint(node, editor);
  const { endpoint, editor: endpointEditor } = focused;
  return (
    <div className={styles.layout}>
      <EndpointPicker node={node} currentId={endpoint?.id} onFocus={focused.focus} onAdd={focused.add} onRemove={focused.remove} />
      <div>
        {endpoint && endpointEditor ? (
          <CallChain node={node} endpoint={endpoint} editor={endpointEditor} />
        ) : (
          <Note>Add an endpoint on the Controller tab to choose what it calls.</Note>
        )}
        <AppServiceLibrary node={node} editor={editor} />
        {endpoint && endpointEditor && endpoint.calls.some((c) => c.kind === "query") && (
          <EndpointQueryPanel endpoint={endpoint} editor={endpointEditor} serviceId={node.id} />
        )}
      </div>
    </div>
  );
};
