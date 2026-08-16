import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DeksDocument } from "@deks-js/document";
import { RendererCore } from "@deks-js/renderer-core";
import { DeksEditor, DeksPresenter, type DeksPresenterHandle } from "../src";

const deck = (): DeksDocument => ({
  format: "deks", id: "demo", name: "Demo", revision: 0, canvas: { width: 1920, height: 1080 }, motionBeatMs: 600,
  palette: { primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff", background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6" },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [],
  slides: [
    { id: "one", name: "Uno", isTemplate: false, background: { kind: "solid", color: "#0b0c0e" }, inPreset: "fade", outPreset: "fade", inDurationMultiplier: 1, outDurationMultiplier: 1, states: [] },
    { id: "two", name: "Dos", isTemplate: false, background: { kind: "solid", color: "#ff7043" }, inPreset: "fade", outPreset: "fade", inDurationMultiplier: 1, outDurationMultiplier: 1, states: [] },
  ],
  transitions: [{ fromSlideId: "one", toSlideId: "two", motionBeatMs: 600, durationMultiplier: 1, effectiveDurationMs: 600, delayMs: 0, easing: "ease-in-out" }],
});

describe("DeksPresenter", () => {
  it("presents a document handed as `presentation` and reports every slide change", async () => {
    const user = userEvent.setup();
    const onSlideChange = vi.fn();
    render(<DeksPresenter presentation={deck()} onSlideChange={onSlideChange} />);

    await user.click(screen.getByRole("button", { name: "Slide siguiente" }));

    expect(onSlideChange).toHaveBeenCalledWith("two", 1);
  });

  it("hides its own chrome when the host drives navigation", () => {
    render(<DeksPresenter presentation={deck()} showControls={false} />);

    expect(screen.queryByRole("navigation", { name: "Controles de presentación" })).toBeNull();
  });

  it("keeps fullscreen declarative and reversible", async () => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    const requestFullscreen = vi.fn(function (this: HTMLElement) {
      fullscreenElement = this;
      return Promise.resolve();
    });
    const exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      return Promise.resolve();
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });

    const { rerender } = render(<DeksPresenter presentation={deck()} fullScreen={false} />);
    expect(requestFullscreen).not.toHaveBeenCalled();

    rerender(<DeksPresenter presentation={deck()} fullScreen />);
    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledOnce());

    rerender(<DeksPresenter presentation={deck()} fullScreen={false} />);
    await waitFor(() => expect(exitFullscreen).toHaveBeenCalledOnce());
  });

  it("provides 44px accessible previous/next controls and responsive variants", async () => {
    const user = userEvent.setup();
    const { container } = render(<DeksPresenter document={deck()} variant="embedded" />);
    const previous = screen.getByRole("button", { name: "Slide anterior" });
    const next = screen.getByRole("button", { name: "Slide siguiente" });
    expect(previous).toBeDisabled();
    expect(previous).toHaveClass("deks-control");
    expect(container.querySelector(".deks-presenter")).toHaveClass("deks-presenter--embedded");
    await user.click(next);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    await user.click(previous);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("does not request native fullscreen on mount and exposes it as an explicit handle action", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    const ref = createRef<DeksPresenterHandle>();
    render(<DeksPresenter ref={ref} document={deck()} variant="immersive" />);
    expect(requestFullscreen).not.toHaveBeenCalled();
    await ref.current?.requestFullscreen();
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("delegates only HTTPS external actions to the host", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const linked = deck();
    linked.elements.push({ id: "cta", kind: "link-button", name: "CTA", isLocked: false });
    linked.slides[0]!.states.push({
      elementId: "cta", x: 0, y: 0, width: 320, height: 80, rotationDeg: 0, opacity: 1, zIndex: 1,
      label: "Portal", url: "https://app.deks.eigen.cl/", fill: "#ff7043", textColor: "#0b0c0e",
      fontFamily: "Poppins", fontSize: 28, fontWeight: 600, cornerRadius: 12, stroke: "#ff7043", strokeWidth: 0,
    });
    render(<DeksPresenter document={linked} onOpenExternal={open} />);
    await user.click(screen.getByRole("button", { name: "Portal" }));
    expect(open).toHaveBeenCalledWith("https://app.deks.eigen.cl/");
  });

  it("does not render the destination a second time after transition playback commits it", async () => {
    const user = userEvent.setup();
    const renderSlide = vi.spyOn(RendererCore.prototype, "renderSlide");
    render(<DeksPresenter document={deck()} />);
    expect(renderSlide).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Slide siguiente" }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    expect(renderSlide).toHaveBeenCalledTimes(1);
  });
});

describe("DeksEditor", () => {
  it("runs pure typed operations optimistically and reports the semantic change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DeksEditor document={deck()} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Agregar slide" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      kind: "create-slide",
      operation: expect.objectContaining({ type: "create-slide" }),
      previousDocument: expect.objectContaining({ revision: 0 }),
      document: expect.objectContaining({ revision: 1 }),
    }));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("rolls back when the host rejects persistence and never fetches", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<DeksEditor document={deck()} onChange={() => false} />);
    await user.click(screen.getByRole("button", { name: "Agregar slide" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/restauró/i);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
