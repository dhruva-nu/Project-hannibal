import type { ServiceNode } from "../../engine";
import { Note } from "../../ui/Controls";
import { EndpointPanel } from "../panel/EndpointPanel";
import type { Editor } from "../panel/panelEditor";
import { EndpointPicker } from "./EndpointPicker";
import { useFocusedEndpoint } from "./useFocusedEndpoint";
import styles from "./popup.module.css";

export const ControllerTab = ({ node, editor }: { node: ServiceNode; editor: Editor }) => {
  const focused = useFocusedEndpoint(node, editor);
  return (
    <div className={styles.layout}>
      <EndpointPicker node={node} currentId={focused.endpoint?.id} onFocus={focused.focus} onAdd={focused.add} onRemove={focused.remove} />
      <div>
        {focused.endpoint && focused.editor ? (
          <EndpointPanel endpoint={focused.endpoint} editor={focused.editor} />
        ) : (
          <Note>No endpoints yet. Add the routes this controller exposes.</Note>
        )}
      </div>
    </div>
  );
};
