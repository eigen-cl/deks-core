import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { asHttpsUrl, type AssetResolver, type DeksDocument, type HttpsUrl } from "@deks-js/document";
import { DeksCanvas, type DeksCanvasHandle } from "./DeksCanvas.js";

export interface DeksPresenterProps {
  document: DeksDocument;
  variant?: "embedded" | "immersive";
  initialSlideId?: string;
  extraControls?: ReactNode;
  onExit?: () => void;
  onOpenExternal?: (url: HttpsUrl) => void | Promise<void>;
  assetResolver?: AssetResolver;
  className?: string;
}

export interface DeksPresenterHandle {
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  goTo(slideId: string): Promise<boolean>;
  requestFullscreen(): Promise<void>;
}

export const DeksPresenter = forwardRef<DeksPresenterHandle, DeksPresenterProps>(function DeksPresenter(
  {
    document: deck,
    variant = "embedded",
    initialSlideId,
    extraControls,
    onExit,
    onOpenExternal,
    assetResolver,
    className = "",
  },
  ref,
) {
  const initialIndex = Math.max(0, initialSlideId ? deck.slides.findIndex(({ id }) => id === initialSlideId) : 0);
  const [index, setIndex] = useState(initialIndex);
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<DeksCanvasHandle | null>(null);
  const moving = useRef(false);
  const canvas = useMemo(() => ({ width: deck.canvasWidth, height: deck.canvasHeight }), [deck.canvasHeight, deck.canvasWidth]);
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
      const edge = target > shownIndex
        ? deck.transitions.find((transition) => transition.fromSlideId === from.id && transition.toSlideId === to.id)
        : deck.transitions.find((transition) => transition.fromSlideId === to.id && transition.toSlideId === from.id);
      if (edge) await canvasRef.current?.play(from, to, edge);
      setIndex(target);
      return true;
    } finally {
      moving.current = false;
    }
  }, [deck, shownIndex]);

  useImperativeHandle(ref, () => ({
    next: () => moveTo(shownIndex + 1),
    previous: () => moveTo(shownIndex - 1),
    goTo: async (slideId) => moveTo(deck.slides.findIndex((slide) => slide.id === slideId)),
    requestFullscreen: async () => {
      if (!root.current?.requestFullscreen) throw new Error("Fullscreen API is unavailable");
      await root.current.requestFullscreen();
    },
  }), [deck.slides, moveTo, shownIndex]);

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
          slide={slide}
          canvas={canvas}
          mode="presentation"
          assetResolver={assetResolver}
          onOpenExternal={(url) => onOpenExternal?.(asHttpsUrl(url))}
        />
      </div>
      <nav className="deks-controls" aria-label="Controles de presentación">
        <button className="deks-control" type="button" aria-label="Slide anterior" disabled={shownIndex === 0} onClick={() => void moveTo(shownIndex - 1)}>‹</button>
        <span className="deks-controls__counter" aria-live="polite">{shownIndex + 1} / {deck.slides.length}</span>
        <button className="deks-control" type="button" aria-label="Slide siguiente" disabled={shownIndex === deck.slides.length - 1} onClick={() => void moveTo(shownIndex + 1)}>›</button>
        {extraControls && <div className="deks-controls__extra">{extraControls}</div>}
        {onExit && <button className="deks-control deks-control--text" type="button" onClick={onExit}>Salir</button>}
      </nav>
    </section>
  );
});

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button,a,input,textarea,select,[contenteditable=true]"));
}
