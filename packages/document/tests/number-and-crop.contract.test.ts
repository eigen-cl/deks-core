import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  DeksPresentation,
  assertDeksDocument,
  formatDeksNumber,
  type DeksDocument,
  type NumberFormat,
} from "../src";

const schema = JSON.parse(readFileSync(
  new URL("../src/schema/deks-document.schema.json", import.meta.url),
  "utf8",
)) as object;

const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);

const FORMAT: NumberFormat = {
  decimals: 1,
  groupSeparator: ",",
  decimalSeparator: ".",
  symbol: "%",
  symbolPosition: "after",
};

const TYPOGRAPHY = {
  fontFamily: "Poppins",
  fontSize: 148,
  fontWeight: 600,
  lineHeight: 1,
  letterSpacing: -6,
  horizontalAlignment: "center",
  verticalAlignment: "middle",
  overflowMode: "hidden",
  fill: "#65c18c",
} as const;

function deckWithNumber(animateMagnitude?: { in?: boolean; morph?: boolean; out?: boolean }) {
  const deck = new DeksPresentation({ id: "figures", name: "Figures" });
  const figure = deck.defineElement({
    id: "growth",
    kind: "number",
    name: "Growth",
    ...(animateMagnitude === undefined ? {} : { animateMagnitude }),
    defaults: { ...FORMAT, ...TYPOGRAPHY, value: 0 },
  });
  deck.addSlide({ id: "before", name: "Before" })
    .place(figure, { x: 100, y: 100, width: 600, height: 300, value: 12.5 });
  deck.addSlide({ id: "after", name: "After" })
    .continue(figure, { value: 38.5 });
  return { deck, figure };
}

describe("number element", () => {
  it("carries a magnitude with its own complete formatting and no content", () => {
    const document = deckWithNumber().deck.toDocument();
    expect(() => assertDeksDocument(document)).not.toThrow();
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);

    const state = document.slides[0]!.states[0]!;
    expect(state.value).toBe(12.5);
    expect(state).not.toHaveProperty("content");
    expect(state.symbol).toBe("%");
    expect(state.symbolPosition).toBe("after");
  });

  it("declares the three magnitude toggles on identity, never on a state", () => {
    const document = deckWithNumber({ in: true, morph: true }).deck.toDocument();
    const identity = document.elements.find(({ id }) => id === "growth")!;

    // Complete even when the author only named two: a missing role would leave
    // the decision to a renderer default.
    expect(identity.animateMagnitude).toEqual({ in: true, morph: true, out: false });
    expect(document.slides[0]!.states[0]).not.toHaveProperty("animateMagnitude");

    const onAState = deckWithNumber().deck.toDocument();
    Object.assign(onAState.slides[0]!.states[0]!, { animateMagnitude: { in: true, morph: false, out: false } });
    expect(() => assertDeksDocument(onAState)).toThrow(/animateMagnitude|unknown property/i);
    expect(validate(onAState)).toBe(false);
  });

  it("refuses magnitude toggles on anything that is not a number", () => {
    const deck = new DeksPresentation({ id: "deck", name: "Deck" });
    expect(() => deck.defineElement({
      id: "title",
      kind: "text",
      name: "Title",
      animateMagnitude: { in: true },
    })).toThrow(/animateMagnitude|number/i);
  });

  it("refuses separators that would make the digits ambiguous", () => {
    const document = deckWithNumber().deck.toDocument();
    Object.assign(document.slides[0]!.states[0]!, { groupSeparator: ".", decimalSeparator: "." });
    expect(() => assertDeksDocument(document)).toThrow(/groupSeparator|decimalSeparator/i);
  });

  it("requires every formatting field, so a renderer default never becomes document meaning", () => {
    for (const field of ["value", "decimals", "groupSeparator", "decimalSeparator", "symbol", "symbolPosition"] as const) {
      const document = deckWithNumber().deck.toDocument();
      delete (document.slides[0]!.states[0] as Record<string, unknown>)[field];
      expect(() => assertDeksDocument(document), field).toThrow(new RegExp(`${field}|required`, "i"));
    }
  });
});

