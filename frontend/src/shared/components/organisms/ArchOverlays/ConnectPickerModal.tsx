import { useState } from "react";
import { NODE_REGISTRY, type ArchModel, type ArchNode } from "@/pages/ArchTest/engine";
import { findNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, SelectInput, ToolButton, type SelectOption } from "@/shared/components/atoms";
import { FormField } from "@/shared/components/molecules";
import { Modal } from "@/shared/components/molecules";

interface ConnectPickerModalProps {
  fromId: string;
  toId: string;
  onClose: () => void;
}

const connectableItems = (model: ArchModel, n: ArchNode): ArchNode[] =>
  n.type === "layer" ? model.nodes.filter((x) => x.layer === n.lid) : [n];

const optionsOf = (items: ArchNode[]): SelectOption[] =>
  items.map((item) => [item.id, `${item.name} (${NODE_REGISTRY[item.type].label})`] as const);

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
        <HintText>Open the layer and add something to connect first.</HintText>
      ) : (
        <>
          <HintText>Choose which items inside get connected.</HintText>
          <FormField label="From">
            <SelectInput value={pickedFrom} options={optionsOf(fromItems)} onChange={setPickedFrom} aria-label="From" />
          </FormField>
          <FormField label="To">
            <SelectInput value={pickedTo} options={optionsOf(toItems)} onChange={setPickedTo} aria-label="To" />
          </FormField>
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
