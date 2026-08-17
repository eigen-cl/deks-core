import type { AssetResolver, DeksDocument } from "@deks-js/document";
import { compileTransition as compile, validateSnapshot } from "./transition.js";
import { toSlideSnapshot, toTransitionOptions } from "./snapshot.js";
import type {
  CompiledTransition,
  ElementSnapshot,
  ImageElementSnapshot,
  IconElementSnapshot,
  LinkButtonElementSnapshot,
  LayoutMeasurement,
  OnionSkinOptions,
  PlaybackProgressListener,
  Rect,
  RendererOptions,
  ShapeElementSnapshot,
  SlideBackground,
  SlideSnapshot,
  TextElementSnapshot,
  TransitionOptions,
  ViewportMode
} from "./types.js";
import { cornerRadiusCss } from "./corner-radii.js";
import { lucidePaths } from "./icons.js";

const setStyles = (node: HTMLElement, styles: Partial<CSSStyleDeclaration>): void => {
  Object.assign(node.style, styles);
};

interface ElementFrame {
  rect: Rect;
  rotationDeg: number;
  opacity: number;
}

const frameFromState = (state: ElementSnapshot): ElementFrame => ({
  rect: { ...state.rect },
  rotationDeg: state.rotationDeg,
  opacity: state.opacity
});

const validateFrame = (frame: ElementFrame): void => {
  const { rect } = frame;
  if (![rect.x, rect.y, rect.width, rect.height, frame.rotationDeg, frame.opacity].every(Number.isFinite)) {
    throw new Error("preview geometry, rotation, and opacity must be finite");
  }
  if (rect.width <= 0 || rect.height <= 0) throw new Error("preview width and height must be positive");
  if (frame.opacity < 0 || frame.opacity > 1) throw new Error("preview opacity must be between 0 and 1");
};

const applyElementFrame = (node: HTMLElement, frame: ElementFrame): void => {
  validateFrame(frame);
  setStyles(node, {
    left: `${frame.rect.x}px`,
    top: `${frame.rect.y}px`,
    width: `${frame.rect.width}px`,
    height: `${frame.rect.height}px`,
    transform: `rotate(${frame.rotationDeg}deg)`,
    opacity: String(frame.opacity)
  });
  node.style.setProperty("--deks-x", `${frame.rect.x}px`);
  node.style.setProperty("--deks-y", `${frame.rect.y}px`);
  node.style.setProperty("--deks-width", `${frame.rect.width}px`);
  node.style.setProperty("--deks-height", `${frame.rect.height}px`);
  node.style.setProperty("--deks-rotation", `${frame.rotationDeg}deg`);
  node.style.setProperty("--deks-opacity", String(frame.opacity));
};

const verticalAlignment = (alignment: TextElementSnapshot["verticalAlignment"]): string => {
  if (alignment === "middle") return "center";
  if (alignment === "bottom") return "flex-end";
  return "flex-start";
};

const renderText = (state: TextElementSnapshot, wrapper: HTMLElement): void => {
  const content = document.createElement("div");
  content.dataset.elementContent = "";
  content.textContent = state.content;
  setStyles(content, {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    color: "inherit",
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    letterSpacing: "inherit",
    textAlign: state.horizontalAlignment,
    display: "flex",
    justifyContent: verticalAlignment(state.verticalAlignment),
    flexDirection: "column",
    whiteSpace: "pre-wrap",
    overflow: state.overflowMode ?? "hidden"
  });
  wrapper.append(content);
};

/**
 * Una forma sin relleno declarado se dibuja transparente. El documento permite
 * omitir `shapeFill`, así que el renderer necesita un valor concreto en vez de
 * asumir que siempre viene uno.
 */
const shapeFill = (state: ShapeElementSnapshot): SlideBackground =>
  state.fillStyle ?? { kind: "solid", color: "transparent" };

const shapeFillCss = (state: ShapeElementSnapshot): Pick<CSSStyleDeclaration, "backgroundColor" | "backgroundImage"> => {
  if (state.shapeKind === "line") return { backgroundColor: "transparent", backgroundImage: "none" };
  const fill = shapeFill(state);
  return fill.kind === "linear-gradient"
    ? {
        backgroundColor: "transparent",
        backgroundImage: `linear-gradient(${fill.angleDeg}deg, ${fill.startColor}, ${fill.endColor})`
      }
    : { backgroundColor: fill.color, backgroundImage: "none" };
};

