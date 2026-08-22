import type { Easing, MotionSpec, PresenceAnimation, SlideBackground } from "@deks-js/document";
import type { ElementSnapshot, SlideSnapshot } from "./types.js";
import { lucidePaths } from "./icons.js";

const PRESET_EASINGS = new Set(["linear", "ease-in", "ease-out", "ease-in-out"]);
const CUBIC_BEZIER = /^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/;
const PRESENCE_KINDS = new Set(["none", "fade", "slide", "scale", "crop", "wipe"]);
const MOTION_EDGES = new Set(["left", "right", "top", "bottom"]);

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

export function validateEasing(easing: Easing | string): boolean {
  if (typeof easing !== "string") {
    return easing.length === 4
      && easing.every(Number.isFinite)
      && easing[0] >= 0 && easing[0] <= 1
      && easing[2] >= 0 && easing[2] <= 1;
  }
  if (PRESET_EASINGS.has(easing)) return true;
  const match = CUBIC_BEZIER.exec(easing);
  if (!match) return false;
  const values = match.slice(1).map(Number);
  return values.every(Number.isFinite)
    && values[0]! >= 0 && values[0]! <= 1
    && values[2]! >= 0 && values[2]! <= 1;
}

function validatePresence(animation: PresenceAnimation, label: string): void {
  if (!PRESENCE_KINDS.has(animation.kind)) throw new Error(`${label}.kind is invalid`);
  if (animation.kind === "slide") {
    if (!MOTION_EDGES.has(animation.edge)) throw new Error(`${label}.edge is invalid`);
    if (animation.distance !== undefined) {
      assertFinite(animation.distance, `${label}.distance`);
      if (animation.distance <= 0) throw new Error(`${label}.distance must be positive`);
    }
  }
  if (animation.kind === "crop" || animation.kind === "wipe") {
    if (!MOTION_EDGES.has(animation.edge)) throw new Error(`${label}.edge is invalid`);
  }
  if (animation.kind === "scale") {
    assertFinite(animation.from, `${label}.from`);
    if (animation.from <= 0) throw new Error(`${label}.from must be positive`);
  }
}

function validateMotion(motion: MotionSpec, label: string): void {
  for (const role of ["in", "out", "morph"] as const) {
    const entry = motion[role];
    if (!entry) throw new Error(`${label}.${role} is required`);
    assertFinite(entry.durationBeats, `${label}.${role}.durationBeats`);
    assertFinite(entry.delayBeats, `${label}.${role}.delayBeats`);
    assertFinite(entry.delayMs, `${label}.${role}.delayMs`);
    if (entry.durationBeats < 0 || entry.durationBeats > 8) {
      throw new Error(`${label}.${role}.durationBeats is outside universal bounds`);
    }
    if (entry.delayBeats < 0 || entry.delayMs < 0) {
      throw new Error(`${label}.${role} delay must not be negative`);
    }
    if (!validateEasing(entry.easing)) throw new Error(`${label}.${role}.easing is invalid`);
    if (role === "morph") {
      if (entry.animation.kind !== "morph" && entry.animation.kind !== "cut") {
        throw new Error(`${label}.${role}.animation.kind is invalid`);
      }
    } else {
      validatePresence(entry.animation as PresenceAnimation, `${label}.${role}.animation`);
    }
  }
}

function validateBackground(background: SlideBackground, label: string): void {
  if (background.kind === "solid") {
    if (typeof background.color !== "string") throw new Error(`${label}.color is invalid`);
    return;
  }
  assertFinite(background.angleDeg, `${label}.angleDeg`);
  if (typeof background.startColor !== "string" || typeof background.endColor !== "string") {
    throw new Error(`${label} colors are invalid`);
  }
}

function validateElement(element: ElementSnapshot): void {
  if (!element.id || !element.name) throw new Error("element id and name are required");
  for (const [label, value] of Object.entries({
    x: element.rect.x,
    y: element.rect.y,
    width: element.rect.width,
    height: element.rect.height,
    rotationDeg: element.rotationDeg,
    opacity: element.opacity,
    zIndex: element.zIndex,
  })) assertFinite(value, `${element.id}.${label}`);
  if (element.rect.width <= 0 || element.rect.height <= 0) {
    throw new Error(`${element.id} width and height must be positive`);
  }
  if (element.opacity < 0 || element.opacity > 1) {
    throw new Error(`${element.id} opacity must be between 0 and 1`);
  }
  validateMotion(element.motion, `${element.id}.motion`);

  if (element.kind === "shape") {
    if (element.fillStyle) validateBackground(element.fillStyle, `${element.id}.fillStyle`);
    for (const value of element.cornerRadii ? Object.values(element.cornerRadii) : []) {
      assertFinite(value, `${element.id}.cornerRadii`);
      if (value < 0) throw new Error(`${element.id}.cornerRadii is invalid`);
    }
  }
  if (element.kind === "text" || element.kind === "number") {
    for (const [label, value] of Object.entries({
      fontSize: element.fontSize,
      fontWeight: element.fontWeight,
      lineHeight: element.lineHeight,
      letterSpacing: element.letterSpacing,
    })) assertFinite(value, `${element.id}.${label}`);
  }
  if (element.kind === "number") {
    assertFinite(element.value, `${element.id}.value`);
    assertFinite(element.decimals, `${element.id}.decimals`);
  }
  if (element.kind === "link-button") {
    let url: URL;
    try { url = new URL(element.url); } catch { throw new Error(`${element.id}.url must be an absolute https URL`); }
    if (url.protocol !== "https:" || url.username || url.password || element.url.length > 2048) {
      throw new Error(`${element.id}.url must be an absolute https URL`);
    }
  }
  if (element.kind === "icon") {
    if (element.family !== "lucide") throw new Error(`${element.id}.family is not registered`);
    lucidePaths(element.iconName);
    if (!/^#[0-9A-Fa-f]{6}$/.test(element.color)) throw new Error(`${element.id}.color is invalid`);
    assertFinite(element.strokeWidth, `${element.id}.strokeWidth`);
    if (element.strokeWidth < 0.5 || element.strokeWidth > 8) throw new Error(`${element.id}.strokeWidth is invalid`);
  }
}

export function validateSnapshot(snapshot: SlideSnapshot): void {
  if (!snapshot || typeof snapshot !== "object") throw new Error("snapshot is required");
  if (!snapshot.id) throw new Error("snapshot.id is required");
  assertFinite(snapshot.canvas.width, "canvas.width");
  assertFinite(snapshot.canvas.height, "canvas.height");
  if (snapshot.canvas.width <= 0 || snapshot.canvas.height <= 0) {
    throw new Error("canvas.width and canvas.height must be positive");
  }
  assertFinite(snapshot.motionBeatMs, "motionBeatMs");
  if (snapshot.motionBeatMs <= 0) throw new Error("motionBeatMs must be positive");
  validateBackground(snapshot.background, "background");
  validateMotion(snapshot.motion, "motion");
  const ids = new Set<string>();
  for (const element of snapshot.elements) {
    if (ids.has(element.id)) throw new Error(`duplicate element id: ${element.id}`);
    ids.add(element.id);
    validateElement(element);
  }
}
