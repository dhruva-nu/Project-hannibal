import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Collapsible, ConfirmDialog, DataTable, FixedCell, FormField, FormRow, MenuHeading, MenuItem, Modal, PanelSection, PopoverMenu, Tabs, Toast } from ".";

afterEach(cleanup);

describe("layout molecules", () => {
  it("render labelled fields, rows, sections and tables", () => {
    render(
      <>
        <FormField label="Name">
          <input aria-label="name input" />
        </FormField>
        <FormRow>
          <FixedCell>=</FixedCell>
        </FormRow>
        <PanelSection title="Joins" action={<button type="button">Add</button>}>
          body
        </PanelSection>
        <DataTable>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </DataTable>
      </>,
    );
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Joins/ })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "cell" })).toBeTruthy();
    expect(screen.getByText("=")).toBeTruthy();
  });

  it("Collapsible reports toggles", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Collapsible summary="More" open={false} onToggle={onToggle}>
        hidden
      </Collapsible>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe("Modal", () => {
  it("focuses itself and closes on Escape, the Close button and a backdrop press only", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Details" wide onClose={onClose}>
        <span>content</span>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Details" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.mouseDown(screen.getByText("content"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.mouseDown(screen.getByTestId("modal-overlay"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("ConfirmDialog", () => {
  it("closes on cancel and closes then confirms on the confirm button", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog message="Delete it?" confirmLabel="Delete" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("PopoverMenu", () => {
  it("clamps to the viewport, runs items and closes on an outside pointer", () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    render(
      <PopoverMenu anchor={{ left: 99999, bottom: 10 }} onClose={onClose}>
        <MenuHeading>Add</MenuHeading>
        <MenuItem onClick={onClick}>Component</MenuItem>
      </PopoverMenu>,
    );
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe(`${window.innerWidth - 238}px`);
    expect(menu.style.top).toBe("14px");
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Component" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Component" }));
    expect(onClick).toHaveBeenCalledOnce();
    act(() => void fireEvent.pointerDown(document.body));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Toast", () => {
  it("shows the message alone when there is no action", () => {
    render(<Toast message="Saved" onDismiss={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("Saved");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("runs the action then dismisses", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast message="Deleted" actionLabel="Undo" onAction={onAction} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("Tabs", () => {
  it("marks the active tab in either variant and reports changes", () => {
    const onChange = vi.fn();
    const tabs = [
      { id: "controller", label: "Controller" },
      { id: "service", label: "Service layer" },
    ] as const;
    const { rerender } = render(<Tabs tabs={tabs} activeId="controller" onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "Controller" }).getAttribute("aria-selected")).toBe("true");
    rerender(<Tabs tabs={tabs} activeId="controller" onChange={onChange} variant="underline" />);
    fireEvent.click(screen.getByRole("tab", { name: "Service layer" }));
    expect(onChange).toHaveBeenCalledWith("service");
  });
});
