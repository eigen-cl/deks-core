import type { Palette, SlideTransition } from "./types.js";
import type {
  DeksAssetDescriptor,
  DeksPresentationDocument,
  DeksPresentationElement,
  DeksPresentationSlide,
  DeksPresentationState,
} from "./presentation.js";
import { assertDeksPresentationDocument } from "./presentation-validation.js";

export type DeksPresentationCommand =
  | { type: "update-presentation"; patch: Partial<Pick<DeksPresentationDocument, "name" | "motionBeatMs">> & { palette?: Partial<Palette> } }
  | { type: "define-asset"; asset: DeksAssetDescriptor }
  | { type: "remove-asset"; assetId: string }
  | { type: "define-element"; element: DeksPresentationElement }
  | { type: "update-element-identity"; elementId: string; patch: Partial<Pick<DeksPresentationElement, "name" | "semanticRole" | "parentId" | "isLocked">> }
  | { type: "delete-element"; elementId: string }
  | { type: "create-slide"; slide: DeksPresentationSlide; afterSlideId?: string }
  | { type: "update-slide"; slideId: string; patch: Partial<Omit<DeksPresentationSlide, "id" | "states">> }
  | { type: "reorder-slides"; slideIds: string[] }
  | { type: "delete-slide"; slideId: string }
  | { type: "add-element-state"; slideId: string; state: DeksPresentationState }
  | { type: "update-element-state"; slideId: string; elementId: string; patch: Partial<Omit<DeksPresentationState, "elementId">> }
  | { type: "remove-element-state"; slideId: string; elementId: string }
  | { type: "set-transition"; fromSlideId: string; toSlideId: string; patch: Partial<Omit<SlideTransition, "fromSlideId" | "toSlideId">> };

export interface DeksChangeSet {
  baseRevision: number;
  revision: number;
  changedPresentation: boolean;
  changedSlideIds: string[];
  changedElementIds: string[];
  changedTransitionIds: string[];
  structuralChange: boolean;
}

export interface DeksPresentationCommandResult {
  presentation: DeksPresentationDocument;
  changeSet: DeksChangeSet;
}

interface MutableChangeSet {
  changedPresentation: boolean;
  changedSlideIds: Set<string>;
  changedElementIds: Set<string>;
  changedTransitionIds: Set<string>;
  structuralChange: boolean;
}

function transitionId(fromSlideId: string, toSlideId: string): string {
  return `${fromSlideId}:${toSlideId}`;
}

function adjacentTransitions(presentation: DeksPresentationDocument): SlideTransition[] {
  return presentation.slides.slice(0, -1).map((slide, index) => {
    const to = presentation.slides[index + 1]!;
    return presentation.transitions.find((edge) => edge.fromSlideId === slide.id && edge.toSlideId === to.id) ?? {
      fromSlideId: slide.id,
      toSlideId: to.id,
      motionBeatMs: presentation.motionBeatMs,
      durationMultiplier: 1,
      effectiveDurationMs: presentation.motionBeatMs,
      delayMs: 0,
      easing: "ease-in-out",
    };
  });
}

function findSlide(presentation: DeksPresentationDocument, slideId: string): DeksPresentationSlide {
  const slide = presentation.slides.find(({ id }) => id === slideId);
  if (!slide) throw new Error(`slide ${slideId} is missing`);
  return slide;
}