const renderShape = (state: ShapeElementSnapshot, wrapper: HTMLElement): void => {
  const shape = document.createElement("div");
  shape.dataset.elementContent = "";
  const strokeWidth = state.strokeWidth ?? (state.shapeKind === "line" ? 1 : 0);
  setStyles(wrapper, {
    ...shapeFillCss(state),
    borderColor: state.stroke ?? "transparent",
    borderWidth: `${strokeWidth}px`,
    borderRadius: state.shapeKind === "ellipse" ? "50%" : cornerRadiusCss(state.cornerRadii),
    borderStyle: "none"
  });
  setStyles(shape, {
    width: "100%",
    height: state.shapeKind === "line" ? `${strokeWidth}px` : "100%",
    boxSizing: "border-box",
    backgroundColor: state.shapeKind === "line" ? (state.stroke ?? "currentColor") : "transparent",
    backgroundImage: "none",
    borderStyle: state.shapeKind === "line" || strokeWidth === 0 ? "none" : "solid",
    borderColor: "inherit",
    borderWidth: state.shapeKind === "line" ? "0px" : `${strokeWidth}px`,
    borderRadius: "inherit",
    position: state.shapeKind === "line" ? "absolute" : "relative",
    top: state.shapeKind === "line" ? "50%" : "0px",
    transform: state.shapeKind === "line" ? "translateY(-50%)" : "none",
    transformOrigin: "center"
  });
  wrapper.append(shape);
};

const renderImage = (state: ImageElementSnapshot, wrapper: HTMLElement): void => {
  const image = document.createElement("div");
  image.dataset.elementContent = "";
  image.setAttribute("role", "img");
  image.setAttribute("aria-label", state.alt);
  // A host that cannot resolve the asset still gets a laid-out, accessible box.
  // Rendering must never depend on asset availability.
  setStyles(image, {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    backgroundImage: state.src ? `url("${state.src.replace(/["\\\n\r]/g, "")}")` : "none",
    backgroundColor: state.src ? "transparent" : "rgba(148, 163, 184, 0.16)",
    backgroundSize: state.fit,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat"
  });
  wrapper.append(image);
};

const normalizedExternalUrl = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("link-button url must be an absolute https URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || value.length > 2048) {
    throw new Error("link-button url must be an absolute https URL");
  }
  return url.href;
};

const renderLinkButton = (
  state: LinkButtonElementSnapshot,
  wrapper: HTMLElement,
  interactive: boolean,
  onOpenExternal?: (url: string) => void,
): void => {
  const url = normalizedExternalUrl(state.url);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.deksExternalLink = "";
  button.textContent = state.label;
  button.tabIndex = interactive ? 0 : -1;
  button.setAttribute("aria-label", `${state.label} (abre en una pestaña nueva)`);
  setStyles(wrapper, {
    backgroundColor: state.fill,
    color: state.textColor,
    borderColor: state.stroke ?? "transparent",
    borderWidth: `${state.strokeWidth ?? 0}px`,
    borderStyle: "solid",
    borderRadius: `${state.cornerRadius}px`,
    overflow: "hidden",
  });
  setStyles(button, {
    width: "100%",
    height: "100%",
    margin: "0",
    padding: "0 0.75em",
    border: "0",
    borderRadius: "inherit",
    background: "transparent",
    color: "inherit",
    fontFamily: state.fontFamily,
    fontSize: `${state.fontSize}px`,
    fontWeight: String(state.fontWeight),
    cursor: interactive ? "pointer" : "default",
    pointerEvents: interactive ? "auto" : "none",
  });
  button.addEventListener("click", () => {
    if (button.tabIndex !== 0) return;
    onOpenExternal?.(url);
  });
  wrapper.append(button);
};

