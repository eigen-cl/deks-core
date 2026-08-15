import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  downgradeDeksPresentationToDocument,
  parseDeksPresentationJson,
  upgradeDeksDocumentToPresentation,
  type DeksDocument,
} from "../src";

describe("v2 and flat renderer compatibility codecs", () => {
  it("projects the complete v2 fixture without duplicating identity in states", () => {
    const fixture = parseDeksPresentationJson(readFileSync(new URL("./fixtures/presentation-v2.complete.json", import.meta.url), "utf8"));
    const flat = downgradeDeksPresentationToDocument(fixture);

    expect(flat.canvasWidth).toBe(1600);
    expect(flat.slides[0]?.elements.find(({ kind }) => kind === "group")).toMatchObject({
      name: "Governance cluster",
    });
    expect(flat.slides[0]?.elements.find(({ id }) => id.endsWith("0003"))).toMatchObject({
      kind: "shape",
      shapeKind: "rectangle",
      name: "Boundary",
      cornerRadius: 24,
      cornerRadii: { topLeft: 8, topRight: 16, bottomRight: 24, bottomLeft: 32 },
    });
    expect(flat.slides[0]?.elements.find(({ id }) => id.endsWith("0004"))).toMatchObject({
      kind: "image",
      assetId: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("round-trips a valid flat v1 document through the v2 registry", () => {
    const flat: DeksDocument = {
      id: "legacy",
      name: "Legacy",
      revision: 2,
      canvasWidth: 1600,
      canvasHeight: 900,
      motionBeatMs: 600,
      palette: { primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff", background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6" },
      history: { canUndo: false, canRedo: false },
      slides: [{
        id: "first", name: "First", isTemplate: false,
        background: { kind: "solid", color: "#0b0c0e" },
        inPreset: "fade", outPreset: "fade", inDurationMultiplier: 1, outDurationMultiplier: 1,
        elements: [{ id: "title", kind: "text", name: "Title", x: 0, y: 0, width: 100, height: 50, rotationDeg: 0, opacity: 1, zIndex: 1, content: "A" }],
      }],
      transitions: [],
    };
    expect(downgradeDeksPresentationToDocument(upgradeDeksDocumentToPresentation(flat))).toEqual(flat);
  });

  it("does not leak a persisted remote URL into the renderer projection", () => {
    const fixture = parseDeksPresentationJson(readFileSync(new URL("./fixtures/presentation-v2.complete.json", import.meta.url), "utf8"));
    const remote = fixture.assets.find(({ kind }) => kind === "remote");
    const image = fixture.elements.find(({ kind }) => kind === "image");
    expect(remote).toBeDefined();
    expect(image).toBeDefined();
    fixture.slides[0]!.states.find(({ elementId }) => elementId === image!.id)!.assetId = remote!.id;

    const flat = downgradeDeksPresentationToDocument(fixture);
    const projected = flat.slides[0]!.elements.find(({ id }) => id === image!.id);
    expect(projected).toMatchObject({ assetId: remote!.id });
    expect(projected).not.toHaveProperty("assetUrl");
  });

  it("rejects a flat document whose repeated id changes identity", () => {
    const flat = downgradeDeksPresentationToDocument(parseDeksPresentationJson(readFileSync(new URL("./fixtures/presentation-v2.complete.json", import.meta.url), "utf8")));
    flat.slides[1]!.elements[0]!.name = "Conflicting title";
    expect(() => upgradeDeksDocumentToPresentation(flat)).toThrow(/inconsistent identity/i);
  });
});
