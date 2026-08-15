import type { DeksDocument, ElementState, ShapeFill, Slide, SlideBackground, SlideTransition } from "./types.js";
import { assertDeksDocument } from "./validation.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid DEKS v1 ${field}.`);
  return value as UnknownRecord;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid DEKS v1 ${field}.`);
  return value;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid DEKS v1 ${field}.`);
  return value;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid DEKS v1 ${field}.`);
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid DEKS v1 ${field}.`);
  return value;
}

function nullableString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return string(value, field);
}

function wireBackground(value: unknown, field: string): SlideBackground {
  const source = record(value, field);
  if (source.kind === "solid") {
    return { kind: "solid", color: string(source.solid_color, `${field}.solid_color`) };
  }
  if (source.kind !== "linear-gradient") throw new Error(`Invalid DEKS v1 ${field}.kind.`);
  return {
    kind: "linear-gradient",
    startColor: string(source.gradient_start, `${field}.gradient_start`),
    endColor: string(source.gradient_end, `${field}.gradient_end`),
    angleDeg: number(source.angle_deg, `${field}.angle_deg`),
  };
}

function commonElement(source: UnknownRecord, field: string) {
  const rect = record(source.rect, `${field}.rect`);
  return {
    id: string(source.id, `${field}.id`),
    kind: string(source.kind, `${field}.kind`),
    name: string(source.name, `${field}.name`),
    x: number(rect.x, `${field}.rect.x`),
    y: number(rect.y, `${field}.rect.y`),
    width: number(rect.width, `${field}.rect.width`),
    height: number(rect.height, `${field}.rect.height`),
    rotationDeg: number(source.rotation_deg, `${field}.rotation_deg`),
    opacity: number(source.opacity, `${field}.opacity`),
    zIndex: number(source.z_index, `${field}.z_index`),
  };
}

function wireElement(value: unknown, field: string): ElementState {
  const source = record(value, field);
  const common = commonElement(source, field);
  if (source.kind === "text") {
    const text = record(source.text, `${field}.text`);
    return {
      ...common,
      kind: "text",
      content: string(text.content, `${field}.text.content`),
      fontFamily: string(text.font_family, `${field}.text.font_family`) as "Poppins" | "Roboto",
      fontSize: number(text.font_size, `${field}.text.font_size`),
      fontWeight: number(text.font_weight, `${field}.text.font_weight`),
      lineHeight: number(text.line_height, `${field}.text.line_height`),
      letterSpacing: number(text.letter_spacing, `${field}.text.letter_spacing`),
      horizontalAlignment: string(text.horizontal_alignment, `${field}.text.horizontal_alignment`) as NonNullable<ElementState["horizontalAlignment"]>,
      verticalAlignment: string(text.vertical_alignment, `${field}.text.vertical_alignment`) as NonNullable<ElementState["verticalAlignment"]>,
      overflowMode: string(text.overflow_mode, `${field}.text.overflow_mode`) as NonNullable<ElementState["overflowMode"]>,
      fill: string(text.color, `${field}.text.color`),
      ...(text.rendered_text_bounds === null || text.rendered_text_bounds === undefined ? {} : {
        renderedTextBounds: (() => {
          const bounds = record(text.rendered_text_bounds, `${field}.text.rendered_text_bounds`);
          return {
            x: number(bounds.x, `${field}.text.rendered_text_bounds.x`),
            y: number(bounds.y, `${field}.text.rendered_text_bounds.y`),
            width: number(bounds.width, `${field}.text.rendered_text_bounds.width`),
            height: number(bounds.height, `${field}.text.rendered_text_bounds.height`),
          };
        })(),
      }),
      ...(text.measurement_source === undefined || text.measurement_source === null ? {} : {
        measurementSource: string(text.measurement_source, `${field}.text.measurement_source`) as "estimated" | "dom",
      }),
    };
  }
  if (source.kind === "shape") {
    const shape = record(source.shape, `${field}.shape`);
    const fill = shape.fill === null || shape.fill === undefined
      ? nullableString(shape.fill_color, `${field}.shape.fill_color`)
      : wireBackground(shape.fill, `${field}.shape.fill`);
    return {
      ...common,
      kind: "shape",
      shapeKind: string(shape.shape_kind, `${field}.shape.shape_kind`) as NonNullable<ElementState["shapeKind"]>,
      ...(typeof fill === "string" ? { fill } : fill ? { shapeFill: fill as ShapeFill } : {}),
      ...(nullableString(shape.stroke_color, `${field}.shape.stroke_color`) === undefined ? {} : {
        stroke: string(shape.stroke_color, `${field}.shape.stroke_color`),
      }),
      strokeWidth: number(shape.stroke_width, `${field}.shape.stroke_width`),
      cornerRadius: number(shape.corner_radius, `${field}.shape.corner_radius`),
    };
  }
  if (source.kind === "image") {
    const image = record(source.image, `${field}.image`);
    return {
      ...common,
      kind: "image",
      assetId: string(image.asset_id, `${field}.image.asset_id`),
      alt: nullableString(image.alt, `${field}.image.alt`) ?? common.name,
      fit: string(image.fit, `${field}.image.fit`) as NonNullable<ElementState["fit"]>,
    };
  }
  if (source.kind === "link-button") {
    const button = record(source.button, `${field}.button`);
    return {
      ...common,
      kind: "link-button",
      label: string(button.label, `${field}.button.label`),
      url: string(button.url, `${field}.button.url`),
      fill: string(button.fill_color, `${field}.button.fill_color`),
      textColor: string(button.text_color, `${field}.button.text_color`),
      fontFamily: string(button.font_family, `${field}.button.font_family`) as "Poppins" | "Roboto",
      fontSize: number(button.font_size, `${field}.button.font_size`),
      fontWeight: number(button.font_weight, `${field}.button.font_weight`),
      cornerRadius: number(button.corner_radius, `${field}.button.corner_radius`),
      ...(nullableString(button.stroke_color, `${field}.button.stroke_color`) === undefined ? {} : {
        stroke: string(button.stroke_color, `${field}.button.stroke_color`),
      }),
      strokeWidth: number(button.stroke_width, `${field}.button.stroke_width`),
    };
  }
  if (source.kind === "icon") {
    const icon = record(source.icon, `${field}.icon`);
    return {
      ...common,
      kind: "icon",
      iconFamily: string(icon.family, `${field}.icon.family`) as "lucide",
      iconName: string(icon.name, `${field}.icon.name`),
      fill: string(icon.color, `${field}.icon.color`),
      strokeWidth: number(icon.stroke_width, `${field}.icon.stroke_width`),
    };
  }
  if (source.kind === "group") return { ...common, kind: "group" };
  throw new Error(`Invalid DEKS v1 ${field}.kind.`);
}