const renderIcon = (state: IconElementSnapshot, wrapper: HTMLElement): void => {
  if (state.family !== "lucide" || state.strokeWidth < 0.5 || state.strokeWidth > 8) {
    throw new Error("icon must use a registered offline family and bounded stroke width");
  }
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(state.strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  Object.assign(svg.style, { width: "100%", height: "100%", display: "block" });
  for (const data of lucidePaths(state.iconName)) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  wrapper.setAttribute("role", "img");
  wrapper.setAttribute("aria-label", state.semanticRole ?? state.iconName);
  wrapper.style.color = state.color;
  wrapper.append(svg);
};

const createElementNode = (
  state: ElementSnapshot,
  interactive = true,
  onOpenExternal?: (url: string) => void,
): HTMLElement => {
  const wrapper = document.createElement("div");
  wrapper.dataset.elementId = state.id;
  wrapper.dataset.elementKind = state.kind;
  if (state.semanticRole) wrapper.dataset.semanticRole = state.semanticRole;
  setStyles(wrapper, {
    position: "absolute",
    transformOrigin: "top left",
    zIndex: String(state.zIndex),
    boxSizing: "border-box"
  });
  applyElementFrame(wrapper, frameFromState(state));
  if (state.kind === "text") {
    setStyles(wrapper, {
      color: state.color,
      fontFamily: state.fontFamily,
      fontSize: `${state.fontSize}px`,
      fontWeight: String(state.fontWeight),
      lineHeight: String(state.lineHeight),
      letterSpacing: `${state.letterSpacing}px`
    });
  }
  if (state.kind === "text") renderText(state, wrapper);
  if (state.kind === "shape") renderShape(state, wrapper);
  if (state.kind === "image") renderImage(state, wrapper);
  if (state.kind === "link-button") renderLinkButton(state, wrapper, interactive, onOpenExternal);
  if (state.kind === "icon") renderIcon(state, wrapper);
  return wrapper;
};

const resolvedBackground = (snapshot: SlideSnapshot): SlideBackground | undefined => snapshot.background;

type BackgroundLayerRole = "current" | "incoming" | "outgoing";

const renderBackground = (
  snapshot: SlideSnapshot,
  zIndex = "-1",
  role: BackgroundLayerRole = "current",
): HTMLElement => {
  const layer = document.createElement("div");
  layer.dataset.deksBackground = role;
  const background = resolvedBackground(snapshot);
  setStyles(layer, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex,
    backgroundColor: background?.kind === "solid" ? background.color : "transparent",
    backgroundImage: background?.kind === "linear-gradient"
      ? `linear-gradient(${background.angleDeg}deg, ${background.startColor}, ${background.endColor})`
      : "none"
  });
  return layer;
};

