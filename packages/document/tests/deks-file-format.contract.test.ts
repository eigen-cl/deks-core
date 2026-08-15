import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  createDeksFile,
  downgradeDeksPresentationToDocument,
  readDeksFile,
  toDeksV1Document,
  type DeksPresentationDocument,
} from "../src";

const presentation = (): DeksPresentationDocument => ({
  format: "deks",
  version: 2,
  id: "deck-asset",
  name: "Asset demo / safe",
  revision: 0,
  canvas: { width: 1600, height: 900 },
  motionBeatMs: 600,
  palette: {
    primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
    background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
  },
  history: { canUndo: false, canRedo: false },
  assets: [{ id: "asset-1", kind: "embedded", mediaType: "image/png", originalFilename: "pixel.png" }],
  elements: [{ id: "deck-asset:image", kind: "image", name: "Image", isLocked: false }],
  slides: [{
    id: "deck-asset:slide-1",
    name: "Intro",
    isTemplate: false,
    background: { kind: "solid", color: "#0b0c0e" },
    inPreset: "fade",
    outPreset: "fade",
    inDurationMultiplier: 1,
    outDurationMultiplier: 1,
    states: [{
      elementId: "deck-asset:image",
      x: 0, y: 0, width: 100, height: 100,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      assetId: "asset-1", alt: "Pixel", fit: "contain",
    }],
  }],
  transitions: [],
});

describe("portable .deks v2 file format", () => {
  it("produces deterministic bytes and round-trips content-addressed assets", async () => {
    const input = presentation();
    const assets = [{
      id: "asset-1",
      mediaType: "image/png",
      originalFilename: "pixel.png",
      bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    }];

    const first = await createDeksFile(input, assets);
    const second = await createDeksFile(input, assets);
    expect(first.filename).toBe("Asset demo safe.deks");
    expect(first.mediaType).toBe("application/vnd.deks+zip");
    expect(first.bytes).toEqual(second.bytes);

    const decoded = await readDeksFile(first.bytes);
    expect(decoded.presentation).toEqual(input);
    expect(decoded.assets).toHaveLength(1);
    expect(decoded.assets[0]).toMatchObject({
      id: "asset-1",
      mediaType: "image/png",
      originalFilename: "pixel.png",
    });
    expect(decoded.assets[0]?.bytes).toEqual(assets[0]!.bytes);
    expect(decoded.assets[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a document that references an absent asset", async () => {
    await expect(createDeksFile(presentation(), [])).rejects.toThrow(/asset-1|absent|missing/i);
  });

  it("rejects asset bytes whose id or media type is inconsistent with the registry", async () => {
    await expect(createDeksFile(presentation(), [{
      id: "unknown",
      mediaType: "image/png",
      bytes: new Uint8Array([1]),
    }])).rejects.toThrow(/no descriptor/i);
    await expect(createDeksFile(presentation(), [{
      id: "asset-1",
      mediaType: "image/jpeg",
      bytes: new Uint8Array([1]),
    }])).rejects.toThrow(/media type/i);
  });

  it("reads compressed legacy v1 packages and upgrades them to canonical v2", async () => {
    const legacy = presentation();
    legacy.assets = [];
    legacy.elements = [];
    legacy.slides[0]!.states = [];
    const manifest = {
      format: "deks",
      version: 1,
      document: toDeksV1Document(downgradeDeksPresentationToDocument(legacy)),
      assets: [],
    };
    const archive = zipSync({ "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)) }, { level: 9 });
    const decoded = await readDeksFile(archive);
    expect(decoded.sourceVersion).toBe(1);
    expect(decoded.presentation).toMatchObject({ format: "deks", version: 2, id: "deck-asset" });
  });

  it("rejects unsafe archive paths before extraction", async () => {
    const archive = zipSync({ "../escape": new Uint8Array([1]) });
    await expect(readDeksFile(archive)).rejects.toThrow(/unsafe|unsupported/i);
  });
});
