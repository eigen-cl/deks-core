import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { asHttpsUrl, type AssetResolver, type DeksDocument, type HttpsUrl } from "@deks-js/document";
import { DeksCanvas, type DeksCanvasHandle } from "./DeksCanvas.js";

export interface DeksPresenterProps {
  /** Canonical DEKS document to present. Preferred over the legacy `document` prop. */
  presentation?: DeksDocument;
  /** @deprecated Use `presentation`. Kept so existing hosts keep compiling. */
  document?: DeksDocument;
  /** `embedded` sits inside a layout; `immersive` fills its host surface. */
  variant?: "embedded" | "immersive";
  /** Slide to open on, by id. Falls back to the first slide. */
  initialSlideId?: string;
  /** Hides the control bar for a decorative or externally driven player. */
  showControls?: boolean;
  /** Requests native fullscreen while true, and exits when it turns false. */
  fullScreen?: boolean;
  extraControls?: ReactNode;
  onExit?: () => void;
  onSlideChange?: (slideId: string, index: number) => void;
  onOpenExternal?: (url: HttpsUrl) => void | Promise<void>;
  assetResolver?: AssetResolver;
  className?: string;
}

export interface DeksPresenterHandle {
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  goTo(slideId: string): Promise<boolean>;
  requestFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
}

export const DeksPresenter = forwardRef<DeksPresenterHandle, DeksPresenterProps>(function DeksPresenter(
  {
    presentation,
    document: legacyDocument,
    variant = "embedded",
    initialSlideId,
    showControls = true,
    fullScreen = false,
    extraControls,
    onExit,
    onSlideChange,
    onOpenExternal,
    assetResolver,
    className = "",
  },
  ref,
) {
  const deck = presentation ?? legacyDocument;
  if (!deck) throw new Error("DeksPresenter requires a presentation document");
  const initialIndex = Math.max(0, initialSlideId ? deck.slides.findIndex(({ id }) => id === initialSlideId) : 0);
  const [index, setIndex] = useState(initialIndex);
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<DeksCanvasHandle | null>(null);
  const moving = useRef(false);
  const shownIndex = Math.min(index, Math.max(0, deck.slides.length - 1));

  useEffect(() => {
    if (initialSlideId) {
      const next = deck.slides.findIndex(({ id }) => id === initialSlideId);
      setIndex(next < 0 ? 0 : next);
    } else {
      setIndex((value) => Math.min(value, Math.max(0, deck.slides.length - 1)));
    }
  }, [deck, initialSlideId]);

  const moveTo = useCallback(async (target: number): Promise<boolean> => {
    if (moving.current || target < 0 || target >= deck.slides.length || target === shownIndex) return false;
    moving.current = true;
    try {
      const from = deck.slides[shownIndex]!;
      const to = deck.slides[target]!;
      await canvasRef.current?.play(from.id, to.id);
      setIndex(target);
      onSlideChange?.(to.id, target);
      return true;
    } finally {
      moving.current = false;
    }
  }, [deck, onSlideChange, shownIndex]);

  const requestFullscreen = useCallback(async () => {
    if (!root.current?.requestFullscreen) throw new Error("Fullscreen API is unavailable");
    await root.current.requestFullscreen();
  }, []);
  const exitFullscreen = useCallback(async () => {
    if (globalThis.document?.fullscreenElement !== root.current) return;
    await globalThis.document.exitFullscreen?.();
  }, []);

  useEffect(() => {
    // Declarative fullscreen: the host owns the intent, the browser owns the
    // gesture requirement. A rejected request stays silent for the renderer and
    // surfaces to the host through the returned promise of the handle instead.
    const active = globalThis.document?.fullscreenElement === root.current;
    if (fullScreen === active) return;
    void (fullScreen ? requestFullscreen() : exitFullscreen()).catch(() => undefined);
  }, [exitFullscreen, fullScreen, requestFullscreen]);

  useImperativeHandle(ref, () => ({
    next: () => moveTo(shownIndex + 1),
    previous: () => moveTo(shownIndex - 1),
    goTo: async (slideId) => moveTo(deck.slides.findIndex((slide) => slide.id === slideId)),
    requestFullscreen,
    exitFullscreen,
  }), [deck.slides, exitFullscreen, moveTo, requestFullscreen, shownIndex]);

  const slide = deck.slides[shownIndex];
  if (!slide) return <div className="deks-empty" role="alert">La presentación no contiene slides.</div>;

  return (
    <section
      ref={root}
      className={`deks-presenter deks-presenter--${variant} ${className}`.trim()}
      aria-label={`Presentación ${deck.name}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.defaultPrevented || isInteractive(event.target)) return;
        if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); void moveTo(shownIndex + 1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); void moveTo(shownIndex - 1); }
      }}
    >
      <div className="deks-presenter__stage">
        <DeksCanvas
          rendererRef={canvasRef}
          document={deck}
          slideId={slide.id}
          mode="presentation"
          assetResolver={assetResolver}
          onOpenExternal={(url) => onOpenExternal?.(asHttpsUrl(url))}
        />
      </div>
      {showControls && (
        <nav className="deks-controls" aria-label="Controles de presentación">
          <button className="deks-control" type="button" aria-label="Slide anterior" disabled={shownIndex === 0} onClick={() => void moveTo(shownIndex - 1)}>‹</button>
          <span className="deks-controls__counter" aria-live="polite">{shownIndex + 1} / {deck.slides.length}</span>
          <button className="deks-control" type="button" aria-label="Slide siguiente" disabled={shownIndex === deck.slides.length - 1} onClick={() => void moveTo(shownIndex + 1)}>›</button>
          {extraControls && <div className="deks-controls__extra">{extraControls}</div>}
          {onExit && <button className="deks-control deks-control--text" type="button" onClick={onExit}>Salir</button>}
        </nav>
      )}
    </section>
  );
});

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button,a,input,textarea,select,[contenteditable=true]"));
}