const visualAabb = (rect: Rect, degrees: number): Rect => {
  const radians = degrees * Math.PI / 180;
  const rotate = (x: number, y: number) => ({
    x: rect.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: rect.y + x * Math.sin(radians) + y * Math.cos(radians)
  });
  const corners = [
    rotate(0, 0), rotate(rect.width, 0),
    rotate(0, rect.height), rotate(rect.width, rect.height)
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

export class RendererCore {
  private readonly options: {
    respectReducedMotion: boolean;
    assetResolver?: AssetResolver;
    onOpenExternal?: (url: string) => void | Promise<void>;
    onSelectElement?: (elementId: string) => void;
  };
  private container: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private scene: HTMLElement | null = null;
  private snapshot: SlideSnapshot | null = null;
  private targetSnapshot: SlideSnapshot | null = null;
  private compiled: CompiledTransition | null = null;
  private animations: Animation[] = [];
  private playbackGeneration = 0;
  private playbackRate = 1;
  private playbackProgress = 0;
  private playbackProgressFrame: number | null = null;
  private playbackProgressTracking = false;
  private readonly playbackProgressListeners = new Set<PlaybackProgressListener>();
  private readonly elementNodes = new Map<string, HTMLElement>();
  private readonly canonicalFrames = new Map<string, ElementFrame>();
  private readonly previewedElementIds = new Set<string>();
  private readonly selectedElementIds = new Set<string>();
  private viewportMode: ViewportMode = "presentation";
  private onionSnapshot: SlideSnapshot | null = null;
  private onionOpacity = 0.25;

  constructor(options: RendererOptions = {}) {
    this.options = {
      respectReducedMotion: options.respectReducedMotion ?? true,
      ...(options.assetResolver ? { assetResolver: options.assetResolver } : {}),
      ...(options.onOpenExternal ? { onOpenExternal: options.onOpenExternal } : {}),
      ...(options.onSelectElement ? { onSelectElement: options.onSelectElement } : {}),
    };
  }

  mount(container: HTMLElement): void {
    this.destroy();
    this.container = container;
    const stage = document.createElement("div");
    stage.dataset.deksStage = "";
    setStyles(stage, {
      position: "relative",
      overflow: this.viewportMode === "editor" ? "visible" : "hidden",
      transformOrigin: "top left",
      isolation: "isolate"
    });
    container.append(stage);
    this.stage = stage;
  }

  /**
   * Un snapshot ya proyectado, o el documento canónico y la slide que se quiere
   * dibujar. La segunda forma es la que usan los hosts que sólo tienen el
   * documento —el worker de preview, por ejemplo— y proyecta con el
   * `assetResolver` declarado en las opciones, que es lo único que sabe
   * traducir un `assetId` a una fuente.
   */
  renderSlide(snapshot: SlideSnapshot): void;
  renderSlide(document: DeksDocument, slideId: string): void;
  renderSlide(snapshotOrDocument: SlideSnapshot | DeksDocument, slideId?: string): void {
    const snapshot = slideId === undefined
      ? snapshotOrDocument as SlideSnapshot
      : toSlideSnapshot(snapshotOrDocument as DeksDocument, slideId, this.options.assetResolver);
    this.renderSlideSnapshot(snapshot, true);
  }

  private renderSlideSnapshot(snapshot: SlideSnapshot, resetPlaybackProgress: boolean): void {
    validateSnapshot(snapshot);
    const stage = this.requireStage();
    this.cancelAnimations();
    if (resetPlaybackProgress) this.updatePlaybackProgress(0);
    stage.replaceChildren();
    this.elementNodes.clear();
    this.canonicalFrames.clear();
    this.previewedElementIds.clear();
    stage.style.width = `${snapshot.canvas.width}px`;
    stage.style.height = `${snapshot.canvas.height}px`;
    stage.style.backgroundColor = "transparent";
    stage.append(renderBackground(snapshot, "-2"));
    if (this.onionSnapshot
      && (this.onionSnapshot.canvas.width !== snapshot.canvas.width
        || this.onionSnapshot.canvas.height !== snapshot.canvas.height)) {
      this.onionSnapshot = null;
    }
    if (this.onionSnapshot) stage.append(this.createOnionLayer(this.onionSnapshot, this.onionOpacity));
    const scene = document.createElement("div");
    scene.dataset.deksScene = "";
    setStyles(scene, {
      position: "absolute",
      inset: "0",
      zIndex: "0",
      isolation: "isolate"
    });
    stage.append(scene);
    this.scene = scene;
    for (const state of [...snapshot.elements].sort((a, b) => a.zIndex - b.zIndex)) {
      const node = createElementNode(state, this.viewportMode === "presentation", this.options.onOpenExternal);
      scene.append(node);
      this.elementNodes.set(state.id, node);
      this.canonicalFrames.set(state.id, frameFromState(state));
    }
    const retainedSelection = [...this.selectedElementIds].filter((id) => this.elementNodes.has(id));
    this.selectedElementIds.clear();
    for (const id of retainedSelection) {
      this.selectedElementIds.add(id);
      this.elementNodes.get(id)!.dataset.deksSelected = "";
    }
    this.snapshot = snapshot;
    this.targetSnapshot = null;
    this.compiled = null;
  }

  /**
   * Applies a transient editor preview to one mounted wrapper in O(1).
   * The canonical slide snapshot and any compiled transition remain unchanged.
   */
  previewElement(state: ElementSnapshot): boolean {
    return this.previewElements([state]);
  }

  /** Restores one transient preview from the last canonical renderSlide call. */
  restoreElement(elementId: string): boolean {
    return this.restoreElements([elementId]);
  }

  /** Atomically applies transient frame previews without changing canonical state. */
  previewElements(states: readonly ElementSnapshot[]): boolean {
    const seen = new Set<string>();
    const changes: Array<{ id: string; node: HTMLElement; frame: ElementFrame }> = [];
    for (const state of states) {
      if (seen.has(state.id)) throw new Error(`duplicate preview element id: ${state.id}`);
      seen.add(state.id);
      const node = this.elementNodes.get(state.id);
      if (!node) return false;
      if (node.dataset.elementKind !== state.kind) {
        throw new Error(`preview kind ${state.kind} does not match mounted ${node.dataset.elementKind ?? "unknown"} element`);
      }
      const frame = frameFromState(state);
      validateFrame(frame);
      changes.push({ id: state.id, node, frame });
    }
    for (const { id, node, frame } of changes) {
      applyElementFrame(node, frame);
      this.previewedElementIds.add(id);
    }
    return true;
  }

  /** Atomically restores selected transient previews, or every preview when ids are omitted. */
  restoreElements(elementIds?: readonly string[]): boolean {
    const ids = elementIds ? [...new Set(elementIds)] : [...this.previewedElementIds];
    const changes: Array<{ id: string; node: HTMLElement; frame: ElementFrame }> = [];
    for (const id of ids) {
      const node = this.elementNodes.get(id);
      const frame = this.canonicalFrames.get(id);
      if (!node || !frame) return false;
      changes.push({ id, node, frame });
    }
    for (const { id, node, frame } of changes) {
      applyElementFrame(node, frame);
      this.previewedElementIds.delete(id);
    }
    return true;
  }

  /** Changes clipping without changing the logical canvas or slide snapshot. */
  setViewportMode(mode: ViewportMode): void {
    if (mode !== "presentation" && mode !== "editor") throw new Error(`invalid viewport mode: ${String(mode)}`);
    this.viewportMode = mode;
    if (this.stage) this.stage.style.overflow = mode === "editor" ? "visible" : "hidden";
    for (const button of this.stage?.querySelectorAll<HTMLButtonElement>("button[data-deks-external-link]") ?? []) {
      button.tabIndex = mode === "presentation" ? 0 : -1;
      button.style.pointerEvents = mode === "presentation" ? "auto" : "none";
      button.style.cursor = mode === "presentation" ? "pointer" : "default";
    }
  }

  /** Atomically marks canonical nodes for a host-rendered selection overlay. */
  setSelection(elementIds: readonly string[]): boolean {
    const next = new Set(elementIds);
    if ([...next].some((id) => !this.elementNodes.has(id))) return false;
    for (const id of this.selectedElementIds) this.elementNodes.get(id)?.removeAttribute("data-deks-selected");
    this.selectedElementIds.clear();
    for (const id of next) {
      this.selectedElementIds.add(id);
      this.elementNodes.get(id)!.dataset.deksSelected = "";
    }
    return true;
  }

  /** Renders an independent, non-interactive previous checkpoint behind the active scene. */
  setOnionSkin(snapshot: SlideSnapshot | null, options?: Partial<OnionSkinOptions>): void {
    const opacity = options?.opacity ?? this.onionOpacity;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new Error("onion skin opacity must be between 0 and 1");
    }
    if (snapshot) {
      validateSnapshot(snapshot);
      if (this.snapshot
        && (snapshot.canvas.width !== this.snapshot.canvas.width
          || snapshot.canvas.height !== this.snapshot.canvas.height)) {
        throw new Error("onion skin and canonical snapshot must share canvas dimensions");
      }
    }
    this.onionSnapshot = snapshot;
    this.onionOpacity = opacity;
    if (!this.stage) return;
    this.stage.querySelector(":scope > [data-deks-onion]")?.remove();
    if (snapshot) {
      const layer = this.createOnionLayer(snapshot, opacity);
      this.stage.insertBefore(layer, this.scene);
    }
  }

  /**
   * Dos snapshots y sus opciones, o el documento canónico y la arista que se
   * quiere reproducir. La segunda forma resuelve la arista, proyecta ambas
   * slides y traduce presencia, overrides y easing desde el documento.
   */
  compileTransition(from: SlideSnapshot, to: SlideSnapshot, options: TransitionOptions): CompiledTransition;
  compileTransition(document: DeksDocument, fromSlideId: string, toSlideId: string): CompiledTransition;
  compileTransition(
    fromOrDocument: SlideSnapshot | DeksDocument,
    toOrFromSlideId: SlideSnapshot | string,
    optionsOrToSlideId: TransitionOptions | string,
  ): CompiledTransition {
    const documentForm = typeof toOrFromSlideId === "string" && typeof optionsOrToSlideId === "string";
    const source = fromOrDocument as DeksDocument;
    const from = documentForm
      ? toSlideSnapshot(source, toOrFromSlideId, this.options.assetResolver)
      : fromOrDocument as SlideSnapshot;
    const to = documentForm
      ? toSlideSnapshot(source, optionsOrToSlideId, this.options.assetResolver)
      : toOrFromSlideId as SlideSnapshot;
    const options = documentForm
      ? toTransitionOptions(source, toOrFromSlideId, optionsOrToSlideId)
      : optionsOrToSlideId as TransitionOptions;
    const compiled = compile(from, to, options);
    this.renderSlide(from);
    const stage = this.requireStage();
    const nodes = new Map(
      [...stage.querySelectorAll<HTMLElement>("[data-element-id]")].map((node) => [node.dataset.elementId!, node])
    );

    const reducedMotion = this.options.respectReducedMotion
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const createdAnimations: Animation[] = [];
    try {
      for (const operation of compiled.operations) {
        let node = nodes.get(operation.elementId);
        if (!node && operation.to) {
          node = createElementNode(operation.to, this.viewportMode === "presentation", this.options.onOpenExternal);
          this.requireScene().append(node);
        }
        if (!node) continue;
        const animate = (
          target: HTMLElement,
          keyframes: Keyframe[],
          timing = operation.timing,
        ): void => {
          const animation = target.animate(keyframes, {
            duration: reducedMotion || operation.renderMode === "cut" ? 0 : timing.durationMs,
            delay: reducedMotion ? 0 : timing.delayMs,
            easing: timing.easing,
            fill: "both"
          });
          // Cancellation rejects `finished` in browsers. Attach a handler immediately so
          // superseding a compiled-but-not-yet-played transition is never an unhandled rejection.
          void animation.finished.catch(() => undefined);
          animation.playbackRate = this.playbackRate;
          animation.pause();
          animation.currentTime = 0;
          createdAnimations.push(animation);
        };
        if ((operation.renderMode === "crossfade" || operation.renderMode === "cut")
          && operation.from && operation.to && operation.crossfadeKeyframes) {
          node.dataset.transitionElementId = operation.elementId;
          node.dataset.transitionLayer = "from";
          node.setAttribute("aria-hidden", "true");
          const targetNode = createElementNode(operation.to, this.viewportMode === "presentation", this.options.onOpenExternal);
          targetNode.dataset.transitionElementId = operation.elementId;
          targetNode.dataset.transitionLayer = "to";
          this.requireScene().append(targetNode);
          animate(node, operation.crossfadeKeyframes.from, operation.crossfadeTiming?.from);
          animate(targetNode, operation.crossfadeKeyframes.to, operation.crossfadeTiming?.to);
        } else {
          animate(node, operation.keyframes);
        }
      }
      if (JSON.stringify(resolvedBackground(from)) !== JSON.stringify(resolvedBackground(to))) {
        const outgoingBackground = stage.querySelector<HTMLElement>(
          ":scope > [data-deks-background=current]",
        )!;
        const incomingBackground = renderBackground(to, "-2", "incoming");
        outgoingBackground.dataset.deksBackground = "outgoing";
        stage.insertBefore(incomingBackground, outgoingBackground);
        const animation = outgoingBackground.animate([
          { opacity: 1 },
          { opacity: 0 },
        ], {
          duration: reducedMotion ? 0 : compiled.durationMs,
          delay: reducedMotion ? 0 : compiled.delayMs,
          easing: compiled.easing,
          fill: "both"
        });
        void animation.finished.catch(() => undefined);
        animation.playbackRate = this.playbackRate;
        animation.pause();
        animation.currentTime = 0;
        createdAnimations.push(animation);
      }
    } catch (error) {
      this.cancelAnimationList(createdAnimations);
      this.renderSlide(from);
      throw error;
    }
    this.animations = createdAnimations;
    this.snapshot = from;
    this.targetSnapshot = to;
    this.compiled = compiled;
    return compiled;
  }

  seek(milliseconds: number): void {
    if (!this.compiled) throw new Error("compileTransition must be called before seek");
    if (!Number.isFinite(milliseconds)) throw new Error("seek time must be finite");
    const time = Math.min(Math.max(milliseconds, 0), this.compiled.totalDurationMs);
    for (const animation of this.animations) animation.currentTime = time;
    this.updatePlaybackProgress(this.normalizePlaybackTime(time));
  }

  pause(): void {
    for (const animation of this.animations) animation.pause();
    this.updatePlaybackProgressFromAnimations();
    this.stopPlaybackProgressTracking();
  }

  stop(): void {
    this.pause();
    if (!this.compiled) {
      this.updatePlaybackProgress(0);
      return;
    }
    this.seek(0);
  }

  setPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("playback rate must be a positive finite number");
    this.playbackRate = rate;
    for (const animation of this.animations) animation.playbackRate = rate;
  }

  /** Returns the last observed position of the compiled transition, normalized to 0..1. */
  getPlaybackProgress(): number {
    return this.playbackProgress;
  }

  /**
   * Subscribes to the renderer's logical clock. The current value is delivered synchronously;
   * the returned function is idempotent and stops future notifications for this listener.
   */
  subscribePlaybackProgress(listener: PlaybackProgressListener): () => void {
    this.playbackProgressListeners.add(listener);
    this.notifyPlaybackProgressListener(listener, this.playbackProgress);
    return () => {
      this.playbackProgressListeners.delete(listener);
    };
  }

  async play(): Promise<void> {
    if (!this.compiled) throw new Error("compileTransition must be called before play");
    const generation = this.playbackGeneration;
    const animations = [...this.animations];
    for (const animation of animations) animation.play();
    this.updatePlaybackProgressFromAnimations();
    this.startPlaybackProgressTracking(generation);
    try {
      await Promise.all(animations.map((animation) => animation.finished));
    } catch (error) {
      // renderSlide, compileTransition, mount, and destroy deliberately supersede playback.
      // Their cancellation must not reject an obsolete UI navigation promise.
      if (generation !== this.playbackGeneration) return;
      this.cancelAnimations();
      this.updatePlaybackProgress(0);
      this.targetSnapshot = null;
      this.compiled = null;
      throw error;
    }
    if (generation === this.playbackGeneration && this.targetSnapshot) {
      const targetSnapshot = this.targetSnapshot;
      this.stopPlaybackProgressTracking();
      this.updatePlaybackProgress(1);
      this.renderSlideSnapshot(targetSnapshot, false);
    }
  }

  measureLayout(): LayoutMeasurement[] {
    const stage = this.requireStage();
    if (!this.snapshot) return [];
    const nodes = new Map(
      [...stage.querySelectorAll<HTMLElement>("[data-element-id]")].map((node) => [node.dataset.elementId!, node])
    );
    const stageBounds = stage.getBoundingClientRect();
    const scaleX = stageBounds.width > 0 ? this.snapshot.canvas.width / stageBounds.width : 1;
    const scaleY = stageBounds.height > 0 ? this.snapshot.canvas.height / stageBounds.height : 1;
    return this.snapshot.elements.map((state) => {
      const node = nodes.get(state.id);
      const measurement: LayoutMeasurement = {
        elementId: state.id,
        rect: { ...state.rect },
        visualAabb: visualAabb(state.rect, state.rotationDeg),
        sources: { rect: "exact", visualAabb: "calculated" }
      };
      if (state.kind === "text" && node) {
        measurement.overflowStatus = node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight
          ? "overflow"
          : "fits";
        const range = document.createRange();
        range.selectNodeContents(node);
        if (typeof range.getBoundingClientRect === "function") {
          const bounds = range.getBoundingClientRect();
          measurement.contentRect = {
            x: (bounds.left - stageBounds.left) * scaleX,
            y: (bounds.top - stageBounds.top) * scaleY,
            width: bounds.width * scaleX,
            height: bounds.height * scaleY
          };
          measurement.sources.contentRect = "dom";
        }
      }
      return measurement;
    });
  }

  destroy(): void {
    this.cancelAnimations();
    this.updatePlaybackProgress(0);
    this.stage?.remove();
    this.container = null;
    this.stage = null;
    this.scene = null;
    this.snapshot = null;
    this.targetSnapshot = null;
    this.compiled = null;
    this.elementNodes.clear();
    this.canonicalFrames.clear();
    this.previewedElementIds.clear();
    this.selectedElementIds.clear();
    this.onionSnapshot = null;
    this.playbackProgressListeners.clear();
  }

  private requireStage(): HTMLElement {
    if (!this.stage) throw new Error("mount must be called before rendering");
    return this.stage;
  }

  private requireScene(): HTMLElement {
    if (!this.scene) throw new Error("renderSlide must be called before editing the scene");
    return this.scene;
  }

  private createOnionLayer(snapshot: SlideSnapshot, opacity: number): HTMLElement {
    const layer = document.createElement("div");
    layer.dataset.deksOnion = "";
    layer.setAttribute("aria-hidden", "true");
    setStyles(layer, {
      position: "absolute",
      inset: "0",
      zIndex: "-1",
      isolation: "isolate",
      pointerEvents: "none",
      opacity: String(opacity)
    });
    layer.append(renderBackground(snapshot));
    for (const state of [...snapshot.elements].sort((a, b) => a.zIndex - b.zIndex)) {
      const node = createElementNode(state, false);
      delete node.dataset.elementId;
      node.dataset.onionElementId = state.id;
      layer.append(node);
    }
    return layer;
  }

  private cancelAnimations(): void {
    this.playbackGeneration += 1;
    this.stopPlaybackProgressTracking();
    this.cancelAnimationList(this.animations);
    this.animations = [];
  }

  private cancelAnimationList(animations: Animation[]): void {
    for (const animation of animations) {
      try {
        animation.cancel();
      } catch {
        // A broken browser animation must not prevent the remaining scene from being cleaned up.
      }
    }
  }

  private normalizePlaybackTime(milliseconds: number): number {
    const totalDurationMs = this.compiled?.totalDurationMs ?? 0;
    if (totalDurationMs <= 0) return milliseconds > 0 ? 1 : 0;
    return Math.min(Math.max(milliseconds / totalDurationMs, 0), 1);
  }

  private updatePlaybackProgressFromAnimations(): void {
    if (!this.compiled) return;
    const times = this.animations
      .map((animation) => typeof animation.currentTime === "number" ? animation.currentTime : Number.NaN)
      .filter(Number.isFinite);
    if (times.length === 0) return;
    this.updatePlaybackProgress(this.normalizePlaybackTime(Math.max(...times)));
  }

  private updatePlaybackProgress(progress: number): void {
    const normalized = Math.min(Math.max(progress, 0), 1);
    if (normalized === this.playbackProgress) return;
    this.playbackProgress = normalized;
    for (const listener of this.playbackProgressListeners) {
      this.notifyPlaybackProgressListener(listener, normalized);
    }
  }

  private notifyPlaybackProgressListener(listener: PlaybackProgressListener, progress: number): void {
    try {
      listener(progress);
    } catch {
      // A host callback cannot be allowed to interrupt WAAPI playback or another listener.
    }
  }

  private startPlaybackProgressTracking(generation: number): void {
    this.stopPlaybackProgressTracking();
    if (typeof requestAnimationFrame !== "function") return;
    this.playbackProgressTracking = true;
    const sample = (): void => {
      if (!this.playbackProgressTracking || generation !== this.playbackGeneration) return;
      this.updatePlaybackProgressFromAnimations();
      if (!this.playbackProgressTracking || generation !== this.playbackGeneration) return;
      this.playbackProgressFrame = requestAnimationFrame(sample);
    };
    this.playbackProgressFrame = requestAnimationFrame(sample);
  }

  private stopPlaybackProgressTracking(): void {
    this.playbackProgressTracking = false;
    if (this.playbackProgressFrame === null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.playbackProgressFrame);
    this.playbackProgressFrame = null;
  }
}
