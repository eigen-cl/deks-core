import { useEffect, useRef } from "react";
import { RendererCore, toSlideSnapshot } from "@deks-js/renderer-core";
import type { AssetResolver, Slide, SlideTransition } from "@deks-js/document";

export interface DeksCanvasHandle {
  play(from: Slide, to: Slide, transition: SlideTransition): Promise<void>;
}

export interface DeksCanvasProps {
  slide: Slide;
  canvas: { width: number; height: number };
  mode: "editor" | "presentation";
  assetResolver?: AssetResolver | undefined;
  onOpenExternal?: ((url: string) => void | Promise<void>) | undefined;
  onSelectElement?: ((elementId: string) => void) | undefined;
  rendererRef?: React.MutableRefObject<DeksCanvasHandle | null> | undefined;
}

export function DeksCanvas({
  slide,
  canvas,
  mode,
  assetResolver,
  onOpenExternal,
  onSelectElement,
  rendererRef,
}: DeksCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<RendererCore>();
  const renderGeneration = useRef(0);
  const rendered = useRef<{
    slide: Slide;
    assetResolver: AssetResolver | undefined;
    canvasWidth: number;
    canvasHeight: number;
  }>();
  const latest = useRef({ assetResolver, onOpenExternal, onSelectElement });
  latest.current = { assetResolver, onOpenExternal, onSelectElement };

  useEffect(() => {
    if (!host.current) return;
    const instance = new RendererCore({
      assetResolver: (reference) => latest.current.assetResolver?.(reference) ?? reference.assetUrl,
      onOpenExternal: (url) => latest.current.onOpenExternal?.(url),
      onSelectElement: (id) => latest.current.onSelectElement?.(id),
    });
    instance.mount(host.current);
    renderer.current = instance;
    rendered.current = undefined;
    if (rendererRef) rendererRef.current = {
      play: async (from, to, transition) => {
        const generation = renderGeneration.current;
        instance.compileTransition(
          toSlideSnapshot(from, canvas, latest.current.assetResolver),
          toSlideSnapshot(to, canvas, latest.current.assetResolver),
          transition,
        );
        await instance.play();
        if (renderer.current === instance && renderGeneration.current === generation) {
          rendered.current = {
            slide: to,
            assetResolver: latest.current.assetResolver,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
          };
        }
      },
    };
    return () => {
      instance.destroy();
      renderer.current = undefined;
      rendered.current = undefined;
      if (rendererRef) rendererRef.current = null;
    };
  }, [canvas.height, canvas.width, rendererRef]);

  useEffect(() => {
    renderer.current?.setViewportMode(mode);
  }, [mode]);

  useEffect(() => {
    const current = rendered.current;
    if (current?.slide === slide
      && current.assetResolver === assetResolver
      && current.canvasWidth === canvas.width
      && current.canvasHeight === canvas.height) return;
    renderGeneration.current += 1;
    renderer.current?.renderSlide(toSlideSnapshot(slide, canvas, assetResolver));
    rendered.current = { slide, assetResolver, canvasWidth: canvas.width, canvasHeight: canvas.height };
  }, [assetResolver, canvas.height, canvas.width, slide]);

  return <div className="deks-canvas" ref={host} />;
}
