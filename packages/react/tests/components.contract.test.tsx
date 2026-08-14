import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DeksDocument } from "@deks-js/document";
import { DeksEditor, DeksPresenter, type DeksPresenterHandle } from "../src";

const deck = (): DeksDocument => ({
  id: "demo", name: "Demo", revision: 0, canvasWidth: 1920, canvasHeight: 1080, motionBeatMs: 600,
  palette: { primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff", background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6" },
  history: { canUndo: false, canRedo: false },
  slides: [
    { id: "one", name: "Uno", isTemplate: false, background: { kind: "solid", color: "#0b0c0e" }, inPreset: "fade", outPreset: "fade", inDurationMultiplier: 1, outDurationMultiplier: 1, elements: [] },
    { id: "two", name: "Dos", isTemplate: false, background: { kind: "solid", color: "#ff7043" }, inPreset: "fade", outPreset: "fade", inDurationMultiplier: 1, outDurationMultiplier: 1, elements: [] },
  ],
  transitions: [{ fromSlideId: "one", toSlideId: "two", motionBeatMs: 600, durationMultiplier: 1, effectiveDurationMs: 600, delayMs: 0, easing: "ease-in-out" }],
});

describe("DeksPresenter", () => {
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
    linked.slides[0]!.elements.push({
      id: "cta", kind: "link-button", name: "CTA", x: 0, y: 0, width: 320, height: 80,
      rotationDeg: 0, opacity: 1, zIndex: 1, label: "Portal", url: "https://app.deks.eigen.cl/", fill: "#ff7043", textColor: "#0b0c0e",
    });
    render(<DeksPresenter document={linked} onOpenExternal={open} />);
    await user.click(screen.getByRole("button", { name: "Portal" }));
    expect(open).toHaveBeenCalledWith("https://app.deks.eigen.cl/");
  });
});

describe("DeksEditor", () => {
  it("runs pure typed operations optimistically and reports the semantic change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DeksEditor document={deck()} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Agregar slide" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      kind: "slides",
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
