import { parseJsonOr, toPrettyJson, type NosqlNode } from "@/pages/ArchTest/engine";
import { CodeBlock, FieldCaption, HintText } from "@/shared/components/atoms";
import { DataTable } from "@/shared/components/molecules";
import { Modal } from "@/shared/components/molecules";
import styles from "../overlays.module.css";

const firstDocument = (data: string): unknown => {
  const parsed = parseJsonOr(data, []);
  return Array.isArray(parsed) ? parsed[0] : undefined;
};

export const NosqlDetail = ({ node, onClose }: { node: NosqlNode; onClose: () => void }) => (
  <Modal title={`${node.name} structure`} wide onClose={onClose}>
    {node.cfg.collections.length === 0 && <HintText>No collections.</HintText>}
    {node.cfg.collections.map((collection) => (
      <div className={styles.block} key={collection.name}>
        <strong>{collection.name}</strong>
        <DataTable>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {collection.fields.map((field) => (
              <tr key={field.name}>
                <td>{field.name}</td>
                <td>{field.type}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <HintText>
          Indexes:{" "}
          {collection.indexes.map((i) => `${i.name} (${i.columns})${i.unique ? " unique" : ""}`).join(", ") || "none"}
        </HintText>
        <FieldCaption>Example document</FieldCaption>
        <CodeBlock>{toPrettyJson(firstDocument(collection.data))}</CodeBlock>
      </div>
    ))}
  </Modal>
);
