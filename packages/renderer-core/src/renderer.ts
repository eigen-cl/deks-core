import { isHttpsUrl } from "@deks-js/document";
import type { CompiledTransition, ElementSnapshot, LayoutMeasurement, Rect, RendererOptions, SlideSnapshot, ViewportMode } from "./types.js";
import { createIconSvg } from "./icons.js";

const assign = (node: HTMLElement, styles: Partial<CSSStyleDeclaration>) => Object.assign(node.style, styles);

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

function elementNode(element: ElementSnapshot, canvas: SlideSnapshot["canvas"], options: RendererOptions): HTMLElement {
  const wrapper = baseNode(element, canvas);
  if (element.kind === "text") {
    wrapper.textContent = element.content;
    wrapper.setAttribute("role", "text");
    assign(wrapper, {
      color: element.color,
      fontFamily: element.fontFamily,
      fontSize: `${(element.fontSize / canvas.width) * 100}cqw`,
      fontWeight: String(element.fontWeight),
      lineHeight: String(element.lineHeight),
      letterSpacing: `${element.letterSpacing}px`,
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
    const resolved = options.assetResolver?.({
      ...(element.assetId === undefined ? {} : { assetId: element.assetId }),
      ...(element.assetUrl === undefined ? {} : { assetUrl: element.assetUrl }),
      alt: element.alt,
    }) ?? element.src ?? element.assetUrl;
    if (resolved) image.src = resolved;
    assign(image, { width: "100%", height: "100%", objectFit: element.fit, display: "block" });
    wrapper.append(image);
    return wrapper;
  }
  if (element.kind === "shape") {
    const fill = element.fillStyle ? paint(element.fillStyle) : "transparent";
    assign(wrapper, {
      background: element.shapeKind === "line" ? "transparent" : fill,
      border: `${element.strokeWidth ?? (element.shapeKind === "line" ? 2 : 0)}px solid ${element.stroke ?? (element.shapeKind === "line" ? fill : "transparent")}`,
      borderRadius: element.shapeKind === "ellipse" ? "50%" : `${element.cornerRadius ?? 0}px`,
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
    fontSize: `${(element.fontSize / canvas.width) * 100}cqw`,
    fontWeight: String(element.fontWeight),
    border: `${element.strokeWidth ?? 0}px solid ${element.stroke ?? "transparent"}`,
    borderRadius: `${element.cornerRadius}px`,
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
  private compiled: CompiledTransition | undefined;
  private animations: Animation[] = [];
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

  renderSlide(snapshot: SlideSnapshot): void {
    const stage = this.requireStage();
    this.cancelAnimations();
    this.snapshot = snapshot;
    stage.style.aspectRatio = `${snapshot.canvas.width} / ${snapshot.canvas.height}`;
    stage.style.background = paint(snapshot.background);
    const backgroundLayer = this.requireBackgroundLayer();
    const contentLayer = this.requireContentLayer();
    backgroundLayer.style.background = paint(snapshot.background);
    contentLayer.replaceChildren(...[...snapshot.elements].sort((a, b) => a.zIndex - b.zIndex).map((element) => elementNode(element, snapshot.canvas, this.options)));
  }

  setViewportMode(mode: ViewportMode): void {
    this.mode = mode;
  }

  compileTransition(from: SlideSnapshot, to: SlideSnapshot, options: CompiledTransition["options"]): CompiledTransition {
    const reduced = this.options.respectReducedMotion !== false && globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.compiled = {
      from,
      to,
      options,
      durationMs: reduced ? 0 : options.effectiveDurationMs,
    };
    if (!this.snapshot || this.snapshot.id !== from.id) this.renderSlide(from);
    return this.compiled;
  }

  async play(): Promise<void> {
    const transition = this.compiled;
    const stage = this.requireStage();
    if (!transition) throw new Error("compileTransition must be called before play");
    this.cancelAnimations();
    this.renderSlide(transition.to);
    if (transition.durationMs <= 0 || typeof stage.animate !== "function") return;
    const outgoingBackground = backgroundNode(transition.from.background, "outgoing");
    const contentLayer = this.requireContentLayer();
    stage.insertBefore(outgoingBackground, contentLayer);
    this.outgoingBackgroundLayer = outgoingBackground;
    const timing: KeyframeAnimationOptions = {
      duration: transition.durationMs,
      delay: transition.options.delayMs,
      easing: transition.options.easing === "cubic-bezier" ? `cubic-bezier(${(transition.options.bezier ?? [0.25, 0.1, 0.25, 1]).join(",")})` : transition.options.easing,
      fill: "both",
    };
    const backgroundAnimation = outgoingBackground.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      timing,
    );
    const contentAnimation = contentLayer.animate(
      [{ opacity: 0, transform: "translateY(1%)" }, { opacity: 1, transform: "translateY(0)" }],
      timing,
    );
    const playbackAnimations = [backgroundAnimation, contentAnimation];
    this.animations = playbackAnimations;
    try {
      await Promise.all(playbackAnimations.map(({ finished }) => finished));
    } catch {
      /* cancellation is a valid navigation interruption */
    } finally {
      if (this.animations === playbackAnimations) this.animations = [];
      if (this.outgoingBackgroundLayer === outgoingBackground) {
        outgoingBackground.remove();
        this.outgoingBackgroundLayer = undefined;
      }
    }
  }

  pause(): void { for (const animation of this.animations) animation.pause(); }
  stop(): void { this.cancelAnimations(); if (this.compiled) this.renderSlide(this.compiled.from); }

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
    for (const animation of this.animations) {
      try { animation.cancel(); } catch { /* continue cleanup */ }
    }
    this.animations = [];
    this.outgoingBackgroundLayer?.remove();
    this.outgoingBackgroundLayer = undefined;
  }
}
