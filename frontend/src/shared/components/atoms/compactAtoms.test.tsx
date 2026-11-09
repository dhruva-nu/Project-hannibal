import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Callout, CodeBlock, FieldCaption, HintText, LinkButton, MethodBadge, MutedText, Pill, ToolButton } from ".";

afterEach(cleanup);

describe("ToolButton", () => {
  it("clicks and reflects its variants as classes and aria attributes", () => {
    const onClick = vi.fn();
    render(
      <ToolButton small danger active keepWidth title="Undo" aria-pressed onClick={onClick}>
        Undo
      </ToolButton>,
    );
    const button = screen.getByRole("button", { name: "Undo" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className.split(" ")).toHaveLength(5);
  });

  it("uses only the base class without variants and can be disabled", () => {
    render(<ToolButton disabled>Plain</ToolButton>);
    const button = screen.getByRole("button", { name: "Plain" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.className.split(" ")).toHaveLength(1);
  });
});

describe("text atoms", () => {
  it("render their children", () => {
    const onClick = vi.fn();
    render(
      <>
        <LinkButton onClick={onClick}>Open</LinkButton>
        <MethodBadge method="POST" />
        <HintText>hint</HintText>
        <MutedText>muted</MutedText>
        <FieldCaption>caption</FieldCaption>
        <CodeBlock>code</CodeBlock>
        <Callout tone="success">saved</Callout>
        <Pill>plain</Pill>
        <Pill emphasis>strong</Pill>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText("POST").dataset.method).toBe("POST");
    expect(screen.getByText("saved").dataset.tone).toBe("success");
    expect(screen.getByText("strong").className).not.toBe(screen.getByText("plain").className);
    ["hint", "muted", "caption", "code"].forEach((text) => expect(screen.getByText(text)).toBeTruthy());
  });
});
