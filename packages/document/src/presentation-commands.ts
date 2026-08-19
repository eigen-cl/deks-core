import type {
  MorphMotion,
  MotionRole,
  Palette,
  PresenceMotion,
} from "./types.js";
import type {
  DeksAssetDescriptor,
  DeksDocument,
  DeksElement,
  DeksSlide,
  DeksElementState,
} from "./presentation.js";
import { assertDeksDocument } from "./presentation-validation.js";
import { mergeMotion } from "./motion.js";

export type DeksCommand =
  | { type: "update-document"; patch: Partial<Pick<DeksDocument, "name" | "motionBeatMs">> & { palette?: Partial<Palette> } }
  | { type: "define-asset"; asset: DeksAssetDescriptor }
  | { type: "remove-asset"; assetId: string }
  | { type: "define-element"; element: DeksElement }
  | { type: "update-element-identity"; elementId: string; patch: Partial<Pick<DeksElement, "name" | "semanticRole" | "parentId" | "isLocked" | "animateMagnitude">> }
  | { type: "delete-element"; elementId: string }
  | { type: "create-slide"; slide: DeksSlide; afterSlideId?: string }
  | { type: "update-slide"; slideId: string; patch: Partial<Omit<DeksSlide, "id" | "states">> }
  | { type: "reorder-slides"; slideIds: string[] }
  | { type: "delete-slide"; slideId: string }
  | { type: "add-element-state"; slideId: string; state: DeksElementState }
  | { type: "update-element-state"; slideId: string; elementId: string; patch: Partial<Omit<DeksElementState, "elementId">> }
  | { type: "remove-element-state"; slideId: string; elementId: string }
  | { type: "set-motion"; scope: MotionScope; role: MotionRole; patch: MotionRolePatch }
  | { type: "clear-motion"; scope: InheritingMotionScope; role?: MotionRole };

/** Where a motion declaration lives. The document scope is always complete. */
export type MotionScope =
  | { kind: "document" }
  | { kind: "slide"; slideId: string }
  | { kind: "element"; slideId: string; elementId: string };
export type InheritingMotionScope = Exclude<MotionScope, { kind: "document" }>;
export type MotionRolePatch = Partial<PresenceMotion> | Partial<MorphMotion>;

export interface DeksChangeSet {
  baseRevision: number;
  revision: number;
  changedPresentation: boolean;
  changedSlideIds: string[];
  changedElementIds: string[];
  structuralChange: boolean;
}

export interface DeksCommandResult {
  document: DeksDocument;
  changeSet: DeksChangeSet;
}

export type DeksEditorChangeKind = DeksCommand["type"] | "transaction";
export interface DeksEditorChange {
  kind: DeksEditorChangeKind;
  document: DeksDocument;
  previousDocument: DeksDocument;
  operation: DeksCommand | readonly DeksCommand[];
}
export type DeksEditorChangeResult = boolean | { document: DeksDocument } | void;
export type DeksEditorChangeHandler = (change: DeksEditorChange) => Promise<DeksEditorChangeResult> | DeksEditorChangeResult;

export function commandKind(operation: DeksCommand | readonly DeksCommand[]): DeksEditorChangeKind {
  return Array.isArray(operation) ? "transaction" : (operation as DeksCommand).type;
}

interface MutableChangeSet {
  changedPresentation: boolean;
  changedSlideIds: Set<string>;
  changedElementIds: Set<string>;
  structuralChange: boolean;
}

function findSlide(document: DeksDocument, slideId: string): DeksSlide {
  const slide = document.slides.find(({ id }) => id === slideId);
  if (!slide) throw new Error(`slide ${slideId} is missing`);
  return slide;
}

function motionTarget(
  document: DeksDocument,
  scope: InheritingMotionScope,
): DeksSlide | DeksElementState {
  const slide = findSlide(document, scope.slideId);
  if (scope.kind === "slide") return slide;
  const state = slide.states.find(({ elementId }) => elementId === scope.elementId);
  if (!state) throw new Error(`element state ${scope.elementId} is missing on slide ${scope.slideId}`);
  return state;
}

