import { describe, expect, it, vi } from "vitest";
import { fadeChrome, morphNodes } from "./layerMorph";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height }) as DOMRect;

const withAnimate = (element: HTMLElement) => {
  const animate = vi.fn(() => ({}) as Animation);
  element.animate = animate as unknown as typeof element.animate;
  return animate;
};

const build = () => {
  const root = document.createElement("div");
  root.innerHTML = `
    <span data-member-id="svc"></span>
    <div data-live-viewport>
      <div data-toolbar></div>
      <div data-world>
        <svg></svg>
        <div data-ghost="g"></div>
        <div data-kind="flow"></div>
        <div data-kind="node" data-id="svc"></div>
        <div data-kind="node" data-id="loose"></div>
      </div>
    </div>`;
  const win = root.querySelector("[data-live-viewport]") as HTMLElement;
  root.querySelector("[data-member-id]")!.getBoundingClientRect = () => rect(10, 20, 80, 20);
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-kind="node"]'));
  nodes.forEach((node) => {
    node.getBoundingClientRect = () => rect(300, 200, 200, 100);
    Object.defineProperty(node, "offsetWidth", { value: 100, configurable: true });
  });
  const animates = nodes.map(withAnimate);
  return { root, win, animates };
};

describe("morphNodes", () => {
  it("flies a card from its pill when opening and from the layer centre when it has none", () => {
    const { root, win, animates } = build();
    morphNodes(root, win, { x: 0, y: 0, w: 400, h: 200 }, true);
    const fromPill = (animates[0].mock.calls[0] as unknown[])[0] as { transform: string }[];
    const fromCentre = (animates[1].mock.calls[0] as unknown[])[0] as { transform: string }[];
    expect(fromPill[0].transform).toBe("translate(-145px, -90px) scale(0.4, 0.2)");
    expect(fromPill[1].transform).toBe("none");
    expect(fromCentre[0].transform).toBe("translate(-70px, -55px) scale(0.4, 0.2)");
  });

  it("collapses every card into the layer centre and keeps it there", () => {
    const { root, win, animates } = build();
    morphNodes(root, win, { x: 0, y: 0, w: 400, h: 200 }, false);
    const [frames, options] = animates[0].mock.calls[0] as unknown as [{ transform: string }[], { fill: string }];
    expect(frames[0].transform).toBe("none");
    expect(frames[1].transform).toBe("translate(-70px, -55px) scale(0.4, 0.2)");
    expect(options.fill).toBe("forwards");
  });

  it("treats a zero-width card as unzoomed", () => {
    const { root, win } = build();
    const node = root.querySelector<HTMLElement>('[data-kind="node"]')!;
    Object.defineProperty(node, "offsetWidth", { value: 0 });
    expect(() => morphNodes(root, win, { x: 0, y: 0, w: 400, h: 200 }, true)).not.toThrow();
  });

  it("fails loudly on a card that does not say which node it is", () => {
    const { root, win } = build();
    root.querySelector<HTMLElement>('[data-kind="node"]')!.removeAttribute("data-id");
    expect(() => morphNodes(root, win, { x: 0, y: 0, w: 400, h: 200 }, true)).toThrow("Node card is missing its data-id attribute");
  });
});

describe("fadeChrome", () => {
  it("fades everything that is not a card, late when opening and early when collapsing", () => {
    const { win } = build();
    const faded = Array.from(win.querySelectorAll<HTMLElement>("[data-toolbar], svg, [data-ghost], [data-kind='flow']"));
    const animates = faded.map(withAnimate);
    const toolbarAnimate = animates[0];
    win.querySelector<HTMLElement>("[data-world]")!.animate = vi.fn() as never;
    expect(fadeChrome(win, true)).toHaveLength(4);
    expect((toolbarAnimate.mock.calls[0] as unknown[])[1]).toMatchObject({ delay: 360, fill: "backwards" });
    fadeChrome(win, false);
    expect((toolbarAnimate.mock.calls[1] as unknown[])[1]).toMatchObject({ delay: 0, fill: "forwards" });
  });
});