function applyOne(
  presentation: DeksPresentationDocument,
  command: DeksPresentationCommand,
  changes: MutableChangeSet,
): void {
  switch (command.type) {
    case "update-presentation":
      if (command.patch.name !== undefined) presentation.name = command.patch.name;
      if (command.patch.palette !== undefined) Object.assign(presentation.palette, command.patch.palette);
      if (command.patch.motionBeatMs !== undefined) {
        presentation.motionBeatMs = command.patch.motionBeatMs;
        for (const edge of presentation.transitions) {
          edge.motionBeatMs = command.patch.motionBeatMs;
          edge.effectiveDurationMs = command.patch.motionBeatMs * edge.durationMultiplier;
          changes.changedTransitionIds.add(transitionId(edge.fromSlideId, edge.toSlideId));
        }
      }
      changes.changedPresentation = true;
      return;
    case "define-asset":
      if (presentation.assets.some(({ id }) => id === command.asset.id)) throw new Error(`asset ${command.asset.id} already exists`);
      presentation.assets.push(structuredClone(command.asset));
      changes.changedPresentation = true;
      changes.structuralChange = true;
      return;
    case "remove-asset": {
      if (presentation.slides.some((slide) => slide.states.some(({ assetId }) => assetId === command.assetId))) {
        throw new Error(`asset ${command.assetId} is still referenced`);
      }
      const index = presentation.assets.findIndex(({ id }) => id === command.assetId);
      if (index < 0) throw new Error(`asset ${command.assetId} is missing`);
      presentation.assets.splice(index, 1);
      changes.changedPresentation = true;
      changes.structuralChange = true;
      return;
    }
    case "define-element":
      if (presentation.elements.some(({ id }) => id === command.element.id)) throw new Error(`element ${command.element.id} already exists`);
      presentation.elements.push(structuredClone(command.element));
      changes.changedElementIds.add(command.element.id);
      changes.structuralChange = true;
      return;
    case "update-element-identity": {
      const element = presentation.elements.find(({ id }) => id === command.elementId);
      if (!element) throw new Error(`element ${command.elementId} is missing`);
      Object.assign(element, structuredClone(command.patch));
      changes.changedElementIds.add(command.elementId);
      return;
    }
    case "delete-element": {
      const index = presentation.elements.findIndex(({ id }) => id === command.elementId);
      if (index < 0) throw new Error(`element ${command.elementId} is missing`);
      if (presentation.elements.some(({ parentId }) => parentId === command.elementId)) throw new Error(`element ${command.elementId} still has children`);
      presentation.elements.splice(index, 1);
      for (const slide of presentation.slides) {
        const before = slide.states.length;
        slide.states = slide.states.filter(({ elementId }) => elementId !== command.elementId);
        if (slide.states.length !== before) changes.changedSlideIds.add(slide.id);
      }
      for (const transition of presentation.transitions) {
        if (transition.overrides !== undefined) transition.overrides = transition.overrides.filter(({ elementId }) => elementId !== command.elementId);
        if (transition.elementMotions !== undefined) transition.elementMotions = transition.elementMotions.filter(({ elementId }) => elementId !== command.elementId);
      }
      changes.changedElementIds.add(command.elementId);
      changes.structuralChange = true;
      return;
    }
    case "create-slide": {
      if (presentation.slides.some(({ id }) => id === command.slide.id)) throw new Error(`slide ${command.slide.id} already exists`);
      const index = command.afterSlideId === undefined
        ? presentation.slides.length
        : presentation.slides.findIndex(({ id }) => id === command.afterSlideId) + 1;
      if (index === 0) throw new Error(`slide ${command.afterSlideId} is missing`);
      presentation.slides.splice(index, 0, structuredClone(command.slide));
      presentation.transitions = adjacentTransitions(presentation);
      changes.changedSlideIds.add(command.slide.id);
      changes.structuralChange = true;
      return;
    }
    case "update-slide":
      Object.assign(findSlide(presentation, command.slideId), structuredClone(command.patch));
      changes.changedSlideIds.add(command.slideId);
      return;
    case "reorder-slides": {
      if (command.slideIds.length !== presentation.slides.length || new Set(command.slideIds).size !== presentation.slides.length) {
        throw new Error("slide order is incomplete");
      }
      const reordered = command.slideIds.map((id) => presentation.slides.find((slide) => slide.id === id));
      if (reordered.some((slide) => !slide)) throw new Error("slide order contains a missing slide");
      presentation.slides = reordered as DeksPresentationSlide[];
      presentation.transitions = adjacentTransitions(presentation);
      command.slideIds.forEach((id) => changes.changedSlideIds.add(id));
      changes.structuralChange = true;
      return;
    }
    case "delete-slide": {
      if (presentation.slides.length === 1) throw new Error("the last slide cannot be deleted");
      const index = presentation.slides.findIndex(({ id }) => id === command.slideId);
      if (index < 0) throw new Error(`slide ${command.slideId} is missing`);
      const [removed] = presentation.slides.splice(index, 1);
      removed?.states.forEach(({ elementId }) => changes.changedElementIds.add(elementId));
      presentation.transitions = adjacentTransitions(presentation);
      changes.changedSlideIds.add(command.slideId);
      changes.structuralChange = true;
      return;
    }
    case "add-element-state": {
      const slide = findSlide(presentation, command.slideId);
      if (!presentation.elements.some(({ id }) => id === command.state.elementId)) throw new Error(`element ${command.state.elementId} is not declared`);
      if (slide.states.some(({ elementId }) => elementId === command.state.elementId)) throw new Error(`element state ${command.state.elementId} already exists`);
      slide.states.push(structuredClone(command.state));
      changes.changedSlideIds.add(command.slideId);
      changes.changedElementIds.add(command.state.elementId);
      changes.structuralChange = true;
      return;
    }
    case "update-element-state": {
      const slide = findSlide(presentation, command.slideId);
      const state = slide.states.find(({ elementId }) => elementId === command.elementId);
      if (!state) throw new Error(`element state ${command.elementId} is missing`);
      Object.assign(state, structuredClone(command.patch));
      changes.changedSlideIds.add(command.slideId);
      changes.changedElementIds.add(command.elementId);
      return;
    }
    case "remove-element-state": {
      const slide = findSlide(presentation, command.slideId);
      const index = slide.states.findIndex(({ elementId }) => elementId === command.elementId);
      if (index < 0) throw new Error(`element state ${command.elementId} is missing`);
      slide.states.splice(index, 1);
      changes.changedSlideIds.add(command.slideId);
      changes.changedElementIds.add(command.elementId);
      changes.structuralChange = true;
      return;
    }
    case "set-transition": {
      const edge = presentation.transitions.find(({ fromSlideId, toSlideId }) => fromSlideId === command.fromSlideId && toSlideId === command.toSlideId);
      if (!edge) throw new Error(`transition ${command.fromSlideId}:${command.toSlideId} is missing`);
      Object.assign(edge, structuredClone(command.patch));
      edge.effectiveDurationMs = edge.motionBeatMs * edge.durationMultiplier;
      changes.changedTransitionIds.add(transitionId(edge.fromSlideId, edge.toSlideId));
      return;
    }
  }
}

