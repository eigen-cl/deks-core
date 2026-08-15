import { describe, expect, it } from "vitest";
import { fromDeksV1Document, toDeksV1Document } from "../src";

const apiDocument = {
  id: "deck-1",
  name: "Governance",
  canvas_width: 1920,
  canvas_height: 1080,
  motion_beat_ms: 600,
  revision: 7,
  palette: {
    primary: "#ff7043",
    secondary: "#2dd4bf",
    accent: "#60a5fa",
    background: "#090d16",
    text: "#f4f7fb",
    subtext: "#94a0b4",
  },
  history: { can_undo: true, can_redo: false },
  slides: [
    {
      id: "slide-1",
      position: 0,
      name: "Trust boundary",
      is_template: false,
      background: {
        kind: "linear-gradient",
        solid_color: null,
        gradient_start: "#090d16",
        gradient_end: "#18243c",
        angle_deg: 90,
      },
      animation: {
        in: { preset: "fade", duration_multiplier: 1, effective_duration_ms: 600 },
        out: { preset: "glide-left", duration_multiplier: 1.5, effective_duration_ms: 900 },
      },
      elements: [
        {
          id: "text-1",
          state_id: "state-text-1",
          kind: "text",
          name: "Headline",
          is_locked: false,
          semantic_role: "title",
          rect: { x: 120, y: 90, width: 900, height: 140 },
          rotation_deg: 0,
          opacity: 1,
          z_index: 2,
          text: {
            content: "Where does the data travel?",
            font_family: "Poppins",
            font_size: 72,
            font_weight: 700,
            line_height: 1.1,
            letter_spacing: -1,
            horizontal_alignment: "left",
            vertical_alignment: "top",
            overflow_mode: "hidden",
            color: "#f4f7fb",
            rendered_text_bounds: { x: 120, y: 90, width: 850, height: 80 },
            measurement_source: "estimated",
          },
        },
        {
          id: "image-1",
          state_id: "state-image-1",
          kind: "image",
          name: "Architecture",
          is_locked: false,
          semantic_role: null,
          rect: { x: 120, y: 280, width: 640, height: 480 },
          rotation_deg: 0,
          opacity: 0.9,
          z_index: 1,
          image: { asset_id: "asset-1", asset_url: "/ignored-private-url", fit: "contain" },
        },
        {
          id: "shape-1",
          state_id: "state-shape-1",
          kind: "shape",
          name: "Boundary",
          is_locked: false,
          semantic_role: null,
          rect: { x: 800, y: 280, width: 600, height: 480 },
          rotation_deg: 0,
          opacity: 1,
          z_index: 0,
          shape: {
            shape_kind: "rectangle",
            fill_color: null,
            fill: {
              kind: "linear-gradient",
              solid_color: null,
              gradient_start: "#ff7043",
              gradient_end: "#60a5fa",
              angle_deg: 45,
            },
            stroke_color: "#ffffff",
            stroke_width: 2,
            corner_radius: 24,
          },
        },
        {
          id: "button-1",
          state_id: "state-button-1",
          kind: "link-button",
          name: "Official plugin",
          is_locked: false,
          semantic_role: null,
          rect: { x: 120, y: 820, width: 560, height: 96 },
          rotation_deg: 0,
          opacity: 1,
          z_index: 3,
          button: {
            label: "Use the company plugin",
            url: "https://deks.eigen.cl/",
            fill_color: "#ff7043",
            text_color: "#090d16",
            font_family: "Roboto",
            font_size: 30,
            font_weight: 700,
            corner_radius: 18,
            stroke_color: "#ffffff",
            stroke_width: 1,
          },
        },
        {
          id: "icon-1",
          state_id: "state-icon-1",
          kind: "icon",
          name: "Governance",
          is_locked: false,
          semantic_role: "governance",
          rect: { x: 720, y: 820, width: 96, height: 96 },
          rotation_deg: 0,
          opacity: 1,
          z_index: 4,
          icon: { family: "lucide", name: "shield-check", color: "#5EEAD4", stroke_width: 2 },
        },
      ],
    },
  ],
  transitions: [],
};

describe("DEKS v1 wire document adapter", () => {
  it("maps the relational API/manifest representation to the canonical portable document", () => {
    const document = fromDeksV1Document(apiDocument);

    expect(document).toMatchObject({
      id: "deck-1",
      name: "Governance",
      canvasWidth: 1920,
      canvasHeight: 1080,
      motionBeatMs: 600,
      revision: 7,
      history: { canUndo: true, canRedo: false },
    });
    expect(document.slides[0]).toMatchObject({
      id: "slide-1",
      background: {
        kind: "linear-gradient",
        startColor: "#090d16",
        endColor: "#18243c",
        angleDeg: 90,
      },
      inPreset: "fade",
      outPreset: "glide-left",
      inDurationMultiplier: 1,
      outDurationMultiplier: 1.5,
    });
    expect(document.slides[0]?.elements).toEqual([
      expect.objectContaining({
        id: "text-1", kind: "text", x: 120, content: "Where does the data travel?",
        fontFamily: "Poppins", fill: "#f4f7fb", measurementSource: "estimated",
      }),
      expect.objectContaining({
        id: "image-1", kind: "image", assetId: "asset-1", fit: "contain",
      }),
      expect.objectContaining({
        id: "shape-1", kind: "shape", shapeKind: "rectangle",
        shapeFill: { kind: "linear-gradient", startColor: "#ff7043", endColor: "#60a5fa", angleDeg: 45 },
      }),
      expect.objectContaining({
        id: "button-1", kind: "link-button", label: "Use the company plugin",
        fill: "#ff7043", textColor: "#090d16",
      }),
      expect.objectContaining({
        id: "icon-1", kind: "icon", iconFamily: "lucide", iconName: "shield-check",
        fill: "#5EEAD4", strokeWidth: 2,
      }),
    ]);
    expect(document.slides[0]?.elements[1]).not.toHaveProperty("assetUrl");
  });

  it("fails closed on malformed backgrounds instead of inventing a rendering", () => {
    expect(() => fromDeksV1Document({
      ...apiDocument,
      slides: [{ ...apiDocument.slides[0], background: { kind: "linear-gradient" } }],
    })).toThrow(/background/i);
  });

  it("encodes the portable document back to the v1 snake_case wire contract", () => {
    const portable = fromDeksV1Document(apiDocument);
    const wire = toDeksV1Document(portable) as typeof apiDocument;

    expect(wire).toMatchObject({
      id: "deck-1",
      canvas_width: 1920,
      canvas_height: 1080,
      motion_beat_ms: 600,
      history: { can_undo: true, can_redo: false },
    });
    expect(wire.slides[0]).toMatchObject({
      id: "slide-1",
      is_template: false,
    });
    expect(wire.slides[0].elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "text-1", kind: "text", text: expect.objectContaining({ font_family: "Poppins" }) }),
      expect.objectContaining({ id: "image-1", kind: "image", image: expect.objectContaining({ asset_id: "asset-1" }) }),
    ]));
    expect(fromDeksV1Document(wire)).toEqual(portable);
  });
});
