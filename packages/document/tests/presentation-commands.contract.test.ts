import { describe, expect, it } from "vitest";
import {
  applyDeksPresentationCommands,
  assertDeksPresentationDocument,
  type DeksPresentationDocument,
} from "../src";

function presentation(): DeksPresentationDocument {
  return {
    format: "deks",
    version: 2,
    id: "deck-1",
    name: "Demo",
    revision: 4,
    canvas: { width: 1600, height: 900 },
    motionBeatMs: 600,
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
    elements: [{ id: "deck-1:title", kind: "text", name: "Title", isLocked: false }],
    slides: [
      {
        id: "deck-1:slide-1",
        name: "Intro",
        isTemplate: false,
        background: { kind: "solid", color: "#0b0c0e" },
        inPreset: "fade",
        outPreset: "fade",
        inDurationMultiplier: 1,
        outDurationMultiplier: 1,
        states: [{
          elementId: "deck-1:title",
          x: 100,
          y: 100,
          width: 800,
          height: 100,
          rotationDeg: 0,
          opacity: 1,
          zIndex: 1,
          content: "Hello",
          fill: "#f2f1ec",
        }],
      },
    ],
    transitions: [],
  };
}

describe("canonical v2 presentation commands", () => {
  it("applies a batch atomically as one revision and reports a precise change set", () => {
    const source = presentation();
    const result = applyDeksPresentationCommands(source, [
      { type: "define-element", element: { id: "deck-1:icon", kind: "icon", name: "Governance", isLocked: false } },
      {
        type: "add-element-state",
        slideId: "deck-1:slide-1",
        state: {
          elementId: "deck-1:icon",
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
    expect(result.presentation.revision).toBe(5);
    expect(result.presentation.elements).toHaveLength(2);
    expect(result.changeSet).toEqual({
      baseRevision: 4,
      revision: 5,
      changedPresentation: false,
      changedSlideIds: ["deck-1:slide-1"],
      changedElementIds: ["deck-1:icon"],
      changedTransitionIds: [],
      structuralChange: true,
    });
    expect(() => assertDeksPresentationDocument(result.presentation)).not.toThrow();
  });

  it("rejects undeclared references and leaves the source unchanged", () => {
    const source = presentation();
    expect(() => applyDeksPresentationCommands(source, [{
      type: "add-element-state",
      slideId: "deck-1:slide-1",
      state: {
        elementId: "deck-1:missing",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotationDeg: 0,
        opacity: 1,
        zIndex: 1,
      },
    }])).toThrow(/declared|missing/i);
    expect(source).toEqual(presentation());
  });

  it("deletes an identity and all of its states as one structural change", () => {
    const result = applyDeksPresentationCommands(presentation(), [
      { type: "delete-element", elementId: "deck-1:title" },
    ]);

    expect(result.presentation.elements).toEqual([]);
    expect(result.presentation.slides[0]?.states).toEqual([]);
    expect(result.changeSet.changedElementIds).toEqual(["deck-1:title"]);
    expect(result.changeSet.changedSlideIds).toEqual(["deck-1:slide-1"]);
    expect(result.changeSet.structuralChange).toBe(true);
  });

  it("rejects duplicate state references within a slide", () => {
    const source = presentation();
    expect(() => applyDeksPresentationCommands(source, [{
      type: "add-element-state",
      slideId: "deck-1:slide-1",
      state: { ...source.slides[0]!.states[0]! },
    }])).toThrow(/already exists|duplicate/i);
  });
});
