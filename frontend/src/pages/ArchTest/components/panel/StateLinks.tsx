import { visibleVarsFor, type ComponentNode, type FunctionNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { CheckInput, FieldCaption, Note, Row, SelectInput, ToolButton } from "../../ui/Controls";
import { BoundText } from "./Bound";
import type { Editor } from "./panelEditor";
import { RowList } from "./rows";

interface StateLinksProps {
  node: ComponentNode | FunctionNode;
  editor: Editor;
}

export const StateLinks = ({ node, editor }: StateLinksProps) => {
  const { model } = useArch();
  const vars = visibleVarsFor(model, node);
  if (!vars.length) return <Note>Add variables to the App state panel, or local state to the component, to link them here.</Note>;

  const toggleRead = (varId: string, checked: boolean) =>
    editor.edit<ComponentNode | FunctionNode>((target) => {
      const kept = target.cfg.reads.filter((id) => id !== varId);
      target.cfg.reads = checked ? [...kept, varId] : kept;
    });

  return (
    <>
      <FieldCaption>Reads</FieldCaption>
      <div>
        {vars.map((v) => (
          <CheckInput
            key={v.id}
            label={v.owner ? `${v.name} (local)` : v.name}
            checked={node.cfg.reads.includes(v.id)}
            onChange={(checked) => toggleRead(v.id, checked)}
          />
        ))}
      </div>
      <FieldCaption>
        {node.type === "function" ? "Modifies (value taken from the response)" : "Modifies (value taken from the output)"}
      </FieldCaption>
      <RowList
        items={node.cfg.writes}
        path="cfg.writes"
        editor={editor}
        renderRow={(write, _index, rowPath, removeButton) => (
          <Row>
            <SelectInput
              aria-label="Modified state variable"
              value={write.varId}
              options={vars.map((v) => [v.id, v.name] as const)}
              onChange={(value) => editor.set(`${rowPath}.varId`, value)}
            />
            <BoundText
              editor={editor}
              path={`${rowPath}.from`}
              value={write.from}
              mono
              placeholder="path, e.g. user (blank = all)"
              aria-label="Value path"
            />
            {removeButton}
          </Row>
        )}
      />
      <ToolButton small onClick={() => editor.push("cfg.writes", { varId: vars[0].id, from: "" })}>
        Add modified state
      </ToolButton>
    </>
  );
};
