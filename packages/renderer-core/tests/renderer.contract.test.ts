import { describe, expect, it, vi } from "vitest";
import { RendererCore, toSlideSnapshot } from "../src";
import type { DeksDocument, Slide } from "@deks-js/document";

const slide: Slide = {
  id: "slide",
  name: "Intro",
  isTemplate: false,
  background: { kind: "solid", color: "#0b0c0e" },
  inPreset: "fade",
  outPreset: "fade",
  inDurationMultiplier: 1,
  outDurationMultiplier: 1,
  elements: [
    {
      id: "cta",
      kind: "link-button",
      name: "CTA",
      x: 20,
      y: 30,
      width: 300,
      height: 90,
      rotationDeg: 0,
      opacity: 1,
      zIndex: 1,
      label: "Entrar",
      url: "https://app.deks.eigen.cl/",
      fill: "#ff7043",
      textColor: "#0b0c0e",
    },
  ],
};

describe("imperative renderer contract", () => {
  it("renders absolute semantic elements and delegates links only in presentation mode", () => {
    const host = document.createElement("div");
    const open = vi.fn();
    const renderer = new RendererCore({ onOpenExternal: open });
    renderer.mount(host);
    renderer.renderSlide(toSlideSnapshot(slide, { width: 1920, height: 1080 }));

    const link = host.querySelector<HTMLButtonElement>("[data-element-id=cta]")!;
    expect(link).toHaveTextContent("Entrar");
    expect(link.style.position).toBe("absolute");
    link.click();
    expect(open).not.toHaveBeenCalled();

    renderer.setViewportMode("presentation");
    link.click();
    expect(open).toHaveBeenCalledWith("https://app.deks.eigen.cl/");
  });

  it("resolves assets through the host instead of fetching", () => {
    const host = document.createElement("div");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const renderer = new RendererCore({ assetResolver: ({ assetId }) => assetId === "hero" ? "blob:hero" : undefined });
    renderer.mount(host);
    renderer.renderSlide(toSlideSnapshot({ ...slide, elements: [{
      id: "image", kind: "image", name: "Hero", x: 0, y: 0, width: 100, height: 100,
      rotationDeg: 0, opacity: 1, zIndex: 1, assetId: "hero", alt: "Hero", fit: "cover",
    }] }, { width: 1920, height: 1080 }));
    expect(host.querySelector("img")).toHaveAttribute("src", "blob:hero");
    expect(fetch).not.toHaveBeenCalled();
  });
});
