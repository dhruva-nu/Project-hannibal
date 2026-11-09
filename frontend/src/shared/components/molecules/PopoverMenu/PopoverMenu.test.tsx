import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuHeading, MenuItem, PopoverMenu } from "./PopoverMenu";

afterEach(cleanup);

describe("PopoverMenu placement and dismissal", () => {
  const anchor = { left: 5000, bottom: 40 };

  it("clamps horizontally to the window and positions below the anchor", () => {
    const { getByRole } = render(
      <PopoverMenu anchor={anchor} onClose={vi.fn()}>
        <MenuHeading>Head</MenuHeading>
      </PopoverMenu>,
    );
    const style = getByRole("menu").style;
    expect(style.top).toBe("44px");
    expect(parseInt(style.left, 10)).toBeLessThan(window.innerWidth);
  });

  it("keeps a minimum left margin", () => {
    const { getByRole } = render(
      <PopoverMenu anchor={{ left: -50, bottom: 0 }} onClose={vi.fn()}>
        x
      </PopoverMenu>,
    );
    expect(getByRole("menu").style.left).toBe("6px");
  });

  it("closes on an outside press but not an inside one", () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <PopoverMenu anchor={anchor} onClose={onClose}>
        <MenuItem onClick={vi.fn()}>Inside</MenuItem>
      </PopoverMenu>,
    );
    fireEvent.pointerDown(getByText("Inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
