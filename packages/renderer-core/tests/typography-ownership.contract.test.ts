import { describe, expect, it } from "vitest";
import {
  applyDeksCommand,
  type DeksDocument,
  type DeksElementState,
} from "@deks-js/document";
import { RendererCore, compileTransition, toSlideSnapshot } from "../src/index.js";

const common = (elementId: string, x: number, patch: Partial<DeksElementState> = {}): DeksElementState => ({
  elementId,
  x,
  y: 100,
  width: 800,
  height: 180,
  rotationDeg: 0,
  opacity: 1,
  zIndex: 1,
  fill: "#f2f1ec",
  fontSize: 64,
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: 0,
  ...patch,
});

function document(): DeksDocument {
  return {
    format: "deks",
    codecVersion: 2,
    id: "typography-renderer",
    name: "Typography renderer",
    revision: 0,
    canvas: { width: 1920, height: 1080 },
    motionBeatMs: 600,
    motion: {
      in: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-out" },
      out: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in" },
      morph: { animation: { kind: "morph" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "linear" },
    },
    palette: {
      primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
      background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
    },
    history: { canUndo: false, canRedo: false },
    assets: [],
    elements: [{
      id: "title",
      kind: "text",
      name: "Title",
      content: "Persistent title",
      fontFamily: "Poppins",
      horizontalAlignment: "left",
      verticalAlignment: "middle",
      overflowMode: "hidden",
      isLocked: false,
    }],
    slides: [
      {
        id: "one", name: "One", isTemplate: false,
        background: { kind: "solid", color: "#0b0c0e" },
        states: [common("title", 100)],
      },
      {
        id: "two", name: "Two", isTemplate: false,
        background: { kind: "solid", color: "#0b0c0e" },
        states: [common("title", 300, {
          fontSize: 80,
          padding: { top: 10, right: 20, bottom: 30, left: 40 },
        })],
      },
    ],
  };
}

describe("renderer text typography ownership", () => {
  it("projects an alignment identity edit into both snapshots, preserving one-node morph", () => {
    const edited = applyDeksCommand(document(), {
      type: "update-element-identity",
      elementId: "title",
      patch: { horizontalAlignment: "right" },
    }).document;
    const from = toSlideSnapshot(edited, "one");
    const to = toSlideSnapshot(edited, "two");

    expect(from.elements[0]).toEqual(expect.objectContaining({ content: "Persistent title", horizontalAlignment: "right" }));
    expect(to.elements[0]).toEqual(expect.objectContaining({ content: "Persistent title", horizontalAlignment: "right" }));
    expect(compileTransition(from, to).operations[0]).toEqual(expect.objectContaining({
      type: "change",
      effectiveBehavior: "morph",
      renderMode: "single",
    }));
  });

  it("resolves omitted padding to zero and interpolates all four canvas-relative sides", () => {
    const from = toSlideSnapshot(document(), "one");
    const to = toSlideSnapshot(document(), "two");
    expect(from.elements[0]).toEqual(expect.objectContaining({
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
    const operation = compileTransition(from, to).operations[0]!;
    const length = (value: number) => `${(value / 1920) * 100}cqw`;
    expect(operation.keyframes).toEqual([
      expect.objectContaining({
        paddingTop: length(0), paddingRight: length(0),
        paddingBottom: length(0), paddingLeft: length(0),
      }),
      expect.objectContaining({
        paddingTop: length(10), paddingRight: length(20),
        paddingBottom: length(30), paddingLeft: length(40),
      }),
    ]);
  });

  it("keeps the padded text node on the border box", () => {
    const host = globalThis.document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.renderSlide(document(), "two");
    const node = host.querySelector<HTMLElement>("[data-element-id=title]")!;
    expect(node.style.boxSizing).toBe("border-box");
    expect(node.textContent).toBe("Persistent title");
    // jsdom discards cqw values on padding. The Chromium contract verifies the
    // four computed sides and their interpolation in the actual browser engine.
  });
});
