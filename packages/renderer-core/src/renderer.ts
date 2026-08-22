import { assertDeksDocument, formatDeksNumber, isHttpsUrl, type DeksDocument } from "@deks-js/document";
import { compileTransition as compile } from "./transition.js";
import { toSlideSnapshot } from "./snapshot.js";
import type { CompiledTransition, ElementSnapshot, LayoutMeasurement, OnionSkinOptions, PlaybackProgressListener, Rect, RendererOptions, ResolvedTransitionTiming, SlideSnapshot, TransitionOperation, ViewportMode } from "./types.js";
import { createIconSvg } from "./icons.js";
import { cssCornerRadii } from "./corner-radii.js";
import { applyElementFrame, frameFromSnapshot, validateElementFrame, type ElementFrame } from "./preview.js";
import { validateSnapshot } from "./validation.js";

const assign = (node: HTMLElement, styles: Partial<CSSStyleDeclaration>) => Object.assign(node.style, styles);

function holdInitialKeyframeDuringDelay(node: HTMLElement, keyframe: Keyframe, delayMs: number): void {
  if (delayMs <= 0) return;
  const styles = Object.fromEntries(
    Object.entries(keyframe).filter(([property, value]) =>
      value !== undefined
      && property !== "offset"
      && property !== "easing"
      && property !== "composite"),
  ) as Partial<CSSStyleDeclaration>;
  assign(node, styles);
}

/**
 * Converts a canvas-space length into a length relative to the stage.
 *
 * The stage declares `container-type: inline-size`, so `1cqw` is one percent of
 * its rendered width. Geometry is already expressed in percentages, but radii,
 * strokes and spacing are absolute values in the document. Emitting them as
 * `px` pinned them to the viewport instead of the canvas: the same deck showed
 * a 32px corner radius whether the stage was 500px or 1600px wide, so a small
 * embed looked far more rounded — and its strokes far thicker — than fullscreen.
 */
const canvasLength = (value: number, canvasWidth: number): string =>
  `${(value / canvasWidth) * 100}cqw`;

function paint(background: SlideSnapshot["background"]): string {
  return background.kind === "solid"
    ? background.color
    : `linear-gradient(${background.angleDeg}deg, ${background.startColor}, ${background.endColor})`;
}

function backgroundNode(background: SlideSnapshot["background"], role: "current" | "outgoing"): HTMLElement {
  const node = document.createElement("div");
  node.dataset.deksBackground = role;
  assign(node, {
    position: "absolute",
    inset: "0",
    background: paint(background),
    pointerEvents: "none",
    zIndex: role === "current" ? "0" : "1",
  });
  return node;
}

function baseNode(element: ElementSnapshot, canvas: SlideSnapshot["canvas"], tag: "div" | "button" = "div"): HTMLElement {
  const node = document.createElement(tag);
  node.dataset.elementId = element.id;
  node.dataset.elementKind = element.kind;
  node.setAttribute("aria-label", element.name);
  assign(node, {
    position: "absolute",
    left: `${(element.rect.x / canvas.width) * 100}%`,
    top: `${(element.rect.y / canvas.height) * 100}%`,
    width: `${(element.rect.width / canvas.width) * 100}%`,
    height: `${(element.rect.height / canvas.height) * 100}%`,
    transform: `rotate(${element.rotationDeg}deg)`,
    transformOrigin: "top left",
    opacity: String(element.opacity),
    zIndex: String(element.zIndex),
    boxSizing: "border-box",
  });
  return node;
}

/**
 * Wraps a mounted element in a mask that occupies its rectangle, so the element
 * can travel inside it without leaving it.
 *
 * The mask takes over the rotation and the element keeps only its translation:
 * that puts the clip in the element's own local space, so a rotated figure
 * crops along its own axis instead of the canvas axis. Geometry moves to the
 * mask as well, because the element is now positioned relative to it.
 */
