import { RendererCore } from "@deks-js/renderer-core";
import type { LayoutMeasurement } from "@deks-js/renderer-core";
import type { DeksDocument } from "@deks-js/document";

interface BrowserPreviewInput {
  document: DeksDocument;
  slideId: string;
  assets: Record<string, { mediaType: string; base64: string }>;
}

export async function mount(input: BrowserPreviewInput): Promise<LayoutMeasurement[]> {
  const slide = input.document.slides.find(({ id }) => id === input.slideId);
  if (!slide) throw new Error("Preview slide not found.");
  const host = document.createElement("main");
  host.dataset.deksPreviewHost = "";
  Object.assign(host.style, {
    width: "100vw",
    height: "100vh",
    margin: "0",
    overflow: "hidden",
  });
  document.body.replaceChildren(host);
  const renderer = new RendererCore({
    assetResolver: ({ assetId }) => {
      const asset = input.assets[assetId];
      return asset ? `data:${asset.mediaType};base64,${asset.base64}` : undefined;
    },
  });
  renderer.mount(host);
  renderer.renderSlide(input.document, slide.id);
  await document.fonts.ready;
  await Promise.all(Array.from(document.images, async (image) => {
    if (!image.src) return;
    await image.decode();
  }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return renderer.measureLayout();
}
