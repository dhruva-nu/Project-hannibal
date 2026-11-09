import { newEndpoint, reachableNodes, type Endpoint, type ServiceNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { scopeEditor, type Editor } from "../panelEditor";

interface Focused {
  endpoint: Endpoint | undefined;
  /** Editor scoped to the focused endpoint; undefined when the service has none. */
  editor: Editor | undefined;
  focus: (endpointId: string) => void;
  add: () => void;
  remove: (index: number) => void;
}

/** The endpoint being edited in the popup: the focused one, else the first. */
export const useFocusedEndpoint = (node: ServiceNode, editor: Editor): Focused => {
  const { model, endpointFocus, focusEndpoint } = useArch();
  const endpoint = node.cfg.endpoints.find((e) => e.id === endpointFocus) ?? node.cfg.endpoints[0];
  const scoped =
    endpoint &&
    scopeEditor(editor, `${node.id}:${endpoint.id}`, (target: ServiceNode) => {
      const found = target.cfg.endpoints.find((e) => e.id === endpoint.id);
      if (!found) throw new Error(`Endpoint "${endpoint.id}" no longer exists`);
      return found;
    });
  return {
    endpoint,
    editor: scoped,
    focus: focusEndpoint,
    add: () => {
      const reachableDatabase = reachableNodes(model, node.id, "fwd", ["sqldb", "nosql"])[0];
      const created = newEndpoint({ path: `/endpoint${node.cfg.endpoints.length + 1}`, pathParams: [], dbId: reachableDatabase?.id ?? "" });
      editor.push("cfg.endpoints", created);
      focusEndpoint(created.id);
    },
    remove: (index) => {
      editor.remove("cfg.endpoints", index);
      focusEndpoint(null);
    },
  };
};