export function applyDeksPresentationCommands(
  source: DeksPresentationDocument,
  commands: readonly DeksPresentationCommand[],
): DeksPresentationCommandResult {
  assertDeksPresentationDocument(source);
  const presentation = structuredClone(source);
  const changes: MutableChangeSet = {
    changedPresentation: false,
    changedSlideIds: new Set(),
    changedElementIds: new Set(),
    changedTransitionIds: new Set(),
    structuralChange: false,
  };
  for (const command of commands) applyOne(presentation, command, changes);
  if (commands.length > 0) {
    presentation.revision = source.revision + 1;
    presentation.history = { canUndo: true, canRedo: false };
  }
  assertDeksPresentationDocument(presentation);
  return {
    presentation,
    changeSet: {
      baseRevision: source.revision,
      revision: presentation.revision,
      changedPresentation: changes.changedPresentation,
      changedSlideIds: [...changes.changedSlideIds],
      changedElementIds: [...changes.changedElementIds],
      changedTransitionIds: [...changes.changedTransitionIds],
      structuralChange: changes.structuralChange,
    },
  };
}

export function applyDeksPresentationCommand(
  source: DeksPresentationDocument,
  command: DeksPresentationCommand,
): DeksPresentationCommandResult {
  return applyDeksPresentationCommands(source, [command]);
}

/** Named transaction alias: a command batch is validated and committed as one revision. */
export const applyDeksPresentationTransaction = applyDeksPresentationCommands;
