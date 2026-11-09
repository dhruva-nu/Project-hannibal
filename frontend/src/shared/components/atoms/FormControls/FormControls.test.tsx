import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineCheckbox, NumberInput, SelectInput, TextArea, TextInput } from "./FormControls";

afterEach(cleanup);

describe("form controls", () => {
  it("TextInput reports the typed text and applies a fixed width", () => {
    const onChange = vi.fn();
    render(<TextInput value="a" onChange={onChange} monospace width={40} aria-label="Name" />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ab" } });
    expect(onChange).toHaveBeenCalledWith("ab");
    expect(input.style.width).toBe("40px");
  });

  it("NumberInput reports numbers and an empty value as an empty string", () => {
    const onChange = vi.fn();
    render(<NumberInput value={1} onChange={onChange} aria-label="Limit" />);
    const input = screen.getByLabelText("Limit");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange.mock.calls).toEqual([[7], [""]]);
    expect((input as HTMLInputElement).style.width).toBe("");
  });

  it("SelectInput accepts plain and labelled options", () => {
    const onChange = vi.fn();
    render(<SelectInput value="b" options={["a", ["b", "Bee"]]} onChange={onChange} aria-label="Pick" />);
    const select = screen.getByLabelText("Pick") as HTMLSelectElement;
    expect(screen.getByRole("option", { name: "Bee" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "a" } });
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("TextArea marks invalid content and reports edits", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TextArea value="{" onChange={onChange} invalid aria-label="Body" />);
    const area = screen.getByLabelText("Body");
    expect(area.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(area, { target: { value: "{}" } });
    expect(onChange).toHaveBeenCalledWith("{}");
    rerender(<TextArea value="{}" onChange={onChange} aria-label="Body" />);
    expect(area.getAttribute("aria-invalid")).toBeNull();
  });

  it("InlineCheckbox reports the checked state", () => {
    const onChange = vi.fn();
    render(<InlineCheckbox checked={false} label="Unique" onChange={onChange} keepWidth />);
    fireEvent.click(screen.getByLabelText("Unique"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
