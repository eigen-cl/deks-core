import { useEffect, useRef } from "react";
import { RendererCore } from "@deks-js/renderer-core";
import type { AssetResolver, DeksDocument } from "@deks-js/document";

export interface DeksCanvasHandle {
  play(fromSlideId: string, toSlideId: string): Promise<void>;
}

export interface DeksCanvasProps {
  document: DeksDocument;
  slideId: string;
  mode: "editor" | "presentation";
  assetResolver?: AssetResolver | undefined;
  onOpenExternal?: ((url: string) => void | Promise<void>) | undefined;
  onSelectElement?: ((elementId: string) => void) | undefined;
  rendererRef?: React.MutableRefObject<DeksCanvasHandle | null> | undefined;
}

export function DeksCanvas({
  document,
  slideId,
  mode,
  assetResolver,
  onOpenExternal,
  onSelectElement,
  rendererRef,
}: DeksCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<RendererCore>();
  const rendered = useRef<{ document: DeksDocument; slideId: string; assetResolver: AssetResolver | undefined }>();
  const latest = useRef({ document, assetResolver, onOpenExternal, onSelectElement });
  latest.current = { document, assetResolver, onOpenExternal, onSelectElement };

  useEffect(() => {
    if (!host.current) return;
    const instance = new RendererCore({
      assetResolver: (reference) => latest.current.assetResolver?.(reference),
      onOpenExternal: (url) => latest.current.onOpenExternal?.(url),
      onSelectElement: (id) => latest.current.onSelectElement?.(id),
    });
    instance.mount(host.current);
    renderer.current = instance;
    if (rendererRef) rendererRef.current = {
      play: async (fromSlideId, toSlideId) => {
        instance.compileTransition(latest.current.document, fromSlideId, toSlideId);
        await instance.play();
        rendered.current = {
          document: latest.current.document,
          slideId: toSlideId,
          assetResolver: latest.current.assetResolver,
        };
      },
    };
    return () => {
      instance.destroy();
      renderer.current = undefined;
      rendered.current = undefined;
      if (rendererRef) rendererRef.current = null;
    };
  }, [rendererRef]);

  useEffect(() => { renderer.current?.setViewportMode(mode); }, [mode]);
  useEffect(() => {
    const current = rendered.current;
    if (current?.document === document && current.slideId === slideId && current.assetResolver === assetResolver) return;
    renderer.current?.renderSlide(document, slideId);
    rendered.current = { document, slideId, assetResolver };
  }, [assetResolver, document, slideId]);

  return <div className="deks-canvas" ref={host} />;
}
