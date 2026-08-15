import type { DeksDocument, ElementState, Slide } from "./types.js";
import type {
  DeksAssetDescriptor,
  DeksPresentationDocument,
  DeksPresentationElement,
  DeksPresentationState,
} from "./presentation.js";
import { assertDeksDocument, isHttpsUrl } from "./validation.js";
import { assertDeksPresentationDocument } from "./presentation-validation.js";

function stateWithoutIdentity(element: ElementState): DeksPresentationState {
  const { id: _id, kind: _kind, name: _name, shapeKind: _shapeKind, ...state } = element;
  return { elementId: element.id, ...structuredClone(state) };
}

function assetDescriptor(element: ElementState, presentationId: string): DeksAssetDescriptor | undefined {
  if (element.kind !== "image") return undefined;
  const id = element.assetId ?? `${presentationId}:asset:${element.id}`;
  if (element.assetUrl && isHttpsUrl(element.assetUrl)) {
    return { id, kind: "remote", url: element.assetUrl };
  }
  return { id, kind: "embedded", mediaType: "application/octet-stream" };
}

/** Upgrade the flat renderer-compatible v1 document into normalized canonical v2. */
export function upgradeDeksDocumentToPresentation(document: DeksDocument): DeksPresentationDocument {
  assertDeksDocument(document);
  const identities = new Map<string, DeksPresentationElement>();
  const assets = new Map<string, DeksAssetDescriptor>();
  for (const slide of document.slides) {
    for (const element of slide.elements) {
      const existing = identities.get(element.id);
      if (existing && (existing.kind !== element.kind || existing.name !== element.name)) {
        throw new Error(`element ${element.id} has inconsistent identity across v1 slides`);
      }
      if (!existing) identities.set(element.id, {
        id: element.id,
        kind: element.kind,
        name: element.name,
        ...(element.kind === "shape" ? { shapeKind: element.shapeKind ?? "rectangle" } : {}),
        isLocked: false,
      });
      const descriptor = assetDescriptor(element, document.id);
      if (descriptor && !assets.has(descriptor.id)) assets.set(descriptor.id, descriptor);
    }
  }
  const presentation: DeksPresentationDocument = {
    format: "deks",
    version: 2,
    id: document.id,
    name: document.name,
    revision: document.revision,
    canvas: { width: document.canvasWidth, height: document.canvasHeight },
    motionBeatMs: document.motionBeatMs,
    palette: structuredClone(document.palette),
    history: structuredClone(document.history),
    assets: [...assets.values()],
    elements: [...identities.values()],
    slides: document.slides.map((slide) => ({
      id: slide.id,
      name: slide.name,
      isTemplate: slide.isTemplate,
      background: structuredClone(slide.background),
      inPreset: slide.inPreset,
      outPreset: slide.outPreset,
      inDurationMultiplier: slide.inDurationMultiplier,
      outDurationMultiplier: slide.outDurationMultiplier,
      states: slide.elements.map((element) => {
        const state = stateWithoutIdentity(element);
        if (element.kind === "image") {
          const descriptor = assetDescriptor(element, document.id);
          delete state.assetUrl;
          if (descriptor) state.assetId = descriptor.id;
        }
        return state;
      }),
    })),
    transitions: structuredClone(document.transitions),
  };
  assertDeksPresentationDocument(presentation);
  return presentation;
}

/** Project canonical v2 to the flat document consumed by current renderer/react/web packages. */
export function downgradeDeksPresentationToDocument(presentation: DeksPresentationDocument): DeksDocument {
  assertDeksPresentationDocument(presentation);
  const identities = new Map(presentation.elements.map((element) => [element.id, element]));
  const slides: Slide[] = presentation.slides.map((slide) => ({
    id: slide.id,
    name: slide.name,
    isTemplate: slide.isTemplate,
    background: structuredClone(slide.background),
    inPreset: slide.inPreset,
    outPreset: slide.outPreset,
    inDurationMultiplier: slide.inDurationMultiplier,
    outDurationMultiplier: slide.outDurationMultiplier,
    elements: slide.states.flatMap((state): ElementState[] => {
      const identity = identities.get(state.elementId)!;
      const { elementId: _elementId, ...payload } = structuredClone(state);
      const element: ElementState = {
        ...payload,
        id: identity.id,
        kind: identity.kind,
        name: identity.name,
        ...(identity.kind === "shape" ? { shapeKind: identity.shapeKind ?? "rectangle" } : {}),
      };
      return [element];
    }),
  }));
  const visibleIds = new Set(slides.flatMap((slide) => slide.elements.map(({ id }) => id)));
  const document: DeksDocument = {
    id: presentation.id,
    name: presentation.name,
    revision: presentation.revision,
    canvasWidth: presentation.canvas.width,
    canvasHeight: presentation.canvas.height,
    motionBeatMs: presentation.motionBeatMs,
    palette: structuredClone(presentation.palette),
    history: structuredClone(presentation.history),
    slides,
    transitions: presentation.transitions.map((transition) => ({
      ...structuredClone(transition),
      ...(transition.overrides === undefined ? {} : { overrides: transition.overrides.filter(({ elementId }) => visibleIds.has(elementId)) }),
      ...(transition.elementMotions === undefined ? {} : { elementMotions: transition.elementMotions.filter(({ elementId }) => visibleIds.has(elementId)) }),
    })),
  };
  assertDeksDocument(document);
  return document;
}
