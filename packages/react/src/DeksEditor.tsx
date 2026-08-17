import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  applyDeksCommands,
  commandKind,
  type AssetResolver,
  type DeksCommand,
  type DeksDocument,
  type DeksEditorChangeHandler,
  type DeksElement,
  type DeksElementState,
  type DeksSlide,
  type DocumentStorage,
} from "@deks-js/document";
import { DeksCanvas } from "./DeksCanvas.js";

export interface DeksEditorProps {
  document: DeksDocument;
  onChange?: DeksEditorChangeHandler;
  assetResolver?: AssetResolver;
  storage?: DocumentStorage<DeksDocument>;
  extraControls?: ReactNode;
  onExit?: () => void;
  className?: string;
}

const id = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function DeksEditor({
  document: source,
  onChange,
  assetResolver,
  storage,
  extraControls,
  onExit,
  className = "",
}: DeksEditorProps) {
  const [document, setDocument] = useState(() => storage?.read() ?? source);
  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const sourceRef = useRef(source);
  const slide = document.slides[Math.min(index, document.slides.length - 1)]!;

  useEffect(() => {
    if (sourceRef.current === source) return;
    sourceRef.current = source;
    setDocument(source);
    setIndex((value) => Math.min(value, source.slides.length - 1));
    setSelectedId(undefined);
  }, [source]);

  const dispatch = async (operation: DeksCommand | readonly DeksCommand[]): Promise<boolean> => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    const previousDocument = document;
    const commands = Array.isArray(operation) ? operation : [operation as DeksCommand];
    const next = applyDeksCommands(previousDocument, commands).document;
    setDocument(next);
    setError(undefined);
    try {
      const accepted = await onChange?.({ kind: commandKind(operation), document: next, previousDocument, operation });
      if (accepted === false) throw new Error("change rejected");
      const confirmed = accepted && typeof accepted === "object" ? accepted.document : next;
      setDocument(confirmed);
      storage?.write(confirmed);
      return true;
    } catch {
      setDocument(previousDocument);
      setError("No se pudo guardar el cambio. Se restauró el documento.");
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const addSlide = async () => {
    const created: DeksSlide = {
      id: id("slide"), name: `Slide ${document.slides.length + 1}`, isTemplate: false,
      background: { kind: "solid", color: document.palette.background }, states: [],
    };
    const target = Math.min(index + 1, document.slides.length);
    if (await dispatch({ type: "create-slide", slide: created, afterSlideId: slide.id })) setIndex(target);
  };

  const addText = async () => {
    const element: DeksElement = { id: id("element"), kind: "text", name: "Texto", isLocked: false };
    const state: DeksElementState = {
      elementId: element.id,
      x: document.canvas.width * 0.15, y: document.canvas.height * 0.2,
      width: document.canvas.width * 0.7, height: document.canvas.height * 0.2,
      rotationDeg: 0, opacity: 1, zIndex: slide.states.length + 1,
      content: "Nuevo texto", fill: document.palette.text, fontFamily: "Poppins", fontSize: 64,
      fontWeight: 600, lineHeight: 1.1, letterSpacing: 0, horizontalAlignment: "left",
      verticalAlignment: "middle", overflowMode: "hidden",
    };
    if (await dispatch([
      { type: "define-element", element },
      { type: "add-element-state", slideId: slide.id, state },
    ])) setSelectedId(element.id);
  };

  const selected = document.elements.find(({ id }) => id === selectedId);
  return (
    <section className={`deks-editor ${className}`.trim()} aria-label={`Editor ${document.name}`} aria-busy={pending}>
      <header className="deks-editor__toolbar">
        <strong>{document.name}</strong>
        <button className="deks-control deks-control--text" type="button" disabled={pending} onClick={() => void addSlide()}>Agregar slide</button>
        <button className="deks-control deks-control--text" type="button" disabled={pending} onClick={() => void addText()}>Agregar texto</button>
        {extraControls}
        {onExit && <button className="deks-control deks-control--text" type="button" onClick={onExit}>Salir</button>}
      </header>
      <div className="deks-editor__body">
        <div className="deks-editor__stage">
          <DeksCanvas document={document} slideId={slide.id} mode="editor" assetResolver={assetResolver} onSelectElement={setSelectedId} />
        </div>
        <aside className="deks-editor__inspector" aria-label="Inspector">
          {selected ? (
            <label>
              Nombre del elemento
              <input
                value={selected.name}
                disabled={pending}
                onChange={(event) => void dispatch({
                  type: "update-element-identity",
                  elementId: selected.id,
                  patch: { name: event.target.value },
                })}
              />
            </label>
          ) : <span>Selecciona un elemento para editarlo.</span>}
        </aside>
      </div>
      <nav className="deks-controls" aria-label="Navegación de slides">
        <button className="deks-control" type="button" aria-label="Slide anterior" disabled={index === 0} onClick={() => { setIndex((value) => value - 1); setSelectedId(undefined); }}>‹</button>
        <span className="deks-controls__counter" aria-live="polite">{index + 1} / {document.slides.length}</span>
        <button className="deks-control" type="button" aria-label="Slide siguiente" disabled={index === document.slides.length - 1} onClick={() => { setIndex((value) => value + 1); setSelectedId(undefined); }}>›</button>
      </nav>
      {error && <div className="deks-editor__error" role="alert">{error}</div>}
    </section>
  );
}
