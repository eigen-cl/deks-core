import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import {
  applyDeksCommands,
  assertDeksDocument,
  deksDocumentSchema,
  migrateDeksDocument,
  type DeksDocument,
  type DeksSlideNarration,
} from "../src";

function document(): DeksDocument {
  return {
    format: "deks",
    codecVersion: 3,
    id: "narrated-deck",
    name: "Narrated deck",
    revision: 2,
    canvas: { width: 1600, height: 900 },
    motionBeatMs: 600,
    motion: {
      in: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-out" },
      out: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in" },
      morph: { animation: { kind: "morph" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in-out" },
    },
    palette: {
      primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
      background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
    },
    history: { canUndo: false, canRedo: false },
    assets: [{ id: "voice-intro", kind: "embedded", mediaType: "audio/wav", originalFilename: "intro.wav" }],
    elements: [],
    slides: [{
      id: "slide-1",
      name: "Intro",
      isTemplate: false,
      background: { kind: "solid", color: "#0b0c0e" },
      states: [],
    }],
  };
}

const narration = (): DeksSlideNarration => ({
  script: "Welcome to the presentation.",
  pauseBeforeMs: 250,
  pauseAfterMs: 800,
  audio: { assetId: "voice-intro", provenance: "synthetic" },
});

describe("portable slide narration", () => {
  it("migrates v2 to v3 without inventing narration and without mutating the source", () => {
    const source = structuredClone(document()) as unknown as Record<string, unknown> & {
      slides: Array<Record<string, unknown>>;
    };
    source.codecVersion = 2;

    const migrated = migrateDeksDocument(source);

    expect(migrated).toMatchObject({ fromVersion: 2, toVersion: 3, warnings: [] });
    expect(migrated.document.codecVersion).toBe(3);
    expect(migrated.document.slides[0]).not.toHaveProperty("narration");
    expect(source.codecVersion).toBe(2);
  });

  it("rejects future documents instead of guessing their semantics", () => {
    const future = { ...document(), codecVersion: 4 };
    expect(() => migrateDeksDocument(future)).toThrow(/future codecVersion 4.*current version is 3/i);
  });

  it("accepts a complete narration and a script-only draft", () => {
    const ready = document();
    ready.slides[0]!.narration = narration();
    expect(() => assertDeksDocument(ready)).not.toThrow();
    const validate = new Ajv2020({ strict: true, strictRequired: false }).compile(deksDocumentSchema);
    expect(validate(ready), JSON.stringify(validate.errors)).toBe(true);

    const draft = document();
    draft.slides[0]!.narration = {
      script: "This still needs a recording.",
      pauseBeforeMs: 0,
      pauseAfterMs: 0,
    };
    expect(() => assertDeksDocument(draft)).not.toThrow();
  });

  it("requires narration audio to reference an embedded supported audio asset", () => {
    const cases: Array<[string, (deck: DeksDocument) => void]> = [
      ["missing", (deck) => { deck.slides[0]!.narration = { ...narration(), audio: { assetId: "missing", provenance: "synthetic" } }; }],
      ["embedded audio", (deck) => { deck.assets[0] = { id: "voice-intro", kind: "embedded", mediaType: "image/png" }; deck.slides[0]!.narration = narration(); }],
      ["embedded", (deck) => { deck.assets[0] = { id: "voice-intro", kind: "remote", url: "https://assets.example.com/intro.wav", mediaType: "audio/wav" }; deck.slides[0]!.narration = narration(); }],
    ];
    for (const [message, mutate] of cases) {
      const candidate = document();
      mutate(candidate);
      expect(() => assertDeksDocument(candidate), message).toThrow(new RegExp(message, "i"));
    }
  });

  it("bounds scripts and pauses and rejects unknown provenance", () => {
    const invalid: unknown[] = [
      { ...narration(), script: "" },
      { ...narration(), script: "bad\u0001script" },
      { ...narration(), pauseBeforeMs: -1 },
      { ...narration(), pauseAfterMs: 60_001 },
      { ...narration(), pauseAfterMs: 1.5 },
      { ...narration(), audio: { assetId: "voice-intro", provenance: "cloned" } },
      { ...narration(), provider: "host-only" },
    ];
    for (const candidate of invalid) {
      const deck = document();
      deck.slides[0]!.narration = candidate as DeksSlideNarration;
      expect(() => assertDeksDocument(deck)).toThrow();
    }
  });

  it("sets and clears narration as explicit JSON-safe commands", () => {
    const source = document();
    const set = applyDeksCommands(source, [{
      type: "set-slide-narration",
      slideId: "slide-1",
      narration: narration(),
    }]);

    expect(set.document.slides[0]!.narration).toEqual(narration());
    expect(set.changeSet.changedSlideIds).toEqual(["slide-1"]);
    expect(set.document.revision).toBe(3);
    expect(source.slides[0]).not.toHaveProperty("narration");

    const cleared = applyDeksCommands(set.document, [{ type: "clear-slide-narration", slideId: "slide-1" }]);
    expect(cleared.document.slides[0]).not.toHaveProperty("narration");
  });

  it("does not remove an asset while narration still references it", () => {
    const source = document();
    source.slides[0]!.narration = narration();

    expect(() => applyDeksCommands(source, [{ type: "remove-asset", assetId: "voice-intro" }]))
      .toThrow(/voice-intro.*referenced/i);
    expect(source.assets).toHaveLength(1);
  });
});
