import { describe, expect, it } from "vitest";
import {
  applyDeksCommands,
  assertDeksDocument,
  type DeksDocument,
} from "../src";

function document(): DeksDocument {
  return {
    format: "deks",
    id: "deck-1",
    name: "Demo",
    revision: 4,
    canvas: { width: 1600, height: 900 },
    motionBeatMs: 600,
    motion: {
      in: { animation: { kind: "fade" }, durationBeats: 1, delayMs: 0, easing: "ease-out" },
      out: { animation: { kind: "fade" }, durationBeats: 1, delayMs: 0, easing: "ease-in" },
      morph: { animation: { kind: "morph" }, durationBeats: 1, delayMs: 0, easing: "ease-in-out" },
    },
    palette: {
      primary: "#ff7043",
      secondary: "#65c18c",
      accent: "#73a7ff",
      background: "#0b0c0e",
      text: "#f2f1ec",
      subtext: "#969da6",
    },
    history: { canUndo: false, canRedo: false },
    assets: [],
    elements: [{ id: "title", kind: "text", name: "Title", isLocked: false }],
    slides: [
      {
        id: "slide-1",
        name: "Intro",
        isTemplate: false,
        background: { kind: "solid", color: "#0b0c0e" },
        states: [{
          elementId: "title",
          x: 100,
          y: 100,
          width: 800,
          height: 100,
          rotationDeg: 0,
          opacity: 1,
          zIndex: 1,
          content: "Hello",
          fontFamily: "Poppins",
          fontSize: 48,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: 0,
          horizontalAlignment: "left",
          verticalAlignment: "top",
          overflowMode: "hidden",
          fill: "#f2f1ec",
        }],
      },
    ],
  };
}

describe("canonical document commands", () => {
  it("applies a batch atomically as one revision and reports a precise change set", () => {
    const source = document();
    const result = applyDeksCommands(source, [
      { type: "define-element", element: { id: "icon", kind: "icon", name: "Governance", isLocked: false } },
      {
        type: "add-element-state",
        slideId: "slide-1",
        state: {
          elementId: "icon",
          x: 100,
          y: 300,
          width: 96,
          height: 96,
          rotationDeg: 0,
          opacity: 1,
          zIndex: 2,
          iconFamily: "lucide",
          iconName: "shield-check",
          fill: "#ff7043",
          strokeWidth: 2,
        },
      },
    ]);

    expect(source.revision).toBe(4);
    expect(source.elements).toHaveLength(1);
    expect(result.document.revision).toBe(5);
    expect(result.document.elements).toHaveLength(2);
    expect(result.changeSet).toEqual({
      baseRevision: 4,
      revision: 5,
      changedPresentation: false,
      changedSlideIds: ["slide-1"],
      changedElementIds: ["icon"],
      structuralChange: true,
    });
    expect(() => assertDeksDocument(result.document)).not.toThrow();
  });

  it("rejects undeclared references and leaves the source unchanged", () => {
    const source = document();
    expect(() => applyDeksCommands(source, [{
      type: "add-element-state",
      slideId: "slide-1",
      state: {
        elementId: "missing",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotationDeg: 0,
        opacity: 1,
        zIndex: 1,
      },
    }])).toThrow(/declared|missing/i);
    expect(source).toEqual(document());
  });

  it("deletes an identity and all of its states as one structural change", () => {
    const result = applyDeksCommands(document(), [
      { type: "delete-element", elementId: "title" },
    ]);

    expect(result.document.elements).toEqual([]);
    expect(result.document.slides[0]?.states).toEqual([]);
    expect(result.changeSet.changedElementIds).toEqual(["title"]);
    expect(result.changeSet.changedSlideIds).toEqual(["slide-1"]);
    expect(result.changeSet.structuralChange).toBe(true);
  });

  it("rejects duplicate state references within a slide", () => {
    const source = document();
    expect(() => applyDeksCommands(source, [{
      type: "add-element-state",
      slideId: "slide-1",
      state: { ...source.slides[0]!.states[0]! },
    }])).toThrow(/already exists|duplicate/i);
  });
});
