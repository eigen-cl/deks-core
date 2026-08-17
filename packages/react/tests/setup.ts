import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

/**
 * jsdom no implementa Web Animations, y el renderer avanza cada frame con ella.
 * El doble expone sólo lo que el renderer usa —play, pause, cancel, el reloj y
 * la promesa de término— y resuelve de inmediato: los tests de componente
 * comprueban qué se dibuja y qué se informa, no la interpolación, que ya está
 * cubierta por los contratos del renderer.
 */
if (typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = function animate(): Animation {
    let onfinish: ((this: Animation, event: AnimationPlaybackEvent) => unknown) | null = null;
    const animation = {
      currentTime: 0,
      playbackRate: 1,
      finished: Promise.resolve(undefined as unknown as Animation),
      play() { queueMicrotask(() => onfinish?.call(animation, {} as AnimationPlaybackEvent)); },
      pause() {},
      cancel() {},
      finish() {},
      commitStyles() {},
      persist() {},
      get onfinish() { return onfinish; },
      set onfinish(handler) { onfinish = handler; },
    } as unknown as Animation;
    queueMicrotask(() => onfinish?.call(animation, {} as AnimationPlaybackEvent));
    return animation;
  } as Element["animate"];
}
