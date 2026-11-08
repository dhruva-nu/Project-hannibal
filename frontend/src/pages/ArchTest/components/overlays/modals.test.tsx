import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { snapshotOf, starter } from "../../engine";
import { ModalHost } from "./ModalHost";
import { nodeOfType, renderWithArch } from "./testHarness";

const host = (modal: Parameters<typeof ModalHost>[0]["modal"], onClose = vi.fn(), onLoadDiagram = vi.fn()) => (
  <ModalHost modal={modal} onClose={onClose} onLoadDiagram={onLoadDiagram} />
);

describe("Modal shell", () => {
  it("renders nothing without a modal", () => {
    const { container } = renderWithArch(host(null));
    expect(container.innerHTML).toBe("");
  });

  it("focuses the dialog and closes on Escape, Close button and overlay mouse down", () => {
    const onClose = vi.fn();
    renderWithArch(host({ kind: "io" }, onClose));
    const dialog = screen.getByRole("dialog", { name: "Export or import JSON" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.mouseDown(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByTestId("modal-overlay"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("ConfirmModal", () => {
  it("runs the confirm action after closing", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderWithArch(host({ kind: "confirm", request: { message: "Delete it?", confirmLabel: "Delete", onConfirm } }, onClose));
    expect(screen.getByText("Delete it?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
  });

  it("cancels without confirming", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderWithArch(host({ kind: "confirm", request: { message: "m", confirmLabel: "Go", onConfirm } }, onClose));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("IoModal", () => {
  const textarea = () => screen.getByLabelText("Diagram JSON") as HTMLTextAreaElement;

  it("exports the model and loads the same text back", () => {
    const model = starter();
    const onClose = vi.fn();
    const onLoadDiagram = vi.fn();
    renderWithArch(host({ kind: "io" }, onClose, onLoadDiagram), model);
    expect(JSON.parse(textarea().value)).toEqual(JSON.parse(snapshotOf(model)));
    fireEvent.click(screen.getByRole("button", { name: "Load from text" }));
    expect(onClose).toHaveBeenCalled();
    expect(onLoadDiagram).toHaveBeenCalledWith(JSON.parse(snapshotOf(model)));
  });

  it.each([
    ["not json", "Unexpected"],
    ["null", "no nodes"],
    ['{"nodes": 3}', "no nodes"],
  ])("rejects %s", (text, fragment) => {
    const onLoadDiagram = vi.fn();
    renderWithArch(host({ kind: "io" }, vi.fn(), onLoadDiagram));
    fireEvent.change(textarea(), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Load from text" }));
    expect(screen.getByText(new RegExp(`not a valid diagram: .*${fragment}`))).toBeTruthy();
    expect(onLoadDiagram).not.toHaveBeenCalled();
  });

  it("copies to the clipboard and reports failure", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithArch(host({ kind: "io" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(screen.getByText("Select the text and copy it")).toBeTruthy();
  });
});

describe("ConnectPickerModal", () => {
  it("connects the chosen items inside two layers", () => {
    const model = starter();
    const [client, backend] = model.lnodes;
    const onClose = vi.fn();
    const { api } = renderWithArch(host({ kind: "picker", fromId: client.id, toId: backend.id }, onClose), model);
    const apiNode = nodeOfType(model, "api");
    fireEvent.change(screen.getByLabelText("To", { selector: "select" }), { target: { value: apiNode.id } });
    fireEvent.change(screen.getByLabelText("From", { selector: "select" }), {
      target: { value: nodeOfType(model, "function").id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create connection" }));
    expect(onClose).toHaveBeenCalled();
    expect(api.connect).toHaveBeenCalledWith(nodeOfType(model, "function").id, apiNode.id, false);
  });

  it("offers plain nodes as the only choice and defaults to the first item", () => {
    const model = starter();
    const comp = nodeOfType(model, "component");
    const fn = nodeOfType(model, "function");
    const { api } = renderWithArch(host({ kind: "picker", fromId: comp.id, toId: fn.id }), model);
    fireEvent.click(screen.getByRole("button", { name: "Create connection" }));
    expect(api.connect).toHaveBeenCalledWith(comp.id, fn.id, false);
  });

  it("explains when a layer is empty", () => {
    const model = starter();
    model.nodes = model.nodes.filter((n) => n.layer !== "db");
    model.edges = [];
    const [client, , db] = model.lnodes;
    renderWithArch(host({ kind: "picker", fromId: client.id, toId: db.id }), model);
    expect(screen.getByText(/add something to connect first/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create connection" })).toBeNull();
  });

  it("renders nothing for unknown nodes", () => {
    const { container } = renderWithArch(host({ kind: "picker", fromId: "x", toId: "y" }));
    expect(container.innerHTML).toBe("");
  });
});