function markMotionScope(scope: InheritingMotionScope, changes: MutableChangeSet): void {
  changes.changedSlideIds.add(scope.slideId);
  if (scope.kind === "element") changes.changedElementIds.add(scope.elementId);
}

function applyOne(
  document: DeksDocument,
  command: DeksCommand,
  changes: MutableChangeSet,
): void {
  switch (command.type) {
    case "update-document":
      if (command.patch.name !== undefined) document.name = command.patch.name;
      if (command.patch.palette !== undefined) Object.assign(document.palette, command.patch.palette);
      if (command.patch.motionBeatMs !== undefined) document.motionBeatMs = command.patch.motionBeatMs;
      changes.changedPresentation = true;
      return;
    case "define-asset":
      if (document.assets.some(({ id }) => id === command.asset.id)) throw new Error(`asset ${command.asset.id} already exists`);
      document.assets.push(structuredClone(command.asset));
      changes.changedPresentation = true;
      changes.structuralChange = true;
      return;
    case "remove-asset": {
      if (document.slides.some((slide) => slide.states.some(({ assetId }) => assetId === command.assetId))) {
        throw new Error(`asset ${command.assetId} is still referenced`);
      }
      const index = document.assets.findIndex(({ id }) => id === command.assetId);
      if (index < 0) throw new Error(`asset ${command.assetId} is missing`);
      document.assets.splice(index, 1);
      changes.changedPresentation = true;
      changes.structuralChange = true;
      return;
    }
    case "define-element":
      if (document.elements.some(({ id }) => id === command.element.id)) throw new Error(`element ${command.element.id} already exists`);
      document.elements.push(structuredClone(command.element));
      changes.changedElementIds.add(command.element.id);
      changes.structuralChange = true;
      return;
    case "update-element-identity": {
      const element = document.elements.find(({ id }) => id === command.elementId);
      if (!element) throw new Error(`element ${command.elementId} is missing`);
      if (command.patch.animateMagnitude !== undefined && element.kind !== "number") {
        throw new Error(`element ${command.elementId} is not a number`);
      }
      Object.assign(element, structuredClone(command.patch));
      changes.changedElementIds.add(command.elementId);
      return;
    }
    case "delete-element": {
      const index = document.elements.findIndex(({ id }) => id === command.elementId);
      if (index < 0) throw new Error(`element ${command.elementId} is missing`);
      if (document.elements.some(({ parentId }) => parentId === command.elementId)) throw new Error(`element ${command.elementId} still has children`);
      document.elements.splice(index, 1);
      for (const slide of document.slides) {
        const before = slide.states.length;
        slide.states = slide.states.filter(({ elementId }) => elementId !== command.elementId);
        if (slide.states.length !== before) changes.changedSlideIds.add(slide.id);
      }
      changes.changedElementIds.add(command.elementId);
      changes.structuralChange = true;
      return;
    }
    case "create-slide": {
      if (document.slides.some(({ id }) => id === command.slide.id)) throw new Error(`slide ${command.slide.id} already exists`);
      const index = command.afterSlideId === undefined
        ? document.slides.length
        : document.slides.findIndex(({ id }) => id === command.afterSlideId) + 1;
      if (index === 0) throw new Error(`slide ${command.afterSlideId} is missing`);
      document.slides.splice(index, 0, structuredClone(command.slide));
      changes.changedSlideIds.add(command.slide.id);
      changes.structuralChange = true;
      return;
    }
    case "update-slide":
      Object.assign(findSlide(document, command.slideId), structuredClone(command.patch));
      changes.changedSlideIds.add(command.slideId);
      return;
    case "reorder-slides": {
      if (command.slideIds.length !== document.slides.length || new Set(command.slideIds).size !== document.slides.length) {
        throw new Error("slide order is incomplete");
      }
      const reordered = command.slideIds.map((id) => document.slides.find((slide) => slide.id === id));
      if (reordered.some((slide) => !slide)) throw new Error("slide order contains a missing slide");
      document.slides = reordered as DeksSlide[];
      command.slideIds.forEach((id) => changes.changedSlideIds.add(id));
      changes.structuralChange = true;
      return;
    }
    case "delete-slide": {
      if (document.slides.length === 1) throw new Error("the last slide cannot be deleted");
      const index = document.slides.findIndex(({ id }) => id === command.slideId);
      if (index < 0) throw new Error(`slide ${command.slideId} is missing`);
      const [removed] = document.slides.splice(index, 1);
      removed?.states.forEach(({ elementId }) => changes.changedElementIds.add(elementId));
      changes.changedSlideIds.add(command.slideId);
      changes.structuralChange = true;
      return;
    }
    case "add-element-state": {
      const slide = findSlide(document, command.slideId);
      if (!document.elements.some(({ id }) => id === command.state.elementId)) throw new Error(`element ${command.state.elementId} is not declared`);
      if (slide.states.some(({ elementId }) => elementId === command.state.elementId)) throw new Error(`element state ${command.state.elementId} already exists`);
      slide.states.push(structuredClone(command.state));
      changes.changedSlideIds.add(command.slideId);
      changes.changedElementIds.add(command.state.elementId);
      changes.structuralChange = true;
      return;
    }
    case "update-element-state": {
      const slide = findSlide(document, command.slideId);
      const state = slide.states.find(({ elementId }) => elementId === command.elementId);
      if (!state) throw new Error(`element state ${command.elementId} is missing`);
      Object.assign(state, structuredClone(command.patch));
      changes.changedSlideIds.add(command.slideId);
      changes.changedElementIds.add(command.elementId);
      return;
    }
    case "remove-element-state": {
      const slide = findSlide(document, command.slideId);
      const index = slide.states.findIndex(({ elementId }) => elementId === command.elementId);
      if (index < 0) throw new Error(`element state ${command.elementId} is missing`);
      slide.states.splice(index, 1);
      changes.changedSlideIds.add(command.slideId);
      changes.changedElementIds.add(command.elementId);
      changes.structuralChange = true;
      return;
    }
    case "set-motion": {
      const patch = structuredClone(command.patch) as Record<string, unknown>;
      if (Object.keys(patch).length === 0) throw new Error("a motion patch must change at least one property");
      if (command.scope.kind === "document") {
        // The root stays complete: a patch merges into it instead of replacing it.
        document.motion = mergeMotion(document.motion, { [command.role]: patch } as never);
        changes.changedPresentation = true;
        return;
      }
      const target = motionTarget(document, command.scope);
      const current = target.motion ?? {};
      target.motion = { ...current, [command.role]: { ...(current[command.role] ?? {}), ...patch } } as never;
      markMotionScope(command.scope, changes);
      return;
    }
    case "clear-motion": {
      const target = motionTarget(document, command.scope);
      if (command.role === undefined) delete target.motion;
      else if (target.motion !== undefined) {
        delete target.motion[command.role];
        if (Object.keys(target.motion).length === 0) delete target.motion;
      }
      markMotionScope(command.scope, changes);
      return;
    }
  }
}

export function applyDeksCommands(
  source: DeksDocument,
  commands: readonly DeksCommand[],
): DeksCommandResult {
  assertDeksDocument(source);
  const document = structuredClone(source);
  const changes: MutableChangeSet = {
    changedPresentation: false,
    changedSlideIds: new Set(),
    changedElementIds: new Set(),
    structuralChange: false,
  };
  for (const command of commands) applyOne(document, command, changes);
  if (commands.length > 0) {
    document.revision = source.revision + 1;
    document.history = { canUndo: true, canRedo: false };
  }
  assertDeksDocument(document);
  return {
    document,
    changeSet: {
      baseRevision: source.revision,
      revision: document.revision,
      changedPresentation: changes.changedPresentation,
      changedSlideIds: [...changes.changedSlideIds],
      changedElementIds: [...changes.changedElementIds],
      structuralChange: changes.structuralChange,
    },
  };
}

export function applyDeksCommand(
  source: DeksDocument,
  command: DeksCommand,
): DeksCommandResult {
  return applyDeksCommands(source, [command]);
}

/** Named transaction alias: a command batch is validated and committed as one revision. */
export const applyDeksTransaction = applyDeksCommands;
