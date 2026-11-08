import { useState } from "react";
import { REG, type ArchModel, type ArchNode } from "../../engine";
import { findNode, useArch } from "../../state/archApi";
import { Field, Note, SelectInput, ToolButton, type SelectOption } from "../../ui/Controls";
import { Modal } from "./Modal";

interface ConnectPickerModalProps {
  fromId: string;
  toId: string;
  onClose: () => void;
}

const connectableItems = (model: ArchModel, n: ArchNode): ArchNode[] =>
  n.type === "layer" ? model.nodes.filter((x) => x.layer === n.lid) : [n];

const optionsOf = (items: ArchNode[]): SelectOption[] =>
  items.map((item) => [item.id, `${item.name} (${REG[item.type].label})`] as const);

export const ConnectPickerModal = ({ fromId, toId, onClose }: ConnectPickerModalProps) => {
  const api = useArch();
  const from = findNode(api.model, fromId);
  const to = findNode(api.model, toId);
  const fromItems = from ? connectableItems(api.model, from) : [];
  const toItems = to ? connectableItems(api.model, to) : [];
  const [pickedFrom, setPickedFrom] = useState(fromItems[0]?.id ?? "");
  const [pickedTo, setPickedTo] = useState(toItems[0]?.id ?? "");

  if (!from || !to) return null;
  const nothingToConnect = !fromItems.length || !toItems.length;

  return (
    <Modal title={`Connect ${from.name} to ${to.name}`} onClose={onClose}>
      {nothingToConnect ? (
        <Note>Open the layer and add something to connect first.</Note>
      ) : (
        <>
          <Note>Choose which items inside get connected.</Note>
          <Field label="From">
            <SelectInput value={pickedFrom} options={optionsOf(fromItems)} onChange={setPickedFrom} aria-label="From" />
          </Field>
          <Field label="To">
            <SelectInput value={pickedTo} options={optionsOf(toItems)} onChange={setPickedTo} aria-label="To" />
          </Field>
          <ToolButton
            onClick={() => {
              onClose();
              api.connect(pickedFrom, pickedTo, false);
            }}
          >
            Create connection
          </ToolButton>
        </>
      )}
    </Modal>
  );
};
