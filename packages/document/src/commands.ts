import type { DeksDocument, ElementState, MotionRatio, Slide, SlideTransition } from "./types.js";

export type DeksCommand =
  | { type: "update-presentation"; patch: Partial<Pick<DeksDocument, "name" | "motionBeatMs">> }
  | { type: "create-slide"; slide: Slide; afterSlideId?: string }
  | { type: "update-slide"; slideId: string; patch: Partial<Omit<Slide, "id" | "elements">> }
  | { type: "reorder-slides"; slideIds: string[] }
  | { type: "delete-slide"; slideId: string }
  | { type: "create-element"; slideId: string; element: ElementState }
  | { type: "update-element"; slideId: string; element: ElementState }
  | { type: "delete-element"; slideId: string; elementId: string }
  | { type: "set-transition"; fromSlideId: string; toSlideId: string; patch: Partial<Pick<SlideTransition, "durationMultiplier" | "delayMs" | "easing" | "bezier" | "overrides" | "elementMotions">> };

export type DeksEditorChangeKind = "presentation" | "slides" | "elements" | "transitions" | "assets";

export interface DeksEditorChange {
  kind: DeksEditorChangeKind;
  document: DeksDocument;
  previousDocument: DeksDocument;
  operation: DeksCommand;
}

export type DeksEditorChangeResult = boolean | void | { document: DeksDocument };
export type DeksEditorChangeHandler = (change: DeksEditorChange) => DeksEditorChangeResult | Promise<DeksEditorChangeResult>;

export function commandKind(command: DeksCommand): DeksEditorChangeKind {
  if (command.type === "update-presentation") return "presentation";
  if (command.type.includes("slide")) return "slides";
  if (command.type.includes("element")) return "elements";
  return "transitions";
}

function adjacentTransitions(document: DeksDocument, slides: Slide[]): SlideTransition[] {
  return slides.slice(0, -1).map((slide, index) => {
    const to = slides[index + 1]!;
    const existing = document.transitions.find((edge) => edge.fromSlideId === slide.id && edge.toSlideId === to.id);
    return existing ?? {
      fromSlideId: slide.id,
      toSlideId: to.id,
      motionBeatMs: document.motionBeatMs,
      durationMultiplier: 1 as MotionRatio,
      effectiveDurationMs: document.motionBeatMs,
      delayMs: 0,
      easing: "ease-in-out",
    };
  });
}

export function applyDeksCommand(source: DeksDocument, command: DeksCommand): DeksDocument {
  const document = structuredClone(source);
  switch (command.type) {
    case "update-presentation":
      Object.assign(document, command.patch);
      if (command.patch.motionBeatMs !== undefined) {
        document.transitions = document.transitions.map((edge) => ({
          ...edge,
          motionBeatMs: command.patch.motionBeatMs!,
          effectiveDurationMs: command.patch.motionBeatMs! * edge.durationMultiplier,
        }));
      }
      break;
    case "create-slide": {
      if (document.slides.some(({ id }) => id === command.slide.id)) throw new Error(`slide ${command.slide.id} already exists`);
      const index = command.afterSlideId === undefined ? document.slides.length : document.slides.findIndex(({ id }) => id === command.afterSlideId) + 1;
      if (index === 0) throw new Error(`slide ${command.afterSlideId} is missing`);
      document.slides.splice(index, 0, structuredClone(command.slide));
      document.transitions = adjacentTransitions(document, document.slides);
      break;
    }
    case "update-slide": {
      const slide = document.slides.find(({ id }) => id === command.slideId);
      if (!slide) throw new Error(`slide ${command.slideId} is missing`);
      Object.assign(slide, command.patch);
      break;
    }
    case "reorder-slides": {
      if (command.slideIds.length !== document.slides.length || new Set(command.slideIds).size !== document.slides.length) throw new Error("slide order is incomplete");
      const reordered = command.slideIds.map((id) => document.slides.find((slide) => slide.id === id));
      if (reordered.some((slide) => !slide)) throw new Error("slide order contains a missing slide");
      document.slides = reordered as Slide[];
      document.transitions = adjacentTransitions(document, document.slides);
      break;
    }
    case "delete-slide": {
      const index = document.slides.findIndex(({ id }) => id === command.slideId);
      if (index < 0) throw new Error(`slide ${command.slideId} is missing`);
      if (document.slides.length === 1) throw new Error("the last slide cannot be deleted");
      document.slides.splice(index, 1);
      document.transitions = adjacentTransitions(document, document.slides);
      break;
    }
    case "create-element": {
      const slide = document.slides.find(({ id }) => id === command.slideId);
      if (!slide) throw new Error(`slide ${command.slideId} is missing`);
      if (slide.elements.some(({ id }) => id === command.element.id)) throw new Error(`element ${command.element.id} already exists`);
      slide.elements.push(structuredClone(command.element));
      break;
    }
    case "update-element": {
      const slide = document.slides.find(({ id }) => id === command.slideId);
      const index = slide?.elements.findIndex(({ id }) => id === command.element.id) ?? -1;
      if (!slide || index < 0) throw new Error(`element ${command.element.id} is missing`);
      slide.elements[index] = structuredClone(command.element);
      break;
    }
    case "delete-element": {
      const slide = document.slides.find(({ id }) => id === command.slideId);
      const index = slide?.elements.findIndex(({ id }) => id === command.elementId) ?? -1;
      if (!slide || index < 0) throw new Error(`element ${command.elementId} is missing`);
      slide.elements.splice(index, 1);
      break;
    }
    case "set-transition": {
      const edge = document.transitions.find(({ fromSlideId, toSlideId }) => fromSlideId === command.fromSlideId && toSlideId === command.toSlideId);
      if (!edge) throw new Error(`transition ${command.fromSlideId}:${command.toSlideId} is missing`);
      Object.assign(edge, command.patch);
      edge.effectiveDurationMs = edge.motionBeatMs * edge.durationMultiplier;
      break;
    }
  }
  document.revision = source.revision + 1;
  document.history = { canUndo: true, canRedo: false };
  return document;
}
