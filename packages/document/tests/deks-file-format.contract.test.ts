import { describe, expect, it, vi } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  createDeksFile,
  readDeksFile,
  type DeksDocument,
} from "../src";

const document = (): DeksDocument => ({
  format: "deks",
  id: "deck-asset",
  name: "Asset demo / safe",
  revision: 0,
  canvas: { width: 1600, height: 900 },
  motionBeatMs: 600,
  motion: {
    in: { animation: { kind: "fade" }, durationBeats: 1, delayMs: 0, easing: "ease-out" },
    out: { animation: { kind: "fade" }, durationBeats: 1, delayMs: 0, easing: "ease-in" },
    morph: { animation: { kind: "morph" }, durationBeats: 1, delayMs: 0, easing: "ease-in-out" },
  },
  palette: {
    primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
    background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
  },
  history: { canUndo: false, canRedo: false },
  assets: [{ id: "asset-1", kind: "embedded", mediaType: "image/png", originalFilename: "pixel.png" }],
  elements: [{ id: "image", kind: "image", name: "Image", isLocked: false }],
  slides: [{
    id: "slide-1",
    name: "Intro",
    isTemplate: false,
    background: { kind: "solid", color: "#0b0c0e" },
    states: [{
      elementId: "image",
      x: 0, y: 0, width: 100, height: 100,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      assetId: "asset-1", alt: "Pixel", fit: "contain",
    }],
  }],
});

describe("portable .deks file format", () => {
  it("produces deterministic bytes and round-trips content-addressed assets", async () => {
    const input = document();
    const assets = [{
      id: "asset-1",
      mediaType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    }];

    const first = await createDeksFile(input, assets);
    const second = await createDeksFile(input, assets);
    expect(first.filename).toBe("Asset demo safe.deks");
    expect(first.mediaType).toBe("application/vnd.deks+zip");
    expect(first.bytes).toEqual(second.bytes);

    const decoded = await readDeksFile(first.bytes);
    expect(decoded.document).toEqual(input);
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
    await expect(createDeksFile(document(), [])).rejects.toThrow(/asset-1|absent|missing/i);
  });

  it("requires bytes for every embedded descriptor even when no slide references it", async () => {
    const input = document();
    input.slides[0]!.states = [];
    await expect(createDeksFile(input, [])).rejects.toThrow(/asset-1|missing bytes/i);
  });

  it("rejects an archive whose inventory omits an unreferenced embedded descriptor", async () => {
    const input = document();
    input.slides[0]!.states = [];
    const archive = await createDeksFile(input, [{
      id: "asset-1",
      mediaType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    }]);
    const files = unzipSync(archive.bytes);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]!));
    manifest.assets = [];
    files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
    for (const name of Object.keys(files)) {
      if (name.startsWith("assets/")) delete files[name];
    }

    await expect(readDeksFile(zipSync(files))).rejects.toThrow(/asset-1|embedded|inventory|absent/i);
  });

  it("rejects asset bytes whose id or media type is inconsistent with the registry", async () => {
    await expect(createDeksFile(document(), [{
      id: "unknown",
      mediaType: "image/png",
      bytes: new Uint8Array([1]),
    }])).rejects.toThrow(/no descriptor/i);
    await expect(createDeksFile(document(), [{
      id: "asset-1",
      mediaType: "image/jpeg",
      bytes: new Uint8Array([1]),
    }])).rejects.toThrow(/media type/i);
  });

  it("deduplicates binary objects while preserving distinct canonical asset ids", async () => {
    const input = document();
    input.assets.push({ id: "asset-2", kind: "embedded", mediaType: "image/png" });
    input.elements.push({ id: "image-2", kind: "image", name: "Second", isLocked: false });
    input.slides[0]!.states.push({
      elementId: "image-2", x: 120, y: 0, width: 100, height: 100,
      rotationDeg: 0, opacity: 1, zIndex: 2, assetId: "asset-2", alt: "Second", fit: "contain",
    });
    const body = new Uint8Array([137, 80, 78, 71]);
    const archive = await createDeksFile(input, [
      { id: "asset-1", mediaType: "image/png", bytes: body },
      { id: "asset-2", mediaType: "image/png", bytes: body },
    ]);
    const files = unzipSync(archive.bytes);
    expect(Object.keys(files).filter((name) => name.startsWith("assets/"))).toHaveLength(1);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]!)) as { assets: Array<{ originalFilename: string | null }> };
    expect(manifest.assets).toHaveLength(2);
    expect(manifest.assets[1]!.originalFilename).toBeNull();
    expect((await readDeksFile(archive.bytes)).assets).toHaveLength(2);
  });

  it("rejects archive metadata that diverges from the canonical descriptor", async () => {
    const archive = await createDeksFile(document(), [{
      id: "asset-1", mediaType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]),
    }]);
    const files = unzipSync(archive.bytes);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]!));
    manifest.assets[0].originalFilename = "tampered.png";
    files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
    await expect(readDeksFile(zipSync(files))).rejects.toThrow(/original filename|descriptor/i);
  });

  it("rejects duplicate object keys in the archive manifest", async () => {
    const archive = await createDeksFile(document(), [{
      id: "asset-1", mediaType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]),
    }]);
    const files = unzipSync(archive.bytes);
    const manifest = new TextDecoder().decode(files["manifest.json"]!);
    files["manifest.json"] = new TextEncoder().encode(
      manifest.replace('{"format":"deks"', '{"format":"deks","format":"deks"'),
    );

    await expect(readDeksFile(zipSync(files))).rejects.toThrow(/duplicate object key|manifest JSON/i);
  });

  it("rejects excessive manifest nodes before invoking JSON.parse", async () => {
    const entries = new Array(200_000).fill("{}").join(",");
    const manifest = new TextEncoder().encode(
      `{"format":"deks","document":{},"assets":[${entries}]}`,
    );
    const archive = zipSync({ "manifest.json": manifest }, { level: 0 });
    const parse = vi.spyOn(JSON, "parse");
    try {
      await expect(readDeksFile(archive)).rejects.toThrow(/manifest JSON.*nodes|complex/i);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("enforces the standalone document JSON byte limit inside archives", async () => {
    const input = document();
    input.assets = [];
    input.elements = [];
    input.slides[0]!.states = [];
    for (let index = 0; index < 55; index += 1) {
      const elementId = `text-${index}`;
      input.elements.push({ id: elementId, kind: "text", name: elementId, isLocked: false });
      input.slides[0]!.states.push({
        elementId, x: 0, y: 0, width: 100, height: 100, rotationDeg: 0, opacity: 1, zIndex: index,
        content: "a".repeat(100_000), fontFamily: "Poppins", fontSize: 32, fontWeight: 400,
        lineHeight: 1.2, letterSpacing: 0, horizontalAlignment: "left", verticalAlignment: "top",
        overflowMode: "hidden", fill: "#ffffff",
      });
    }
    await expect(createDeksFile(input)).rejects.toThrow(/document JSON is too large/i);
  });

  it("rejects unsafe archive paths before extraction", async () => {
    const archive = zipSync({ "../escape": new Uint8Array([1]) });
    await expect(readDeksFile(archive)).rejects.toThrow(/unsafe|unsupported/i);
  });
});