function wireSlide(value: unknown, index: number): Slide {
  const field = `slides[${index}]`;
  const source = record(value, field);
  const animation = record(source.animation, `${field}.animation`);
  const entrance = record(animation.in, `${field}.animation.in`);
  const exit = record(animation.out, `${field}.animation.out`);
  return {
    id: string(source.id, `${field}.id`),
    name: string(source.name, `${field}.name`),
    isTemplate: boolean(source.is_template, `${field}.is_template`),
    background: wireBackground(source.background, `${field}.background`),
    inPreset: string(entrance.preset, `${field}.animation.in.preset`) as Slide["inPreset"],
    outPreset: string(exit.preset, `${field}.animation.out.preset`) as Slide["outPreset"],
    inDurationMultiplier: number(entrance.duration_multiplier, `${field}.animation.in.duration_multiplier`) as Slide["inDurationMultiplier"],
    outDurationMultiplier: number(exit.duration_multiplier, `${field}.animation.out.duration_multiplier`) as Slide["outDurationMultiplier"],
    elements: array(source.elements, `${field}.elements`).map((element, child) => wireElement(element, `${field}.elements[${child}]`)),
  };
}

function wireTransition(value: unknown, index: number, motionBeatMs: number): SlideTransition {
  const field = `transitions[${index}]`;
  const source = record(value, field);
  const bezierValues = [source.bezier_x1, source.bezier_y1, source.bezier_x2, source.bezier_y2];
  const hasBezier = bezierValues.every((part) => typeof part === "number" && Number.isFinite(part));
  return {
    fromSlideId: string(source.from_slide_id, `${field}.from_slide_id`),
    toSlideId: string(source.to_slide_id, `${field}.to_slide_id`),
    motionBeatMs,
    durationMultiplier: number(source.duration_multiplier, `${field}.duration_multiplier`) as SlideTransition["durationMultiplier"],
    effectiveDurationMs: number(source.effective_duration_ms, `${field}.effective_duration_ms`),
    delayMs: number(source.delay_ms, `${field}.delay_ms`),
    easing: string(source.easing_kind, `${field}.easing_kind`) as SlideTransition["easing"],
    ...(hasBezier ? { bezier: bezierValues as [number, number, number, number] } : {}),
    overrides: array(source.overrides ?? [], `${field}.overrides`).map((value, child) => {
      const override = record(value, `${field}.overrides[${child}]`);
      return {
        elementId: string(override.element_id, `${field}.overrides[${child}].element_id`),
        animate: boolean(override.animate, `${field}.overrides[${child}].animate`),
        ...(override.duration_multiplier === null || override.duration_multiplier === undefined ? {} : {
          durationMultiplier: number(override.duration_multiplier, `${field}.overrides[${child}].duration_multiplier`) as SlideTransition["durationMultiplier"],
        }),
        ...(override.delay_ms === null || override.delay_ms === undefined ? {} : {
          delayMs: number(override.delay_ms, `${field}.overrides[${child}].delay_ms`),
        }),
      };
    }),
    elementMotions: array(source.element_motions ?? [], `${field}.element_motions`).map((value, child) => {
      const motion = record(value, `${field}.element_motions[${child}]`);
      return {
        elementId: string(motion.element_id, `${field}.element_motions[${child}].element_id`),
        direction: string(motion.direction, `${field}.element_motions[${child}].direction`) as "in" | "out",
        preset: string(motion.preset, `${field}.element_motions[${child}].preset`) as Slide["inPreset"],
        durationMultiplier: number(motion.duration_multiplier, `${field}.element_motions[${child}].duration_multiplier`) as SlideTransition["durationMultiplier"],
        delayMs: number(motion.delay_ms, `${field}.element_motions[${child}].delay_ms`),
      };
    }),
  };
}

