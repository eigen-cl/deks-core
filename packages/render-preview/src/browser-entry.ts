import { RendererCore } from "@deks-js/renderer-core";
import type { LayoutMeasurement, SlideSnapshot } from "@deks-js/renderer-core";
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

interface TransitionProbeInput {
  from: SlideSnapshot;
  to: SlideSnapshot;
  samples: number[];
  elementIds: string[];
}

interface TransitionStyleSample {
  time: number;
  elements: Record<string, { opacity: string; clipPath: string; text: string }>;
}

/** Internal browser-contract hook. It is bundled for QA but is not exported by the Node package. */
export async function probeTransition(input: TransitionProbeInput): Promise<TransitionStyleSample[]> {
  const host = document.createElement("main");
  Object.assign(host.style, { width: "100vw", height: "100vh", margin: "0", overflow: "hidden" });
  document.body.replaceChildren(host);
  const renderer = new RendererCore();
  renderer.mount(host);
  renderer.compileTransition(input.from, input.to);
  const samples: TransitionStyleSample[] = [];
  for (const time of input.samples) {
    renderer.seek(time);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const elements: TransitionStyleSample["elements"] = {};
    for (const id of input.elementIds) {
      const node = host.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
      const style = node ? getComputedStyle(node) : undefined;
      elements[id] = {
        opacity: style?.opacity ?? "missing",
        clipPath: style?.clipPath ?? "missing",
        text: node?.textContent ?? "missing",
      };
    }
    samples.push({ time, elements });
  }
  renderer.destroy();
  return samples;
}

interface TransitionCompletionProbe {
  progress: number;
  elementIds: string[];
  transitionLayers: number;
  cropLayers: number;
}

/** Internal real-WAAPI completion contract used to catch hung delayed playback. */
export async function completeTransition(
  input: { from: SlideSnapshot; to: SlideSnapshot; playbackRate: number },
): Promise<TransitionCompletionProbe> {
  const host = document.createElement("main");
  Object.assign(host.style, { width: "100vw", height: "100vh", margin: "0", overflow: "hidden" });
  document.body.replaceChildren(host);
  const renderer = new RendererCore();
  renderer.mount(host);
  renderer.compileTransition(input.from, input.to);
  renderer.setPlaybackRate(input.playbackRate);
  await Promise.race([
    renderer.play(),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("transition playback timed out")), 2_000)),
  ]);
  return {
    progress: renderer.getPlaybackProgress(),
    elementIds: [...host.querySelectorAll<HTMLElement>("[data-element-id]")].map((node) => node.dataset.elementId!),
    transitionLayers: host.querySelectorAll("[data-transition-layer]").length,
    cropLayers: host.querySelectorAll("[data-deks-crop]").length,
  };
}
