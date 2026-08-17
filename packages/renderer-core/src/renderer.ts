import { assertDeksDocument, isHttpsUrl, type DeksDocument } from "@deks-js/document";
import { compileTransition as compile } from "./transition.js";
import { toSlideSnapshot } from "./snapshot.js";
import type { CompiledTransition, ElementSnapshot, LayoutMeasurement, Rect, RendererOptions, ResolvedTransitionTiming, SlideSnapshot, TransitionOperation, ViewportMode } from "./types.js";
import { createIconSvg } from "./icons.js";
import { cssCornerRadii } from "./corner-radii.js";

const assign = (node: HTMLElement, styles: Partial<CSSStyleDeclaration>) => Object.assign(node.style, styles);

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
  private playbackGeneration = 0;
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

  private renderSlideSnapshot(snapshot: SlideSnapshot, clearCompiled: boolean): void {
    const stage = this.requireStage();
    this.cancelAnimations();
    this.snapshot = snapshot;
    this.targetSnapshot = undefined;
    if (clearCompiled) this.compiled = undefined;
    stage.style.aspectRatio = `${snapshot.canvas.width} / ${snapshot.canvas.height}`;
    stage.style.background = paint(snapshot.background);
    const backgroundLayer = this.requireBackgroundLayer();
    const contentLayer = this.requireContentLayer();
    backgroundLayer.style.background = paint(snapshot.background);
    contentLayer.replaceChildren(...[...snapshot.elements].sort((a, b) => a.zIndex - b.zIndex).map((element) => elementNode(element, snapshot.canvas)));
  }

  setViewportMode(mode: ViewportMode): void {
    this.mode = mode;
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
    const compiled = compile(from, to);
    this.renderSlideSnapshot(from, true);
    this.compiled = compiled;
    this.targetSnapshot = to;
    return compiled;
  }

  async play(): Promise<void> {
    const transition = this.compiled;
    const stage = this.requireStage();
    if (!transition) throw new Error("compileTransition must be called before play");
    this.cancelAnimations();
    const generation = this.playbackGeneration;
    const reduced = this.options.respectReducedMotion !== false
      && globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof stage.animate !== "function") {
      this.renderSlideSnapshot(transition.to, true);
      return;
    }

    const contentLayer = this.requireContentLayer();
    const playbackAnimations: Animation[] = [];
    const animate = (
      node: HTMLElement,
      keyframes: [Keyframe, Keyframe],
      timing: ResolvedTransitionTiming,
      cut = false,
    ): void => {
      const animation = node.animate(keyframes, {
        duration: cut ? 0 : timing.durationMs,
        delay: cut ? 0 : timing.delayMs,
        easing: timing.easing,
        fill: "both",
      });
      void animation.finished.catch(() => undefined);
      playbackAnimations.push(animation);
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
      this.renderSlideSnapshot(target, true);
    }
  }

  pause(): void { for (const animation of this.animations) animation.pause(); }
  stop(): void {
    const from = this.compiled?.from;
    this.cancelAnimations();
    if (from) this.renderSlideSnapshot(from, true);
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

  private cancelAnimations(): void {
    this.playbackGeneration += 1;
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
    ) => void,
  ): void {
    let node = nodes.get(operation.elementId);
    if (!node && operation.to) {
      node = elementNode(operation.to, canvas);
      contentLayer.append(node);
      nodes.set(operation.elementId, node);
    }
    if (!node) return;
    const cut = operation.renderMode === "cut";
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
    animate(node, operation.keyframes, operation.timing, cut);
  }
}