/** Convert the version-1 `.deks`/API wire representation into the portable Core document. */
export function fromDeksV1Document(value: unknown): DeksDocument {
  const source = record(value, "document");
  const palette = record(source.palette, "palette");
  const history = record(source.history, "history");
  const motionBeatMs = number(source.motion_beat_ms, "motion_beat_ms");
  const document: unknown = {
    id: string(source.id, "id"),
    name: string(source.name, "name"),
    revision: number(source.revision, "revision"),
    canvasWidth: number(source.canvas_width, "canvas_width"),
    canvasHeight: number(source.canvas_height, "canvas_height"),
    motionBeatMs,
    palette: {
      primary: string(palette.primary, "palette.primary"),
      secondary: string(palette.secondary, "palette.secondary"),
      accent: string(palette.accent, "palette.accent"),
      background: string(palette.background, "palette.background"),
      text: string(palette.text, "palette.text"),
      subtext: string(palette.subtext, "palette.subtext"),
    },
    history: {
      canUndo: boolean(history.can_undo, "history.can_undo"),
      canRedo: boolean(history.can_redo, "history.can_redo"),
    },
    slides: array(source.slides, "slides").map(wireSlide),
    transitions: array(source.transitions, "transitions").map((transition, index) => wireTransition(transition, index, motionBeatMs)),
  };
  assertDeksDocument(document);
  return document;
}

function toWireBackground(value: SlideBackground): UnknownRecord {
  if (value.kind === "solid") {
    return { kind: "solid", solid_color: value.color, gradient_start: null, gradient_end: null, angle_deg: null };
  }
  return {
    kind: "linear-gradient",
    solid_color: null,
    gradient_start: value.startColor,
    gradient_end: value.endColor,
    angle_deg: value.angleDeg,
  };
}

