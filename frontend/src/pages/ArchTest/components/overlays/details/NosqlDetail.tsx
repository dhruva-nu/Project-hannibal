import { pj, pretty, type NosqlNode } from "../../../engine";
import { Code, DataTable, FieldCaption, Note } from "../../../ui/Controls";
import { Modal } from "../Modal";
import styles from "../overlays.module.css";

const firstDocument = (data: string): unknown => {
  const parsed = pj(data, []);
  return Array.isArray(parsed) ? parsed[0] : undefined;
};

export const NosqlDetail = ({ node, onClose }: { node: NosqlNode; onClose: () => void }) => (
  <Modal title={`${node.name} structure`} wide onClose={onClose}>
    {node.cfg.collections.length === 0 && <Note>No collections.</Note>}
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
        <Note>
          Indexes:{" "}
          {collection.indexes.map((i) => `${i.name} (${i.columns})${i.unique ? " unique" : ""}`).join(", ") || "none"}
        </Note>
        <FieldCaption>Example document</FieldCaption>
        <Code>{pretty(firstDocument(collection.data))}</Code>
      </div>
    ))}
  </Modal>
);
