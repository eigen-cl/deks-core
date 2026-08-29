import { describe, expect, it } from "vitest";
import {
  areElementsCollisionCandidates,
  createElementCollisionCandidatePredicate,
  DeksPresentation,
  effectiveGroupId,
  type DeksDocument,
  type DeksElement,
} from "../src";

const group = (id: string, parentId?: string): DeksElement => ({
  id,
  kind: "group",
  name: id,
  ...(parentId === undefined ? {} : { parentId }),
  isLocked: false,
});

const shape = (id: string, parentId?: string): DeksElement => ({
  id,
  kind: "shape",
  name: id,
  shapeKind: "rectangle",
  ...(parentId === undefined ? {} : { parentId }),
  isLocked: false,
});

const documentWith = (elements: DeksElement[]): Pick<DeksDocument, "elements"> => ({ elements });

describe("logical element groups", () => {
  it("excludes two elements in the same named group from collision candidates", () => {
    const document = documentWith([
      group("hero", undefined),
      shape("hero-background", "hero"),
      shape("hero-copy", "hero"),
    ]);

    expect(effectiveGroupId(document, "hero-background")).toBe("hero");
    const isCollisionCandidate = createElementCollisionCandidatePredicate(document);
    expect(isCollisionCandidate("hero-background", "hero-copy")).toBe(false);
  });

  it("keeps elements in different groups as collision candidates", () => {
    const document = documentWith([
      group("hero"),
      group("footer"),
      shape("hero-copy", "hero"),
      shape("footer-copy", "footer"),
    ]);

    expect(areElementsCollisionCandidates(document, "hero-copy", "footer-copy")).toBe(true);
  });

  it("keeps ungrouped pairs and mixed grouped/ungrouped pairs as collision candidates", () => {
    const document = documentWith([
      group("hero"),
      shape("grouped", "hero"),
      shape("free-a"),
      shape("free-b"),
    ]);

    expect(effectiveGroupId(document, "free-a")).toBeUndefined();
    expect(areElementsCollisionCandidates(document, "free-a", "free-b")).toBe(true);
    expect(areElementsCollisionCandidates(document, "grouped", "free-a")).toBe(true);
  });

  it("uses the outermost shared group as the effective group for nested folders", () => {
    const document = documentWith([
      group("section"),
      group("left-column", "section"),
      group("right-column", "section"),
      shape("left-copy", "left-column"),
      shape("right-copy", "right-column"),
      shape("section-rule", "section"),
    ]);

    expect(effectiveGroupId(document, "left-copy")).toBe("section");
    expect(effectiveGroupId(document, "right-copy")).toBe("section");
    expect(areElementsCollisionCandidates(document, "left-copy", "right-copy")).toBe(false);
    expect(areElementsCollisionCandidates(document, "left-copy", "section-rule")).toBe(false);
  });

  it("derives collision semantics from identities even when the group has no slide state", () => {
    const deck = new DeksPresentation({ id: "deck", name: "Grouped deck" });
    deck.defineElement({ id: "badge", kind: "group", name: "Badge" });
    const fill = deck.defineElement({
      id: "badge-fill",
      kind: "shape",
      shapeKind: "rectangle",
      name: "Badge fill",
      parentId: "badge",
    });
    const label = deck.defineElement({
      id: "badge-label",
      kind: "shape",
      shapeKind: "rectangle",
      name: "Badge label",
      parentId: "badge",
    });
    const slide = deck.addSlide({ id: "slide-1", name: "Slide 1" });
    const visual = {
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      shapeFill: { kind: "solid" as const, color: "#ff7043" },
      stroke: "#ffffff",
      strokeWidth: 0,
    };
    slide.place(fill, visual).place(label, visual);
    const document = deck.toDocument();

    expect(document.slides[0]!.states.some(({ elementId }) => elementId === "badge")).toBe(false);
    expect(areElementsCollisionCandidates(document, "badge-fill", "badge-label")).toBe(false);
  });

  it("never treats an identity or a logical group as a collision pair", () => {
    const document = documentWith([group("hero"), shape("hero-copy", "hero")]);

    expect(areElementsCollisionCandidates(document, "hero-copy", "hero-copy")).toBe(false);
    expect(areElementsCollisionCandidates(document, "hero", "hero-copy")).toBe(false);
  });

  it("compiles one reusable predicate for a complete pair scan", () => {
    const document = documentWith([
      group("hero"),
      shape("hero-copy", "hero"),
      shape("hero-art", "hero"),
      shape("free"),
    ]);
    const isCollisionCandidate = createElementCollisionCandidatePredicate(document);

    expect(isCollisionCandidate("hero-copy", "hero-art")).toBe(false);
    expect(isCollisionCandidate("hero-copy", "free")).toBe(true);
  });

  it("rejects unknown identities instead of silently changing validation results", () => {
    const document = documentWith([shape("known")]);

    expect(() => effectiveGroupId(document, "missing")).toThrow(/unknown element missing/i);
    expect(() => areElementsCollisionCandidates(document, "known", "missing")).toThrow(/unknown element missing/i);
  });
});
