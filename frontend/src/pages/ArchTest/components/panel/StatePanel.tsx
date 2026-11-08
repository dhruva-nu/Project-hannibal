import { VAR_TYPES, readersOf, uid, writersOf, type StateNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { Note, Row, Section, ToolButton } from "../../ui/Controls";
import { BoundSelect, BoundText } from "./Bound";
import { NodeLinks } from "../../ui/NodeLinks";
import type { Editor } from "./panelEditor";
import { RowList } from "./rows";

interface Props {
  node: StateNode;
  editor: Editor;
}

export const StatePanel = ({ node, editor }: Props) => {
  const { model, openDetail } = useArch();
  const nextVariable = () => ({
    id: uid("v"),
    name: "variable" + (node.cfg.vars.length + 1),
    type: "string",
    init: '""',
  });
  return (
    <>
      <Section
        title="Variables"
        action={
          <ToolButton small onClick={() => editor.push("cfg.vars", nextVariable())}>
            Add variable
          </ToolButton>
        }
      >
        <RowList
          items={node.cfg.vars}
          path="cfg.vars"
          editor={editor}
          emptyNote="No variables yet."
          renderRow={(variable, _index, rowPath, removeButton) => (
            <div key={variable.id}>
              <Row>
                <BoundText editor={editor} path={`${rowPath}.name`} value={variable.name} mono aria-label="Variable name" />
                <BoundSelect
                  editor={editor}
                  path={`${rowPath}.type`}
                  value={variable.type}
                  options={VAR_TYPES}
                  fixedWidth={90}
                  aria-label="Variable type"
                />
                {removeButton}
              </Row>
              <Row>
                <BoundText
                  editor={editor}
                  path={`${rowPath}.init`}
                  value={variable.init}
                  mono
                  placeholder="initial value, JSON"
                  aria-label="Initial value"
                />
              </Row>
              <Note>
                Read by: <NodeLinks nodes={readersOf(model, variable.id)} />
                <br />
                Modified by: <NodeLinks nodes={writersOf(model, variable.id)} />
              </Note>
            </div>
          )}
        />
      </Section>
      <Section title="Dependencies">
        <Note>Turn on State links in the toolbar to draw these on the canvas, or open the dependency graph.</Note>
        <ToolButton small onClick={() => openDetail(node.id)}>
          Open dependency graph
        </ToolButton>
      </Section>
    </>
  );
};
