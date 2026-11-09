import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchableMultiSelect, matchingOptions } from "./SearchableMultiSelect";

afterEach(cleanup);

const setup = (props: { single?: boolean; selected?: string[] } = {}) => {
  const onToggle = vi.fn();
  render(
    <SearchableMultiSelect
      options={["users", "orders", "order_items"]}
      selected={props.selected ?? []}
      onToggle={onToggle}
      single={props.single}
      placeholder="Select tables…"
      aria-label="Tables"
    />,
  );
  return onToggle;
};

describe("SearchableMultiSelect", () => {
  it("filters options case-insensitively", () => {
    expect(matchingOptions(["Users", "orders"], " US ")).toEqual(["Users"]);
  });

  it("shows the placeholder or the selection and stays closed until clicked", () => {
    setup();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByLabelText("Tables").textContent).toContain("Select tables…");
    cleanup();
    setup({ selected: ["users", "orders"] });
    expect(screen.getByLabelText("Tables").textContent).toContain("users, orders");
  });

  it("searches and toggles several options while staying open", () => {
    const onToggle = setup();
    fireEvent.click(screen.getByLabelText("Tables"));
    fireEvent.change(screen.getByLabelText("Search options"), { target: { value: "order" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("orders"));
    fireEvent.click(screen.getByLabelText("order_items"));
    expect(onToggle.mock.calls).toEqual([["orders"], ["order_items"]]);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("reports when nothing matches", () => {
    setup();
    fireEvent.click(screen.getByLabelText("Tables"));
    fireEvent.change(screen.getByLabelText("Search options"), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("closes after one pick in single mode", () => {
    const onToggle = setup({ single: true });
    fireEvent.click(screen.getByLabelText("Tables"));
    fireEvent.click(screen.getByLabelText("users"));
    expect(onToggle).toHaveBeenCalledWith("users");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on an outside click", () => {
    setup();
    fireEvent.click(screen.getByLabelText("Tables"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
