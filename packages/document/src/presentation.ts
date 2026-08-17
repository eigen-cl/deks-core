import type {
  ElementKind,
  CornerRadii,
  MotionPatch,
  MotionSpec,
  Palette,
  ShapeKind,
  SlideBackground,
} from "./types.js";
import { DEFAULT_MOTION, mergeMotion } from "./motion.js";
import {
  assertDeksDocument,
  DEKS_DOCUMENT_LIMITS,
} from "./presentation-validation.js";

const DEFAULT_PALETTE: Palette = {
  primary: "#ff7043",
  secondary: "#65c18c",
  accent: "#73a7ff",
  background: "#0b0c0e",
  text: "#f2f1ec",
  subtext: "#969da6",
};

const ID_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export type DeksElementKind = ElementKind;
const ELEMENT_KINDS = new Set<DeksElementKind>(["text", "shape", "image", "group", "link-button", "icon"]);

export type PresentationIdScope = "presentation" | "asset" | "element" | "slide";
export type PresentationIdFactory = (scope: PresentationIdScope, sequence: number) => string;

export interface DeksElement {
  id: string;
  kind: DeksElementKind;
  name: string;
  shapeKind?: ShapeKind;
  semanticRole?: string;
  parentId?: string;
  isLocked: boolean;
}

export type DeksAssetDescriptor =
  | { id: string; kind: "embedded"; mediaType: string; originalFilename?: string }
  | { id: string; kind: "remote"; url: string; mediaType?: string; originalFilename?: string };

export type DeksAssetInput =
  | { id?: string; kind: "bytes"; bytes: Uint8Array; mediaType: string; originalFilename?: string }
  | { id?: string; kind: "blob"; blob: Blob; mediaType?: string; originalFilename?: string }
  | { id?: string; kind: "url"; url: string; mediaType?: string; originalFilename?: string };

export type DeksAssetRuntimeSource =
  | { kind: "bytes"; bytes: Uint8Array; mediaType: string }
  | { kind: "blob"; blob: Blob; mediaType: string };

export interface DeksAssetHandle { readonly id: string }

export interface DeksElementState {
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  opacity: number;
  zIndex: number;
  content?: string;
  fontFamily?: "Poppins" | "Roboto";
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  horizontalAlignment?: "left" | "center" | "right" | "justify";
  verticalAlignment?: "top" | "middle" | "bottom";
  overflowMode?: "visible" | "hidden" | "clip";
  fill?: string;
  shapeFill?: SlideBackground;
  stroke?: string;
  strokeWidth?: number;
  cornerRadii?: CornerRadii;
  assetId?: string;
  alt?: string;
  fit?: "contain" | "cover" | "fill";
  label?: string;
  url?: string;
  textColor?: string;
  cornerRadius?: number;
  iconFamily?: "lucide";
  iconName?: string;
  /** Motion of this element on this slide. Every omitted property is inherited. */
  motion?: MotionPatch;
}

export interface DeksSlide {
  id: string;
  name: string;
  isTemplate: boolean;
  background: SlideBackground;
  /** Motion for every element on this slide. Every omitted property is inherited. */
  motion?: MotionPatch;
  states: DeksElementState[];
}

export interface DeksDocument {
  format: "deks";
  id: string;
  name: string;
  revision: number;
  canvas: { width: number; height: number };
  motionBeatMs: number;
  /** The complete motion every slide and element inherits from. */
  motion: MotionSpec;
  palette: Palette;
  history: { canUndo: boolean; canRedo: boolean };
  assets: DeksAssetDescriptor[];
  elements: DeksElement[];
  slides: DeksSlide[];
}

type StatePayload = Omit<DeksElementState, "elementId">;

export type PresentationStateDefaults = Partial<StatePayload>;
export type PresentationStateInput = Partial<StatePayload>;
export type PresentationStatePatch = Partial<StatePayload>;

export interface DefineElementOptions {
  id?: string;
  kind: DeksElementKind;
  name: string;
  shapeKind?: ShapeKind;
  semanticRole?: string;
  parentId?: string;
  isLocked?: boolean;
  defaults?: PresentationStateDefaults;
}

export interface AddSlideOptions {
  id?: string;
  name: string;
  isTemplate?: boolean;
  background?: SlideBackground;
  motion?: MotionPatch;
}

export interface CreateDeksPresentationOptions {
  id?: string;
  name: string;
  canvas?: { width: number; height: number };
  motionBeatMs?: number;
  /** Patches the default motion; the presentation always stores a complete spec. */
  motion?: MotionPatch;
  palette?: Partial<Palette>;
  idFactory?: PresentationIdFactory;
}