function cropMask(node: HTMLElement): HTMLElement {
  const mask = document.createElement("div");
  mask.dataset.deksCrop = "";
  assign(mask, {
    position: "absolute",
    left: node.style.left,
    top: node.style.top,
    width: node.style.width,
    height: node.style.height,
    transform: node.style.transform,
    transformOrigin: "top left",
    zIndex: node.style.zIndex,
    overflow: "hidden",
    pointerEvents: "none",
  });
  node.replaceWith(mask);
  assign(node, {
    left: "0%",
    top: "0%",
    width: "100%",
    height: "100%",
    transform: "translate(0, 0)",
    zIndex: "0",
  });
  mask.append(node);
  return mask;
}

/**
 * Counts the digits through a magnitude while an element animates.
 *
 * It rides the element's own animation instead of running a second clock: the
 * eased progress WAAPI already computes for the geometry is exactly the curve
 * the spec says the digits must follow, so the figure and the movement can
 * never drift apart or use different easings. When the host has no WAAPI at all
 * the caller never reaches this, and the final value is what gets painted —
 * which is what the specification asks for anyway.
 */
function countMagnitude(node: HTMLElement, operation: TransitionOperation, driver: Animation): void {
  const magnitude = operation.magnitude;
  const format = operation.to ?? operation.from;
  if (!magnitude || format?.kind !== "number") return;
  const write = (value: number) => {
    node.textContent = formatDeksNumber(value, format);
  };
  write(magnitude.from);

  // The renderer's shared playback sampler writes intermediate values; this
  // completion hook guarantees the exact destination without a second clock.
  void driver.finished.then(() => write(magnitude.to)).catch(() => write(magnitude.to));
}

