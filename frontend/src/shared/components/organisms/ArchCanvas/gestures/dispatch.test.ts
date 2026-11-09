import { describe, expect, it, vi } from "vitest";
import { byName } from "@/pages/ArchTest/engine/testFixtures";
import { NO_SELECTION } from "@/pages/ArchTest/state/archApi";
import { handleCanvasPointerDown, type CanvasPointerEvent } from "./dispatch";
import { makeContext, pointer } from "./gestureFixtures";

const element = (attrs: Record<string, string>, parent?: HTMLElement): HTMLElement => {
  const el = document.createElement("div");
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(`data-${key}`, value));
  parent?.appendChild(el);
  return el;
};

const eventOn = (target: Element, extra: Partial<CanvasPointerEvent> = {}): CanvasPointerEvent => ({
  button: 0,
  shiftKey: false,
  clientX: 0,
  clientY: 0,
  target,
  preventDefault: vi.fn(),
  ...extra,
});

describe("handleCanvasPointerDown", () => {
  it("ignores other mouse buttons and overlay controls", () => {
    const ctx = makeContext();
    handleCanvasPointerDown(ctx, eventOn(element({}), { button: 2 }));
    for (const attr of ["popover", "chip", "scopebar"]) {
      const inner = element({}, element({ [attr]: "true" }));
      handleCanvasPointerDown(ctx, eventOn(inner));
    }
    expect(ctx.setPanning).not.toHaveBeenCalled();
    expect(ctx.select).not.toHaveBeenCalled();
  });

  it("pans on the middle button", () => {
    const ctx = makeContext();
    handleCanvasPointerDown(ctx, eventOn(element({}), { button: 1 }));
    expect(ctx.setPanning).toHaveBeenCalledWith(true);
    pointer("pointerup", 0, 0);
  });

  it("starts a connection from a port inside a node", () => {
    const ctx = makeContext();
    const node = element({ kind: "node", id: byName(ctx.model, "fetchUser").id });
    const port = element({ port: "r" }, node);
    const event = eventOn(port);
    handleCanvasPointerDown(ctx, event);
    expect(event.preventDefault).toHaveBeenCalled();
    pointer("pointermove", 5, 5);
    expect(ctx.setPreview).toHaveBeenCalled();
    pointer("pointerup", 5, 5);
  });

  it("starts a resize from a handle inside a node", () => {
    const ctx = makeContext();
    const node = element({ kind: "node", id: byName(ctx.model, "fetchUser").id });
    const handle = element({ resize: "true" }, node);
    const event = eventOn(handle);
    handleCanvasPointerDown(ctx, event);
    expect(event.preventDefault).toHaveBeenCalled();
    pointer("pointermove", 80, 80);
    expect(ctx.setOverrides).toHaveBeenCalled();
    pointer("pointerup", 80, 80);
  });

  it("ignores a port or resize handle that has no owning node", () => {
    const ctx = makeContext();
    handleCanvasPointerDown(ctx, eventOn(element({ port: "r" })));
    pointer("pointerup", 0, 0);
    handleCanvasPointerDown(ctx, eventOn(element({ resize: "true" })));
    pointer("pointerup", 0, 0);
    expect(ctx.setPreview).not.toHaveBeenCalled();
    expect(ctx.setOverrides).not.toHaveBeenCalled();
  });

  it("reveals a ghost without starting a gesture", () => {
    const ctx = makeContext();
    handleCanvasPointerDown(ctx, eventOn(element({ ghost: "abc" })));
    expect(ctx.reveal).toHaveBeenCalledWith("abc");
  });

  it("drags a node", () => {
    const ctx = makeContext();
    const id = byName(ctx.model, "fetchUser").id;
    handleCanvasPointerDown(ctx, eventOn(element({ kind: "node", id })));
    expect(ctx.select).toHaveBeenCalledWith({ type: "node", ids: [id] });
    expect(ctx.focusEndpoint).not.toHaveBeenCalled();
    pointer("pointerup", 0, 0);
  });

  it("focuses the endpoint row a node drag starts on", () => {
    const ctx = makeContext();
    const id = byName(ctx.model, "User service").id;
    const row = element({ endpoint: "ep_get_user" }, element({ kind: "node", id }));
    handleCanvasPointerDown(ctx, eventOn(row));
    expect(ctx.focusEndpoint).toHaveBeenCalledWith("ep_get_user");
    expect(ctx.select).toHaveBeenCalledWith({ type: "node", ids: [id] });
    pointer("pointerup", 0, 0);
  });

  it("drags a group by its label", () => {
    const ctx = makeContext();
    handleCanvasPointerDown(ctx, eventOn(element({ "group-head": "g1" })));
    expect(ctx.select).toHaveBeenCalledWith({ type: "group", ids: ["g1"] });
    pointer("pointerup", 0, 0);
  });

  it("selects an edge by its hit area", () => {
    const ctx = makeContext();
    handleCanvasPointerDown(ctx, eventOn(element({ "edge-id": "e1" })));
    expect(ctx.select).toHaveBeenCalledWith({ type: "edge", ids: ["e1"] });
  });

  it("marquee-selects with shift and pans otherwise on empty canvas", () => {
    const shifted = makeContext();
    handleCanvasPointerDown(shifted, eventOn(element({}), { shiftKey: true }));
    expect(shifted.setMarquee).toHaveBeenCalled();
    pointer("pointerup", 0, 0);
    const plain = makeContext();
    handleCanvasPointerDown(plain, eventOn(element({})));
    expect(plain.setPanning).toHaveBeenCalledWith(true);
    pointer("pointerup", 0, 0);
    expect(plain.select).toHaveBeenCalledWith(NO_SELECTION);
  });
});