export interface ContinueElementOptions {
  from?: DeksSlideHandle;
}

export interface SerializePresentationOptions {
  pretty?: boolean;
}

export type PresentationAssetByteProvider = (
  asset: DeksAssetDescriptor,
) => Promise<Uint8Array | Blob | undefined> | Uint8Array | Blob | undefined;

export interface DeksElementHandle extends Readonly<DeksElement> {}

export interface DeksSlideHandle {
  readonly id: string;
  readonly name: string;
  place(element: DeksElementHandle, state: PresentationStateInput): DeksSlideHandle;
  continue(
    element: DeksElementHandle,
    patch?: PresentationStatePatch,
    options?: ContinueElementOptions,
  ): DeksSlideHandle;
}

interface RegisteredElement {
  identity: DeksElement;
  defaults: PresentationStateDefaults;
  handle: ElementHandle;
}

function defaultIdFactory(scope: PresentationIdScope, _sequence: number): string {
  return `${scope}-${globalThis.crypto.randomUUID()}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requiredText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: number, field: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new Error(`${field} must be a finite number${minimum === undefined ? "" : ` greater than or equal to ${minimum}`}`);
  }
  return value;
}

function idPart(value: string, field: string): string {
  requiredText(value, field);
  if (!ID_PART.test(value)) throw new Error(`${field} contains unsupported characters`);
  return value;
}

function validateColor(value: string, field: string): string {
  if (!COLOR.test(value)) throw new Error(`${field} must be a hexadecimal color`);
  return value;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function cleanStatePayload(value: PresentationStateInput, field: string): PresentationStateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  const record = value as PresentationStateInput & Record<string, unknown>;
  for (const identityField of ["id", "kind", "name", "shapeKind", "semanticRole", "parentId", "isLocked", "elementId"] as const) {
    if (record[identityField] !== undefined) {
      throw new Error(`${field}.${identityField} belongs to element identity, not slide state`);
    }
  }
  return Object.fromEntries(Object.entries(record).filter(([, item]) => item !== undefined)) as PresentationStateInput;
}

function validateCompleteState(state: PresentationStateInput, kind: DeksElementKind): asserts state is StatePayload {
  finiteNumber(state.x as number, "state.x");
  finiteNumber(state.y as number, "state.y");
  finiteNumber(state.width as number, "state.width", Number.MIN_VALUE);
  finiteNumber(state.height as number, "state.height", Number.MIN_VALUE);
  finiteNumber(state.rotationDeg as number, "state.rotationDeg");
  finiteNumber(state.opacity as number, "state.opacity", 0);
  if ((state.opacity as number) > 1) throw new Error("state.opacity must be less than or equal to 1");
  finiteNumber(state.zIndex as number, "state.zIndex");
  if (!Number.isInteger(state.zIndex)) throw new Error("state.zIndex must be an integer");
  if (state.fontSize !== undefined) finiteNumber(state.fontSize, "state.fontSize", Number.MIN_VALUE);
  if (state.fontWeight !== undefined) {
    finiteNumber(state.fontWeight, "state.fontWeight", 1);
    if (!Number.isInteger(state.fontWeight)) throw new Error("state.fontWeight must be an integer");
  }
  if (state.lineHeight !== undefined) finiteNumber(state.lineHeight, "state.lineHeight", Number.MIN_VALUE);
  if (state.strokeWidth !== undefined) finiteNumber(state.strokeWidth, "state.strokeWidth", 0);
  if (state.cornerRadius !== undefined) {
    if (kind !== "link-button") throw new Error("state.cornerRadius is only valid for link buttons");
    finiteNumber(state.cornerRadius, "state.cornerRadius", 0);
  }
  if (state.cornerRadii !== undefined) {
    if (kind !== "shape") throw new Error("state.cornerRadii is only valid for shapes");
    const radii = state.cornerRadii as unknown as Record<string, unknown>;
    const keys = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
    if (Object.keys(radii).length !== keys.length || Object.keys(radii).some((key) => !keys.includes(key as typeof keys[number]))) {
      throw new Error("state.cornerRadii must define exactly four corners");
    }
    for (const key of keys) finiteNumber(radii[key] as number, `state.cornerRadii.${key}`, 0);
  }
  if (kind === "link-button" && state.url !== undefined && !isHttpsUrl(state.url)) {
    throw new Error("state.url must be an absolute credential-free HTTPS URL");
  }
  if (kind === "shape" && state.fill !== undefined) {
    throw new Error("shape states use state.shapeFill");
  }
  const requiredByKind: Record<DeksElementKind, readonly (keyof StatePayload)[]> = {
    text: ["content", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "horizontalAlignment", "verticalAlignment", "overflowMode", "fill"],
    shape: ["shapeFill", "stroke", "strokeWidth"],
    image: ["assetId", "alt", "fit"],
    group: [],
    "link-button": ["label", "url", "fill", "textColor", "fontFamily", "fontSize", "fontWeight", "cornerRadius", "stroke", "strokeWidth"],
    icon: ["iconFamily", "iconName", "fill", "strokeWidth"],
  };
  for (const key of requiredByKind[kind]) {
    if (state[key] === undefined) throw new Error(`state.${String(key)} is required for ${kind}`);
  }
}

class ElementHandle implements DeksElementHandle {
  readonly id: string;
  readonly kind: DeksElementKind;
  readonly name: string;
  readonly shapeKind?: ShapeKind;
  readonly semanticRole?: string;
  readonly parentId?: string;
  readonly isLocked: boolean;

  constructor(identity: DeksElement) {
    this.id = identity.id;
    this.kind = identity.kind;
    this.name = identity.name;
    if (identity.shapeKind !== undefined) this.shapeKind = identity.shapeKind;
    if (identity.semanticRole !== undefined) this.semanticRole = identity.semanticRole;
    if (identity.parentId !== undefined) this.parentId = identity.parentId;
    this.isLocked = identity.isLocked;
    Object.freeze(this);
  }
}

class SlideHandle implements DeksSlideHandle {
  constructor(
    private readonly presentation: DeksPresentation,
    private readonly slide: DeksSlide,
  ) {}

  get id(): string {
    return this.slide.id;
  }

  get name(): string {
    return this.slide.name;
  }

  place(element: DeksElementHandle, state: PresentationStateInput): DeksSlideHandle {
    this.presentation.place(this, element, state);
    return this;
  }

  continue(
    element: DeksElementHandle,
    patch: PresentationStatePatch = {},
    options: ContinueElementOptions = {},
  ): DeksSlideHandle {
    this.presentation.continue(this, element, patch, options);
    return this;
  }
}

/**
 * Offline, transport-agnostic facade for building the canonical DEKS document.
 * Element identity is stored once; slides only contain state references.
 */
export class DeksPresentation {
  readonly id: string;

  private readonly idFactory: PresentationIdFactory;
  private readonly counters: Record<PresentationIdScope, number> = {
    presentation: 0,
    asset: 0,
    element: 0,
    slide: 0,
  };
  private readonly elements = new Map<string, RegisteredElement>();
  private readonly assets = new Map<string, { descriptor: DeksAssetDescriptor; runtime?: DeksAssetRuntimeSource }>();
  private readonly slides: DeksSlide[] = [];
  private readonly slideHandles = new Map<string, SlideHandle>();
  private readonly name: string;
  private readonly canvas: { width: number; height: number };
  private readonly motionBeatMs: number;
  private readonly motion: MotionSpec;
  private readonly palette: Palette;

  constructor(options: CreateDeksPresentationOptions) {
    if (!options || typeof options !== "object") throw new Error("presentation options are required");
    this.idFactory = options.idFactory ?? defaultIdFactory;
    const rawId = options.id ?? this.nextId("presentation");
    this.id = idPart(rawId, "presentation id");
    this.name = requiredText(options.name, "presentation name");
    const canvas = options.canvas ?? { width: 1920, height: 1080 };
    this.canvas = {
      width: finiteNumber(canvas.width, "canvas.width", Number.MIN_VALUE),
      height: finiteNumber(canvas.height, "canvas.height", Number.MIN_VALUE),
    };
    this.motionBeatMs = finiteNumber(options.motionBeatMs ?? 600, "motionBeatMs", 50);
    this.motion = mergeMotion(DEFAULT_MOTION, options.motion);
    this.palette = { ...DEFAULT_PALETTE, ...clone(options.palette ?? {}) };
    for (const [role, color] of Object.entries(this.palette)) validateColor(color, `palette.${role}`);
  }

  defineElement(options: DefineElementOptions): DeksElementHandle {
    if (!options || typeof options !== "object") throw new Error("element options are required");
    if (!ELEMENT_KINDS.has(options.kind)) throw new Error(`element kind ${String(options.kind)} is unsupported`);
    const localOrQualifiedId = options.id ?? this.nextId("element");
    const id = this.elementId(localOrQualifiedId);
    if (this.elements.has(id)) throw new Error(`element ${id} already exists`);
    const identity: DeksElement = {
      id,
      kind: options.kind,
      name: requiredText(options.name, "element name"),
      ...(options.shapeKind === undefined ? {} : { shapeKind: options.shapeKind }),
      ...(options.semanticRole === undefined ? {} : { semanticRole: requiredText(options.semanticRole, "element semanticRole") }),
      ...(options.parentId === undefined ? {} : { parentId: this.elementId(options.parentId) }),
      isLocked: options.isLocked ?? false,
    };
    if (identity.kind === "shape" && identity.shapeKind === undefined) {
      throw new Error("shape elements require shapeKind identity");
    }
    if (identity.kind !== "shape" && identity.shapeKind !== undefined) {
      throw new Error("shapeKind is only valid for shape element identity");
    }
    if (identity.parentId !== undefined) {
      const parent = this.elements.get(identity.parentId)?.identity;
      if (!parent || parent.kind !== "group") throw new Error("parentId must reference a declared group identity");
    }
    const handle = new ElementHandle(identity);
    this.elements.set(id, {
      identity,
      defaults: clone(cleanStatePayload(options.defaults ?? {}, "element defaults")),
      handle,
    });
    return handle;
  }

  defineAsset(input: DeksAssetInput): DeksAssetHandle {
    if (!input || typeof input !== "object") throw new Error("asset input is required");
    const localOrQualifiedId = input.id ?? this.nextId("asset");
    const id = this.elementId(localOrQualifiedId);
    if (this.assets.has(id)) throw new Error(`asset ${id} already exists`);
    let descriptor: DeksAssetDescriptor;
    let runtime: DeksAssetRuntimeSource | undefined;
    if (input.kind === "url") {
      if (!isHttpsUrl(input.url)) throw new Error("asset URL must be an absolute credential-free HTTPS URL");
      descriptor = {
        id,
        kind: "remote",
        url: input.url,
        ...(input.mediaType === undefined ? {} : { mediaType: requiredText(input.mediaType, "asset mediaType") }),
        ...(input.originalFilename === undefined ? {} : { originalFilename: requiredText(input.originalFilename, "asset originalFilename") }),
      };
    } else {
      const mediaType = input.kind === "blob" ? (input.mediaType ?? input.blob.type) : input.mediaType;
      requiredText(mediaType, "asset mediaType");
      descriptor = {
        id,
        kind: "embedded",
        mediaType,
        ...(input.originalFilename === undefined ? {} : { originalFilename: requiredText(input.originalFilename, "asset originalFilename") }),
      };
      runtime = input.kind === "blob"
        ? { kind: "blob", blob: input.blob, mediaType }
        : { kind: "bytes", bytes: new Uint8Array(input.bytes), mediaType };
    }
    this.assets.set(id, runtime === undefined ? { descriptor } : { descriptor, runtime });
    return Object.freeze({ id });
  }

  getAssetRuntimeSource(asset: DeksAssetHandle | string): DeksAssetRuntimeSource | undefined {
    const id = typeof asset === "string" ? asset : asset.id;
    const source = this.assets.get(id)?.runtime;
    if (source?.kind === "bytes") return { ...source, bytes: new Uint8Array(source.bytes) };
    return source;
  }

  addSlide(options: AddSlideOptions): DeksSlideHandle {
    if (!options || typeof options !== "object") throw new Error("slide options are required");
    const id = idPart(options.id ?? this.nextId("slide"), "slide id");
    if (this.slideHandles.has(id)) throw new Error(`slide ${id} already exists`);
    const slide: DeksSlide = {
      id,
      name: requiredText(options.name, "slide name"),
      isTemplate: options.isTemplate ?? false,
      background: clone(options.background ?? { kind: "solid", color: this.palette.background }),
      ...(options.motion === undefined ? {} : { motion: clone(options.motion) }),
      states: [],
    };
    const handle = new SlideHandle(this, slide);
    this.slides.push(slide);
    this.slideHandles.set(id, handle);
    return handle;
  }

  toDocument(): DeksDocument {
    const slides = clone(this.slides);
    const document: DeksDocument = {
      format: "deks",
      id: this.id,
      name: this.name,
      revision: 0,
      canvas: clone(this.canvas),
      motionBeatMs: this.motionBeatMs,
      motion: clone(this.motion),
      palette: clone(this.palette),
      history: { canUndo: false, canRedo: false },
      assets: [...this.assets.values()].map(({ descriptor }) => clone(descriptor)),
      elements: [...this.elements.values()].map(({ identity }) => clone(identity)),
      slides,
    };
    assertDeksDocument(document);
    return document;
  }

  asJSON(options: SerializePresentationOptions = {}): string {
    const serialized = JSON.stringify(this.toDocument(), null, options.pretty === true ? 2 : undefined);
    if (new TextEncoder().encode(serialized).byteLength > DEKS_DOCUMENT_LIMITS.maxJsonBytes) {
      throw new Error("DEKS document JSON is too large");
    }
    return serialized;
  }

  async asDeksFile(provider?: PresentationAssetByteProvider): Promise<import("./file-format.js").DeksFile> {
    const { createDeksFile } = await import("./file-format.js");
    return createDeksFile(this.toDocument(), async (descriptor) => {
      const source = this.assets.get(descriptor.id)?.runtime;
      if (source?.kind === "bytes") return new Uint8Array(source.bytes);
      if (source?.kind === "blob") return source.blob;
      return provider?.(descriptor);
    });
  }

  /** @internal Called only by handles created by this presentation. */
  place(slideHandle: SlideHandle, elementHandle: DeksElementHandle, input: PresentationStateInput): void {
    const slide = this.assertSlideHandle(slideHandle);
    const element = this.assertElementHandle(elementHandle);
    if (slide.states.some(({ elementId }) => elementId === element.identity.id)) {
      throw new Error(`slide ${slide.id} already has a state for element ${element.identity.id}`);
    }
    const payload: PresentationStateInput = {
      rotationDeg: 0,
      opacity: 1,
      zIndex: 0,
      ...clone(element.defaults),
      ...clone(cleanStatePayload(input, "state")),
    };
    validateCompleteState(payload, element.identity.kind);
    slide.states.push({ elementId: element.identity.id, ...payload });
  }

  /** @internal Called only by handles created by this presentation. */
  continue(
    slideHandle: SlideHandle,
    elementHandle: DeksElementHandle,
    input: PresentationStatePatch,
    options: ContinueElementOptions,
  ): void {
    const slide = this.assertSlideHandle(slideHandle);
    const element = this.assertElementHandle(elementHandle);
    if (slide.states.some(({ elementId }) => elementId === element.identity.id)) {
      throw new Error(`slide ${slide.id} already has a state for element ${element.identity.id}`);
    }
    const targetIndex = this.slides.indexOf(slide);
    let source: DeksElementState | undefined;
    if (options.from !== undefined) {
      const from = this.assertSlideHandle(options.from);
      const sourceIndex = this.slides.indexOf(from);
      if (sourceIndex >= targetIndex) throw new Error("continue source must be an earlier slide");
      source = from.states.find(({ elementId }) => elementId === element.identity.id);
    } else {
      for (let index = targetIndex - 1; index >= 0; index -= 1) {
        source = this.slides[index]!.states.find(({ elementId }) => elementId === element.identity.id);
        if (source) break;
      }
    }
    if (!source) throw new Error(`element ${element.identity.id} has no previous state to continue`);
    const { elementId: _elementId, ...previous } = source;
    const payload: PresentationStateInput = {
      ...clone(previous),
      ...clone(cleanStatePayload(input, "state patch")),
    };
    validateCompleteState(payload, element.identity.kind);
    slide.states.push({ elementId: element.identity.id, ...payload });
  }

  private nextId(scope: PresentationIdScope): string {
    this.counters[scope] += 1;
    return requiredText(this.idFactory(scope, this.counters[scope]), `${scope} idFactory result`);
  }

  private elementId(localOrQualifiedId: string): string {
    return idPart(localOrQualifiedId, "element id");
  }

  private assertElementHandle(handle: DeksElementHandle): RegisteredElement {
    const registered = this.elements.get(handle.id);
    if (!registered || registered.handle !== handle) {
      throw new Error(`element ${handle.id} does not belong to presentation ${this.id}`);
    }
    return registered;
  }

  private assertSlideHandle(handle: DeksSlideHandle): DeksSlide {
    const registered = this.slideHandles.get(handle.id);
    if (!registered || registered !== handle) {
      throw new Error(`slide ${handle.id} does not belong to presentation ${this.id}`);
    }
    return this.slides.find(({ id }) => id === handle.id)!;
  }
}