function toWireElement(value: ElementState): UnknownRecord {
  const base: UnknownRecord = {
    id: value.id,
    kind: value.kind,
    name: value.name,
    is_locked: false,
    semantic_role: null,
    rect: { x: value.x, y: value.y, width: value.width, height: value.height },
    rotation_deg: value.rotationDeg,
    opacity: value.opacity,
    z_index: value.zIndex,
  };
  if (value.kind === "text") {
    base.text = {
      content: value.content ?? "",
      font_family: value.fontFamily ?? "Poppins",
      font_size: value.fontSize ?? 32,
      font_weight: value.fontWeight ?? 400,
      line_height: value.lineHeight ?? 1.2,
      letter_spacing: value.letterSpacing ?? 0,
      horizontal_alignment: value.horizontalAlignment ?? "left",
      vertical_alignment: value.verticalAlignment ?? "top",
      overflow_mode: value.overflowMode ?? "visible",
      color: value.fill ?? "#000000",
      rendered_text_bounds: value.renderedTextBounds === undefined ? null : { ...value.renderedTextBounds },
      measurement_source: value.measurementSource ?? null,
    };
  } else if (value.kind === "shape") {
    base.shape = {
      shape_kind: value.shapeKind ?? "rectangle",
      fill_color: value.fill ?? null,
      fill: value.shapeFill === undefined ? null : toWireBackground(value.shapeFill),
      stroke_color: value.stroke ?? null,
      stroke_width: value.strokeWidth ?? 0,
      corner_radius: value.cornerRadius ?? 0,
    };
  } else if (value.kind === "image") {
    base.image = {
      asset_id: value.assetId ?? "",
      asset_url: value.assetUrl ?? null,
      alt: value.alt ?? value.name,
      fit: value.fit ?? "contain",
    };
  } else if (value.kind === "link-button") {
    base.button = {
      label: value.label ?? "",
      url: value.url ?? "",
      fill_color: value.fill ?? "#000000",
      text_color: value.textColor ?? "#ffffff",
      font_family: value.fontFamily ?? "Poppins",
      font_size: value.fontSize ?? 32,
      font_weight: value.fontWeight ?? 600,
      corner_radius: value.cornerRadius ?? 0,
      stroke_color: value.stroke ?? null,
      stroke_width: value.strokeWidth ?? 0,
    };
  } else if (value.kind === "icon") {
    base.icon = {
      family: value.iconFamily ?? "lucide",
      name: value.iconName ?? "shield-check",
      color: value.fill ?? "#000000",
      stroke_width: value.strokeWidth ?? 2,
    };
  }
  return base;
}

/** Encode the portable Core document into the version-1 API/manifest wire representation. */
export function toDeksV1Document(document: DeksDocument): UnknownRecord {
  assertDeksDocument(document);
  return {
    id: document.id,
    name: document.name,
    revision: document.revision,
    canvas_width: document.canvasWidth,
    canvas_height: document.canvasHeight,
    motion_beat_ms: document.motionBeatMs,
    palette: { ...document.palette },
    history: { can_undo: document.history.canUndo, can_redo: document.history.canRedo },
    slides: document.slides.map((slide, position) => ({
      id: slide.id,
      position,
      name: slide.name,
      is_template: slide.isTemplate,
      background: toWireBackground(slide.background),
      animation: {
        in: {
          preset: slide.inPreset,
          duration_multiplier: slide.inDurationMultiplier,
          effective_duration_ms: document.motionBeatMs * slide.inDurationMultiplier,
        },
        out: {
          preset: slide.outPreset,
          duration_multiplier: slide.outDurationMultiplier,
          effective_duration_ms: document.motionBeatMs * slide.outDurationMultiplier,
        },
      },
      elements: slide.elements.map(toWireElement),
    })),
    transitions: document.transitions.map((transition) => ({
      from_slide_id: transition.fromSlideId,
      to_slide_id: transition.toSlideId,
      duration_multiplier: transition.durationMultiplier,
      effective_duration_ms: transition.effectiveDurationMs,
      delay_ms: transition.delayMs,
      easing_kind: transition.easing,
      bezier_x1: transition.bezier?.[0] ?? null,
      bezier_y1: transition.bezier?.[1] ?? null,
      bezier_x2: transition.bezier?.[2] ?? null,
      bezier_y2: transition.bezier?.[3] ?? null,
      overrides: (transition.overrides ?? []).map((override) => ({
        element_id: override.elementId,
        animate: override.animate,
        duration_multiplier: override.durationMultiplier ?? null,
        effective_duration_ms: override.animate === false
          ? 0
          : document.motionBeatMs * (override.durationMultiplier ?? transition.durationMultiplier),
        delay_ms: override.delayMs ?? null,
      })),
      element_motions: (transition.elementMotions ?? []).map((motion) => ({
        element_id: motion.elementId,
        direction: motion.direction,
        preset: motion.preset,
        duration_multiplier: motion.durationMultiplier,
        effective_duration_ms: document.motionBeatMs * motion.durationMultiplier,
        delay_ms: motion.delayMs,
      })),
    })),
  };
}
