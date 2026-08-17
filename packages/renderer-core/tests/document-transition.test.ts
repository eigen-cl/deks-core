import { describe, expect, it } from "vitest";
import type { DeksDocument, DeksSlide, SlideTransition } from "@deks-js/document";
import { toTransitionOptions } from "../src/snapshot.js";

const slide = (id: string, overrides: Partial<DeksSlide> = {}): DeksSlide => ({
  id,
  name: id,
  isTemplate: false,
  background: { kind: "solid", color: "#0B1020" },
  inPreset: "fade",
  outPreset: "fade",
  inDurationMultiplier: 1,
  outDurationMultiplier: 1,
  states: [],
  ...overrides,
});

const documentOf = (slides: DeksSlide[], transitions: SlideTransition[]): DeksDocument => ({
  format: "deks",
  id: "deck",
  name: "Deck",
  revision: 0,
  canvas: { width: 1600, height: 900 },
  motionBeatMs: 600,
  palette: {
    primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
    background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
  },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [],
  slides,
  transitions,
});

describe("toTransitionOptions", () => {
  it("entrega el beat y los multiplicadores canónicos, sin duración absoluta por override", () => {
    const from = slide("one", { outDurationMultiplier: 1 });
    const to = slide("two", { inPreset: "fade", inDurationMultiplier: 1.5 });
    const options = toTransitionOptions(documentOf([from, to], [{
      fromSlideId: "one",
      toSlideId: "two",
      motionBeatMs: 800,
      durationMultiplier: 1.5,
      effectiveDurationMs: 1200,
      delayMs: 80,
      easing: "ease-in-out",
      overrides: [{ elementId: "title", animate: true, delayMs: 120 }],
      elementMotions: [
        { elementId: "title", direction: "in", preset: "glide-left", durationMultiplier: 0.75, delayMs: 160 },
        { elementId: "title", direction: "out", preset: "glide-right", durationMultiplier: 0.5, delayMs: 40 },
      ],
    }]), "one", "two");

    expect(options.motionBeatMs).toBe(800);
    expect(options.durationMultiplier).toBe(1.5);
    expect(options.delayMs).toBe(80);
    expect(options.inPreset).toEqual({ preset: "fade", durationMultiplier: 1.5 });
    // El override viaja sin `durationMultiplier`: el tramo presta el suyo. Una
    // duración absoluta aquí rompería el reloj compartido de la presentación.
    expect(options.overrides).toEqual({ title: { animate: true, delayMs: 120 } });
    expect(options.elementMotions).toEqual({
      title: {
        in: { preset: "glide-left", durationMultiplier: 0.75, delayMs: 160 },
        out: { preset: "glide-right", durationMultiplier: 0.5, delayMs: 40 },
      },
    });
  });

  it("entrega el preset de la slide cuando no existe un motion puntual", () => {
    const options = toTransitionOptions(documentOf(
      [slide("one", { outPreset: "glide-top", outDurationMultiplier: 0.5 }), slide("two", { inPreset: "glide-bottom" })],
      [{
        fromSlideId: "one", toSlideId: "two", motionBeatMs: 600, durationMultiplier: 1,
        effectiveDurationMs: 600, delayMs: 0, easing: "ease-in-out",
      }],
    ), "one", "two");

    expect(options.inPreset).toEqual({ preset: "glide-bottom", durationMultiplier: 1 });
    expect(options.outPreset).toEqual({ preset: "glide-top", durationMultiplier: 0.5 });
    expect(options.overrides).toBeUndefined();
    expect(options.elementMotions).toBeUndefined();
  });

  it("resuelve la curva declarada como cubic-bezier y exige sus cuatro valores", () => {
    const edge: SlideTransition = {
      fromSlideId: "one", toSlideId: "two", motionBeatMs: 600, durationMultiplier: 1,
      effectiveDurationMs: 600, delayMs: 0, easing: "cubic-bezier",
      bezier: [0.2, 0, 0.1, 1],
    };
    expect(toTransitionOptions(documentOf([slide("one"), slide("two")], [edge]), "one", "two").easing)
      .toBe("cubic-bezier(0.2, 0, 0.1, 1)");

    const { bezier: _dropped, ...incomplete } = edge;
    expect(() => toTransitionOptions(
      documentOf([slide("one"), slide("two")], [incomplete as SlideTransition]), "one", "two",
    )).toThrow(/cubic-bezier/);
  });

  it("reproduce la misma arista en reversa al retroceder", () => {
    const document = documentOf(
      [slide("one", { outPreset: "glide-left", outDurationMultiplier: 2 }), slide("two", { inPreset: "glide-right" })],
      [{
        fromSlideId: "one", toSlideId: "two", motionBeatMs: 600, durationMultiplier: 0.75,
        effectiveDurationMs: 450, delayMs: 30, easing: "ease-in",
      }],
    );

    // El documento sólo guarda `one -> two`; retroceder usa su ritmo, pero la
    // presencia sale de las slides, así que entrar a `one` usa el preset de
    // `one` y no el de la arista.
    const back = toTransitionOptions(document, "two", "one");
    expect(back.durationMultiplier).toBe(0.75);
    expect(back.delayMs).toBe(30);
    expect(back.inPreset).toEqual({ preset: "fade", durationMultiplier: 1 });
    expect(back.outPreset).toEqual({ preset: "fade", durationMultiplier: 1 });
  });

  it("falla cuando la arista o una de sus slides no existe", () => {
    const document = documentOf([slide("one"), slide("two")], []);
    expect(() => toTransitionOptions(document, "one", "two")).toThrow(/is missing/);
  });
});