function visualAabb(rect: Rect, degrees: number): Rect {
  const radians = degrees * Math.PI / 180;
  const rotate = (x: number, y: number) => ({
    x: rect.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: rect.y + x * Math.sin(radians) + y * Math.cos(radians),
  });
  const corners = [
    rotate(0, 0),
    rotate(rect.width, 0),
    rotate(0, rect.height),
    rotate(rect.width, rect.height),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function elementNode(element: ElementSnapshot, canvas: SlideSnapshot["canvas"]): HTMLElement {
  const wrapper = baseNode(element, canvas);
  if (element.kind === "text") {
    wrapper.textContent = element.content;
    wrapper.setAttribute("role", "text");
    assign(wrapper, {
      color: element.color,
      fontFamily: element.fontFamily,
      fontSize: canvasLength(element.fontSize, canvas.width),
      fontWeight: String(element.fontWeight),
      lineHeight: String(element.lineHeight),
      letterSpacing: canvasLength(element.letterSpacing, canvas.width),
      textAlign: element.horizontalAlignment,
      whiteSpace: "pre-wrap",
      overflow: element.overflowMode === "visible" ? "visible" : "hidden",
      display: "flex",
      alignItems: element.verticalAlignment === "top" ? "flex-start" : element.verticalAlignment === "bottom" ? "flex-end" : "center",
    });
    return wrapper;
  }
  if (element.kind === "number") {
    wrapper.textContent = formatDeksNumber(element.value, element);
    wrapper.setAttribute("role", "text");
    assign(wrapper, {
      color: element.color,
      fontFamily: element.fontFamily,
      fontSize: canvasLength(element.fontSize, canvas.width),
      fontWeight: String(element.fontWeight),
      lineHeight: String(element.lineHeight),
      letterSpacing: canvasLength(element.letterSpacing, canvas.width),
      textAlign: element.horizontalAlignment,
      // Tabular figures keep every digit the same width. Without them a
      // counting number rewrites its own line on every frame, and the audience
      // reads a figure that wobbles rather than one that rises.
      fontVariantNumeric: "tabular-nums",
      fontFeatureSettings: "\"tnum\"",
      whiteSpace: "pre-wrap",
      overflow: element.overflowMode === "visible" ? "visible" : "hidden",
      display: "flex",
      justifyContent: element.horizontalAlignment === "right"
        ? "flex-end"
        : element.horizontalAlignment === "center" ? "center" : "flex-start",
      alignItems: element.verticalAlignment === "top" ? "flex-start" : element.verticalAlignment === "bottom" ? "flex-end" : "center",
    });
    return wrapper;
  }
  if (element.kind === "image") {
    const image = document.createElement("img");
    image.alt = element.alt;
    if (element.src) image.src = element.src;
    assign(image, { width: "100%", height: "100%", objectFit: element.fit, display: "block" });
    wrapper.append(image);
    return wrapper;
  }
  if (element.kind === "shape") {
    const fill = element.fillStyle ? paint(element.fillStyle) : "transparent";
    assign(wrapper, {
      background: element.shapeKind === "line" ? "transparent" : fill,
      borderStyle: "solid",
      borderColor: element.stroke ?? (element.shapeKind === "line" ? fill : "transparent"),
      borderWidth: canvasLength(element.strokeWidth ?? (element.shapeKind === "line" ? 2 : 0), canvas.width),
      borderRadius: element.shapeKind === "ellipse"
        ? "50%"
        : cssCornerRadii(element.cornerRadius, element.cornerRadii, canvas.width),
    });
    return wrapper;
  }
  if (element.kind === "icon") {
    if (element.family !== "lucide" || element.strokeWidth < 0.5 || element.strokeWidth > 8) {
      throw new Error("icon must use a registered offline family and bounded stroke width");
    }
    const svg = createIconSvg(element.iconName, element.strokeWidth);
    wrapper.style.color = element.color;
    Object.assign(svg.style, { width: "100%", height: "100%", display: "block" });
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", element.name);
    wrapper.append(svg);
    return wrapper;
  }
  const button = baseNode(element, canvas, "button") as HTMLButtonElement;
  button.type = "button";
  button.textContent = element.label;
  button.dataset.elementId = element.id;
  button.dataset.elementKind = element.kind;
  button.dataset.externalUrl = element.url;
  button.setAttribute("aria-label", element.label);
  assign(button, {
    background: element.fill,
    color: element.textColor,
    fontFamily: element.fontFamily,
    fontSize: canvasLength(element.fontSize, canvas.width),
    fontWeight: String(element.fontWeight),
    borderStyle: "solid",
    borderColor: element.stroke ?? "transparent",
    borderWidth: canvasLength(element.strokeWidth ?? 0, canvas.width),
    borderRadius: canvasLength(element.cornerRadius, canvas.width),
    cursor: "pointer",
  });
  return button;
}

export class RendererCore {
  private host: HTMLElement | undefined;
  private stage: HTMLElement | undefined;
  private backgroundLayer: HTMLElement | undefined;
  private outgoingBackgroundLayer: HTMLElement | undefined;
  private contentLayer: HTMLElement | undefined;
  private snapshot: SlideSnapshot | undefined;
  private targetSnapshot: SlideSnapshot | undefined;
  private compiled: CompiledTransition | undefined;
  private animations: Animation[] = [];
  private playback: Promise<void> | undefined;
  private playbackGeneration = 0;
  private playbackRate = 1;
  private playbackProgress = 0;
  private playbackProgressFrame: number | undefined;
  private readonly playbackProgressListeners = new Set<PlaybackProgressListener>();
  private readonly elementNodes = new Map<string, HTMLElement>();
  private readonly canonicalFrames = new Map<string, ElementFrame>();
  private readonly previewedElementIds = new Set<string>();
  private readonly selectedElementIds = new Set<string>();
  private onionSnapshot: SlideSnapshot | undefined;
  private onionOpacity = 0.25;
  private mode: ViewportMode = "editor";

  constructor(private readonly options: RendererOptions = {}) {}

  mount(host: HTMLElement): void {
    this.destroy();
    this.host = host;
    this.stage = document.createElement("div");
    this.stage.dataset.deksStage = "";
    assign(this.stage, {
      position: "relative",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      containerType: "inline-size",
      isolation: "isolate",
    });
    this.stage.addEventListener("click", this.activate);
    this.backgroundLayer = backgroundNode({ kind: "solid", color: "#000000" }, "current");
    this.contentLayer = document.createElement("div");
    this.contentLayer.dataset.deksContent = "";
    assign(this.contentLayer, {
      position: "absolute",
      inset: "0",
      zIndex: "2",
    });
    this.stage.append(this.backgroundLayer, this.contentLayer);
    host.replaceChildren(this.stage);
  }

  renderSlide(document: DeksDocument, slideId: string): void;
  renderSlide(snapshot: SlideSnapshot): void;
  renderSlide(documentOrSnapshot: DeksDocument | SlideSnapshot, slideId?: string): void {
    if ("format" in documentOrSnapshot) {
      assertDeksDocument(documentOrSnapshot);
      if (slideId === undefined) throw new Error("slideId is required");
      this.renderSlideSnapshot(toSlideSnapshot(documentOrSnapshot, slideId, this.options.assetResolver), true);
      return;
    }
    this.renderSlideSnapshot(documentOrSnapshot, true);
  }

  private renderSlideSnapshot(snapshot: SlideSnapshot, clearCompiled: boolean, resetPlaybackProgress = clearCompiled): void {
    validateSnapshot(snapshot);
    const stage = this.requireStage();
    this.cancelAnimations();
    if (resetPlaybackProgress) this.updatePlaybackProgress(0);
    this.snapshot = snapshot;
    this.targetSnapshot = undefined;
    if (clearCompiled) this.compiled = undefined;
    stage.style.aspectRatio = `${snapshot.canvas.width} / ${snapshot.canvas.height}`;
    stage.style.background = paint(snapshot.background);
    const backgroundLayer = this.requireBackgroundLayer();
    const contentLayer = this.requireContentLayer();
    backgroundLayer.style.background = paint(snapshot.background);
    stage.querySelector(":scope > [data-deks-onion]")?.remove();
    if (this.onionSnapshot
      && (this.onionSnapshot.canvas.width !== snapshot.canvas.width
        || this.onionSnapshot.canvas.height !== snapshot.canvas.height)) {
      this.onionSnapshot = undefined;
    }
    if (this.onionSnapshot) stage.insertBefore(this.createOnionLayer(this.onionSnapshot, this.onionOpacity), contentLayer);
    this.elementNodes.clear();
    this.canonicalFrames.clear();
    this.previewedElementIds.clear();
    const nodes = [...snapshot.elements]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((element) => {
        const node = elementNode(element, snapshot.canvas);
        this.elementNodes.set(element.id, node);
        this.canonicalFrames.set(element.id, frameFromSnapshot(element));
        return node;
      });
    contentLayer.replaceChildren(...nodes);
    const retainedSelection = [...this.selectedElementIds].filter((id) => this.elementNodes.has(id));
    this.selectedElementIds.clear();
    for (const id of retainedSelection) {
      this.selectedElementIds.add(id);
      this.elementNodes.get(id)!.dataset.deksSelected = "";
    }
  }

  /** Applies one transient editor frame without changing the canonical snapshot. */
  previewElement(state: ElementSnapshot): boolean {
    return this.previewElements([state]);
  }

  /** Restores one transient frame from the last canonical render. */
  restoreElement(elementId: string): boolean {
    return this.restoreElements([elementId]);
  }

  /** Applies a preview batch only after every member has passed validation. */
  previewElements(states: readonly ElementSnapshot[]): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return false;
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
      const frame = frameFromSnapshot(state);
      validateElementFrame(frame);
      changes.push({ id: state.id, node, frame });
    }
    for (const { id, node, frame } of changes) {
      applyElementFrame(node, frame, snapshot.canvas);
      this.previewedElementIds.add(id);
    }
    return true;
  }

  /** Restores selected previews, or all active previews when ids are omitted. */
  restoreElements(elementIds?: readonly string[]): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return false;
    const ids = elementIds ? [...new Set(elementIds)] : [...this.previewedElementIds];
    const changes: Array<{ id: string; node: HTMLElement; frame: ElementFrame }> = [];
    for (const id of ids) {
      const node = this.elementNodes.get(id);
      const frame = this.canonicalFrames.get(id);
      if (!node || !frame) return false;
      changes.push({ id, node, frame });
    }
    for (const { id, node, frame } of changes) {
      applyElementFrame(node, frame, snapshot.canvas);
      this.previewedElementIds.delete(id);
    }
    return true;
  }

  setViewportMode(mode: ViewportMode): void {
    if (mode !== "presentation" && mode !== "editor") throw new Error(`invalid viewport mode: ${String(mode)}`);
    this.mode = mode;
  }

  /** Marks mounted nodes for a host-owned selection overlay. */
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

  /** Renders a non-interactive previous checkpoint behind the active scene. */
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
    this.onionSnapshot = snapshot ?? undefined;
    this.onionOpacity = opacity;
    if (!this.stage) return;
    this.stage.querySelector(":scope > [data-deks-onion]")?.remove();
    if (snapshot) this.stage.insertBefore(this.createOnionLayer(snapshot, opacity), this.requireContentLayer());
  }

  compileTransition(document: DeksDocument, fromSlideId: string, toSlideId: string): CompiledTransition;
  compileTransition(from: SlideSnapshot, to: SlideSnapshot): CompiledTransition;
  compileTransition(
    documentOrFrom: DeksDocument | SlideSnapshot,
    slideIdOrTo: string | SlideSnapshot,
    toSlideId?: string,
  ): CompiledTransition {
    if (!("format" in documentOrFrom)) {
      if (typeof slideIdOrTo === "string") throw new Error("snapshot transition arguments are invalid");
      return this.stageCompiled(documentOrFrom, slideIdOrTo);
    }
    assertDeksDocument(documentOrFrom);
    if (typeof slideIdOrTo !== "string" || typeof toSlideId !== "string") {
      throw new Error("document transition arguments are invalid");
    }
    return this.stageCompiled(
      toSlideSnapshot(documentOrFrom, slideIdOrTo, this.options.assetResolver),
      toSlideSnapshot(documentOrFrom, toSlideId, this.options.assetResolver),
    );
  }

  private stageCompiled(from: SlideSnapshot, to: SlideSnapshot): CompiledTransition {
    validateSnapshot(from);
    validateSnapshot(to);
    const compiled = compile(from, to);
    this.renderSlideSnapshot(from, true);
    this.compiled = compiled;
    this.targetSnapshot = to;
    return compiled;
  }

  async play(): Promise<void> {
    if (this.playback && this.animations.length > 0) {
      for (const animation of this.animations) animation.play();
      this.startPlaybackProgressTracking(this.playbackGeneration);
      await this.playback;
      return;
    }
    const transition = this.compiled;
    if (!transition) throw new Error("compileTransition must be called before play");
    const playback = this.runPlayback(transition);
    this.playback = playback;
    try {
      await playback;
    } finally {
      if (this.playback === playback) this.playback = undefined;
    }
  }

  private async runPlayback(transition: CompiledTransition): Promise<void> {
    const stage = this.requireStage();
    this.cancelAnimations();
    const generation = this.playbackGeneration;
    const reduced = this.options.respectReducedMotion !== false
      && globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof stage.animate !== "function") {
      this.renderSlideSnapshot(transition.to, true, false);
      this.updatePlaybackProgress(1);
      return;
    }

    const contentLayer = this.requireContentLayer();
    const playbackAnimations: Animation[] = [];
    const animate = (
      node: HTMLElement,
      keyframes: [Keyframe, Keyframe],
      timing: ResolvedTransitionTiming,
      cut = false,
    ): Animation => {
      holdInitialKeyframeDuringDelay(node, keyframes[0], cut ? 0 : timing.delayMs);
      const animation = node.animate(keyframes, {
        duration: cut ? 0 : timing.durationMs,
        delay: cut ? 0 : timing.delayMs,
        easing: timing.easing,
        fill: "both",
      });
      void animation.finished.catch(() => undefined);
      animation.playbackRate = this.playbackRate;
      // WKWebView may create a WAAPI animation paused. Playback is an explicit
      // renderer command; never depend on a browser's autoplay default.
      animation.play();
      playbackAnimations.push(animation);
      return animation;
    };

    try {
      if (JSON.stringify(transition.from.background) !== JSON.stringify(transition.to.background)) {
        const current = this.requireBackgroundLayer();
        current.style.background = paint(transition.to.background);
        const outgoing = backgroundNode(transition.from.background, "outgoing");
        stage.insertBefore(outgoing, contentLayer);
        this.outgoingBackgroundLayer = outgoing;
        animate(outgoing, [{ opacity: 1 }, { opacity: 0 }], {
          durationMs: transition.durationMs,
          delayMs: transition.delayMs,
          easing: transition.easing,
        });
      }

      const nodes = new Map(
        [...contentLayer.querySelectorAll<HTMLElement>("[data-element-id]")]
          .map((node) => [node.dataset.elementId!, node]),
      );
      for (const operation of transition.operations) {
        this.prepareOperation(operation, transition.to.canvas, nodes, contentLayer, animate);
      }
    } catch (error) {
      this.cancelAnimationList(playbackAnimations);
      this.renderSlideSnapshot(transition.from, true);
      throw error;
    }

    this.animations = playbackAnimations;
    this.startPlaybackProgressTracking(generation);
    try {
      await Promise.all(playbackAnimations.map(({ finished }) => finished));
    } catch (error) {
      if (generation !== this.playbackGeneration) return;
      this.cancelAnimations();
      this.compiled = undefined;
      this.targetSnapshot = undefined;
      throw error;
    }
    if (generation === this.playbackGeneration && this.targetSnapshot) {
      const target = this.targetSnapshot;
      this.stopPlaybackProgressTracking();
      this.renderSlideSnapshot(target, true, false);
      this.updatePlaybackProgress(1);
    }
  }

  seek(milliseconds: number): void {
    const transition = this.compiled;
    if (!transition) throw new Error("compileTransition must be called before seek");
    if (!Number.isFinite(milliseconds)) throw new Error("seek time must be finite");
    if (this.animations.length === 0) {
      const playback = this.play();
      void playback.catch(() => undefined);
      this.pause();
    }
    const time = Math.min(Math.max(milliseconds, 0), transition.totalDurationMs);
    for (const animation of this.animations) animation.currentTime = time;
    this.updateMagnitudeAtTime(time);
    this.updatePlaybackProgress(this.normalizePlaybackTime(time));
  }

  pause(): void {
    for (const animation of this.animations) animation.pause();
    this.updatePlaybackProgressFromAnimations();
    this.stopPlaybackProgressTracking();
  }

  stop(): void {
    this.pause();
    if (this.compiled) this.seek(0);
    else this.updatePlaybackProgress(0);
  }

  setPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("playback rate must be a positive finite number");
    this.playbackRate = rate;
    for (const animation of this.animations) animation.playbackRate = rate;
  }

  getPlaybackProgress(): number {
    return this.playbackProgress;
  }

  subscribePlaybackProgress(listener: PlaybackProgressListener): () => void {
    this.playbackProgressListeners.add(listener);
    this.notifyPlaybackProgressListener(listener, this.playbackProgress);
    return () => { this.playbackProgressListeners.delete(listener); };
  }

  measureLayout(): LayoutMeasurement[] {
    const stage = this.requireStage();
    if (!this.snapshot) return [];
    const nodes = new Map(
      [...stage.querySelectorAll<HTMLElement>("[data-element-id]")]
        .map((node) => [node.dataset.elementId!, node]),
    );
    const stageBounds = stage.getBoundingClientRect();
    const scaleX = stageBounds.width > 0 ? this.snapshot.canvas.width / stageBounds.width : 1;
    const scaleY = stageBounds.height > 0 ? this.snapshot.canvas.height / stageBounds.height : 1;
    return this.snapshot.elements.map((element) => {
      const node = nodes.get(element.id);
      const measurement: LayoutMeasurement = {
        elementId: element.id,
        rect: { ...element.rect },
        visualAabb: visualAabb(element.rect, element.rotationDeg),
        sources: { rect: "exact", visualAabb: "calculated" },
      };
      if (element.kind !== "text" || !node) return measurement;
      measurement.overflowStatus = node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight
        ? "overflow"
        : "fits";
      const range = document.createRange();
      range.selectNodeContents(node);
      if (typeof range.getBoundingClientRect !== "function") return measurement;
      const bounds = range.getBoundingClientRect();
      measurement.contentRect = {
        x: (bounds.left - stageBounds.left) * scaleX,
        y: (bounds.top - stageBounds.top) * scaleY,
        width: bounds.width * scaleX,
        height: bounds.height * scaleY,
      };
      measurement.sources.contentRect = "dom";
      return measurement;
    });
  }

  destroy(): void {
    this.cancelAnimations();
    this.updatePlaybackProgress(0);
    this.stage?.removeEventListener("click", this.activate);
    this.stage?.remove();
    this.stage = undefined;
    this.backgroundLayer = undefined;
    this.outgoingBackgroundLayer = undefined;
    this.contentLayer = undefined;
    this.host = undefined;
    this.snapshot = undefined;
    this.targetSnapshot = undefined;
    this.compiled = undefined;
    this.playback = undefined;
    this.elementNodes.clear();
    this.canonicalFrames.clear();
    this.previewedElementIds.clear();
    this.selectedElementIds.clear();
    this.onionSnapshot = undefined;
    this.playbackProgressListeners.clear();
  }

  private readonly activate = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-element-id]") : null;
    if (!target) return;
    const elementId = target.dataset.elementId;
    if (this.mode === "editor") {
      if (elementId) this.options.onSelectElement?.(elementId);
      return;
    }
    const url = target.dataset.externalUrl;
    if (url && isHttpsUrl(url)) void this.options.onOpenExternal?.(url);
  };

  private requireStage(): HTMLElement {
    if (!this.stage) throw new Error("mount must be called before rendering");
    return this.stage;
  }

  private requireBackgroundLayer(): HTMLElement {
    if (!this.backgroundLayer) throw new Error("mount must be called before rendering");
    return this.backgroundLayer;
  }

  private requireContentLayer(): HTMLElement {
    if (!this.contentLayer) throw new Error("mount must be called before rendering");
    return this.contentLayer;
  }

  private createOnionLayer(snapshot: SlideSnapshot, opacity: number): HTMLElement {
    const layer = document.createElement("div");
    layer.dataset.deksOnion = "";
    layer.setAttribute("aria-hidden", "true");
    assign(layer, {
      position: "absolute",
      inset: "0",
      zIndex: "1",
      pointerEvents: "none",
      opacity: String(opacity),
      overflow: "hidden",
    });
    const background = backgroundNode(snapshot.background, "current");
    background.removeAttribute("data-deks-background");
    background.dataset.deksOnionBackground = "";
    layer.append(background);
    for (const element of [...snapshot.elements].sort((a, b) => a.zIndex - b.zIndex)) {
      const node = elementNode(element, snapshot.canvas);
      delete node.dataset.elementId;
      node.dataset.onionElementId = element.id;
      node.removeAttribute("tabindex");
      node.setAttribute("aria-hidden", "true");
      layer.append(node);
    }
    return layer;
  }

  private cancelAnimations(): void {
    this.playbackGeneration += 1;
    this.stopPlaybackProgressTracking();
    this.cancelAnimationList(this.animations);
    this.animations = [];
    this.outgoingBackgroundLayer?.remove();
    this.outgoingBackgroundLayer = undefined;
  }

  private cancelAnimationList(animations: Animation[]): void {
    for (const animation of animations) {
      try { animation.cancel(); } catch { /* continue cleanup */ }
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
    const time = Math.max(...times);
    this.updateMagnitudeAtTime(time);
    this.updatePlaybackProgress(this.normalizePlaybackTime(time));
  }

  private updateMagnitudeAtTime(milliseconds: number): void {
    for (const operation of this.compiled?.operations ?? []) {
      const magnitude = operation.magnitude;
      const format = operation.to ?? operation.from;
      if (!magnitude || format?.kind !== "number") continue;
      const elapsed = milliseconds - operation.timing.delayMs;
      const progress = operation.timing.durationMs <= 0
        ? (elapsed >= 0 ? 1 : 0)
        : Math.min(Math.max(elapsed / operation.timing.durationMs, 0), 1);
      const node = this.elementNodes.get(operation.elementId);
      if (node) node.textContent = formatDeksNumber(magnitude.from + (magnitude.to - magnitude.from) * progress, format);
    }
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
    try { listener(progress); } catch { /* host callbacks cannot break renderer playback */ }
  }

  private startPlaybackProgressTracking(generation: number): void {
    this.stopPlaybackProgressTracking();
    if (typeof globalThis.requestAnimationFrame !== "function") return;
    const sample = () => {
      if (generation !== this.playbackGeneration) return;
      this.updatePlaybackProgressFromAnimations();
      if (generation !== this.playbackGeneration) return;
      let synchronous = true;
      const frame = globalThis.requestAnimationFrame(() => {
        if (!synchronous) sample();
      });
      synchronous = false;
      this.playbackProgressFrame = frame;
    };
    sample();
  }

  private stopPlaybackProgressTracking(): void {
    if (this.playbackProgressFrame === undefined) return;
    globalThis.cancelAnimationFrame?.(this.playbackProgressFrame);
    this.playbackProgressFrame = undefined;
  }

  private prepareOperation(
    operation: TransitionOperation,
    canvas: SlideSnapshot["canvas"],
    nodes: Map<string, HTMLElement>,
    contentLayer: HTMLElement,
    animate: (
      node: HTMLElement,
      keyframes: [Keyframe, Keyframe],
      timing: ResolvedTransitionTiming,
      cut?: boolean,
    ) => Animation,
  ): void {
    let node = nodes.get(operation.elementId);
    if (!node && operation.to) {
      node = elementNode(operation.to, canvas);
      contentLayer.append(node);
      nodes.set(operation.elementId, node);
      this.elementNodes.set(operation.elementId, node);
    }
    if (!node) return;
    const cut = operation.renderMode === "cut";
    if (operation.wipe && !cut) {
      // No wrapper: `inset()` clips inside the element's own border box, which
      // is what makes this the opposite of a crop — the element never moves,
      // only the boundary over it does.
      const [start, end] = operation.keyframes;
      const driver = animate(node, [
        { ...start, ...operation.wipe.keyframes[0], opacity: undefined },
        { ...end, ...operation.wipe.keyframes[1], opacity: undefined },
      ], operation.timing);
      if (operation.magnitude) countMagnitude(node, operation, driver);
      return;
    }
    if (operation.crop && !cut) {
      // The mask is the element's own rectangle, so the geometry keyframes
      // belong to it and only the translation stays on the element.
      const mask = cropMask(node);
      const [start, end] = operation.keyframes;
      const geometry: [Keyframe, Keyframe] = [
        { ...start, transform: end.transform, opacity: undefined },
        { ...end, opacity: undefined },
      ];
      animate(mask, geometry, operation.timing);
      const driver = animate(node, operation.crop.keyframes, operation.timing);
      if (operation.magnitude) countMagnitude(node, operation, driver);
      return;
    }
    if ((operation.renderMode === "crossfade" || cut)
      && operation.from && operation.to && operation.crossfadeKeyframes) {
      node.dataset.transitionElementId = operation.elementId;
      node.dataset.transitionLayer = "from";
      node.setAttribute("aria-hidden", "true");
      const target = elementNode(operation.to, canvas);
      target.dataset.transitionElementId = operation.elementId;
      target.dataset.transitionLayer = "to";
      contentLayer.append(target);
      animate(node, operation.crossfadeKeyframes.from, operation.crossfadeTiming?.from ?? operation.timing, cut);
      animate(target, operation.crossfadeKeyframes.to, operation.crossfadeTiming?.to ?? operation.timing, cut);
      return;
    }
    const driver = animate(node, operation.keyframes, operation.timing, cut);
    if (operation.magnitude && !cut) countMagnitude(node, operation, driver);
  }
}
