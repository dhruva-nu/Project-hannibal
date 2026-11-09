import { NOSQL_TYPES, inferFields, newCollection, type NosqlCollection, type NosqlNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { FieldCaption, HintText, MutedText, ToolButton } from "@/shared/components/atoms";
import { Collapsible, FormField, FormRow, PanelSection } from "@/shared/components/molecules";
import { BoundJsonArea, BoundSelect, BoundText } from "../Bound";
import { IndexRows } from "../IndexRows";
import type { Editor } from "../panelEditor";
import { AddRowButton, RowList } from "../rows";
import { nextName, type OpenSet } from "../useOpenSet";

interface Props {
  node: NosqlNode;
  editor: Editor;
}

interface CollectionProps extends Props {
  collection: NosqlCollection;
  collectionIndex: number;
  openSet: OpenSet;
}

const CollectionDetails = ({ node, editor, collection, collectionIndex, openSet }: CollectionProps) => {
  const base = `cfg.collections.${collectionIndex}`;
  const key = `${node.id}:${collectionIndex}`;
  const inferFromFirstDocument = () =>
    editor.edit<NosqlNode>((target) => {
      const inferred = inferFields(target.cfg.collections[collectionIndex].data);
      if (inferred) target.cfg.collections[collectionIndex].fields = inferred;
    });
  return (
    <Collapsible
      open={openSet.isOpen(key)}
      onToggle={(open) => openSet.setOpen(key, open)}
      summary={
        <>
          {collection.name} <MutedText>{collection.fields.length} fields</MutedText>
        </>
      }
    >
      <FormField label="Collection name">
        <BoundText editor={editor} path={`${base}.name`} value={collection.name} />
      </FormField>
      <FieldCaption>Fields</FieldCaption>
      <RowList
        items={collection.fields}
        path={`${base}.fields`}
        editor={editor}
        renderRow={(field, _i, rowPath, removeButton) => (
          <FormRow>
            <BoundText editor={editor} path={`${rowPath}.name`} value={field.name} monospace aria-label="Field name" />
            <BoundSelect editor={editor} path={`${rowPath}.type`} value={field.type} options={NOSQL_TYPES} width={100} aria-label="Field type" />
            {removeButton}
          </FormRow>
        )}
      />
      <span>
        <AddRowButton label="Add field" editor={editor} path={`${base}.fields`} item={{ name: "field", type: "string" }} />{" "}
        <ToolButton small onClick={inferFromFirstDocument}>
          Infer from first document
        </ToolButton>
      </span>
      <IndexRows
        indexes={collection.indexes}
        path={`${base}.indexes`}
        editor={editor}
        columnsPlaceholder="field1, field2"
        newIndex={{ name: "field_1", columns: "", unique: false }}
        addLabel="Add index"
      />
      <FieldCaption>Documents, JSON array (the first is the example document)</FieldCaption>
      <BoundJsonArea editor={editor} path={`${base}.data`} value={collection.data} rows={7} aria-label="Documents" />
      <ToolButton small danger onClick={() => editor.remove("cfg.collections", collectionIndex)}>
        Delete collection
      </ToolButton>
    </Collapsible>
  );
};

export const CollectionsSection = ({ node, editor, openSet }: Props & { openSet: OpenSet }) => {
  const { openDetail } = useArch();
  const addCollection = () => {
    const name = nextName("collection_", node.cfg.collections.map((c) => c.name));
    editor.push("cfg.collections", newCollection(name));
    openSet.setOpen(`${node.id}:${node.cfg.collections.length}`, true);
  };
  return (
    <PanelSection
      title="Collections"
      action={
        <span>
          <ToolButton small onClick={addCollection}>
            Add collection
          </ToolButton>{" "}
          <ToolButton small onClick={() => openDetail(node.id)}>
            Structure view
          </ToolButton>
        </span>
      }
    >
      {node.cfg.collections.length ? (
        node.cfg.collections.map((collection, collectionIndex) => (
          <CollectionDetails
            key={collectionIndex}
            node={node}
            editor={editor}
            collection={collection}
            collectionIndex={collectionIndex}
            openSet={openSet}
          />
        ))
      ) : (
        <HintText>No collections yet.</HintText>
      )}
    </PanelSection>
  );
};