describe("formatDeksNumber", () => {
  it("is a pure function of the document, never of a locale", () => {
    expect(formatDeksNumber(1234.56, FORMAT)).toBe("1,234.6%");
    expect(formatDeksNumber(1234.56, { ...FORMAT, groupSeparator: ".", decimalSeparator: "," })).toBe("1.234,6%");
    expect(formatDeksNumber(1234.56, { ...FORMAT, groupSeparator: "" })).toBe("1234.6%");
    expect(formatDeksNumber(38, { ...FORMAT, decimals: 0, symbol: "$", symbolPosition: "before" })).toBe("$38");
    expect(formatDeksNumber(38, { ...FORMAT, symbol: "" })).toBe("38.0");
  });

  it("groups from the right whatever the magnitude", () => {
    const plain = { ...FORMAT, decimals: 0, symbol: "" };
    expect(formatDeksNumber(1, plain)).toBe("1");
    expect(formatDeksNumber(999, plain)).toBe("999");
    expect(formatDeksNumber(1_000, plain)).toBe("1,000");
    expect(formatDeksNumber(1_234_567, plain)).toBe("1,234,567");
  });

  it("keeps a rounded-away sign from surfacing as negative zero", () => {
    const plain = { ...FORMAT, decimals: 0, symbol: "" };
    expect(formatDeksNumber(-0.4, plain)).toBe("0");
    expect(formatDeksNumber(-1.4, plain)).toBe("-1");
    expect(formatDeksNumber(-1234.5, { ...plain, decimals: 1 })).toBe("-1,234.5");
  });

  it("keeps precision fixed so a counting frame never gains or loses digits", () => {
    const partial = [0, 12.3456, 38.5].map((value) => formatDeksNumber(value, FORMAT));
    expect(partial).toEqual(["0.0%", "12.3%", "38.5%"]);
    for (const rendered of partial) expect(rendered.split(".")[1]).toHaveLength(2);
  });

  it("refuses a magnitude or precision it cannot render honestly", () => {
    expect(() => formatDeksNumber(Number.NaN, FORMAT)).toThrow(/finite/i);
    expect(() => formatDeksNumber(1, { ...FORMAT, decimals: 7 })).toThrow(/decimals/i);
    expect(() => formatDeksNumber(1, { ...FORMAT, decimals: -1 })).toThrow(/decimals/i);
  });
});

describe("crop motion", () => {
  function withCrop(edge: string): DeksDocument {
    const { deck } = deckWithNumber();
    const document = deck.toDocument();
    document.motion.in = { animation: { kind: "crop", edge } as never, durationBeats: 1, delayMs: 0, easing: "ease-out" };
    return document;
  }

  it("accepts every edge and takes no distance", () => {
    for (const edge of ["left", "right", "top", "bottom"]) {
      const document = withCrop(edge);
      expect(() => assertDeksDocument(document), edge).not.toThrow();
      expect(validate(document), `${edge}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }

    const withDistance = withCrop("left");
    Object.assign(withDistance.motion.in.animation, { distance: 40 });
    expect(() => assertDeksDocument(withDistance)).toThrow(/distance|unknown property/i);
    expect(validate(withDistance)).toBe(false);
  });

  it("is one animation played in both presence roles, not two kinds", () => {
    const document = withCrop("bottom");
    document.motion.out = { animation: { kind: "crop", edge: "top" } as never, durationBeats: 1, delayMs: 0, easing: "ease-in" };
    expect(() => assertDeksDocument(document)).not.toThrow();

    // A morph is still only morph or cut; crop has nothing to interpolate to.
    const onMorph = withCrop("left");
    Object.assign(onMorph.motion.morph, { animation: { kind: "crop", edge: "left" } });
    expect(() => assertDeksDocument(onMorph)).toThrow(/kind|unsupported/i);
  });
});
