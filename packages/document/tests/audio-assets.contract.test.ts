import { describe, expect, it } from "vitest";
import {
  createDeksFile,
  inspectAndNormalizeDeksAsset,
  inspectAndNormalizeDeksAudio,
  inspectDeksAudio,
  readDeksFile,
  normalizeDeksFileAssets,
  sniffDeksAudioMediaType,
  type DeksDocument,
} from "../src";

function wav({
  sampleRate = 24_000,
  channels = 1,
  bitsPerSample = 16,
  samples = 240,
}: {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  samples?: number;
} = {}): Uint8Array {
  const blockAlign = channels * bitsPerSample / 8;
  const dataBytes = samples * blockAlign;
  const padding = dataBytes % 2;
  const result = new Uint8Array(44 + dataBytes + padding);
  const view = new DataView(result.buffer);
  result.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, result.byteLength - 8, true);
  result.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  result.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, dataBytes, true);
  return result;
}

function mp3(frames = 3): Uint8Array {
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo: 417-byte frames.
  const frameLength = Math.floor(144 * 128_000 / 44_100);
  const result = new Uint8Array(frameLength * frames);
  for (let offset = 0; offset < result.byteLength; offset += frameLength) {
    result.set([0xff, 0xfb, 0x90, 0x00], offset);
  }
  return result;
}

function document(mediaType: "audio/wav" | "audio/mpeg"): DeksDocument {
  return {
    format: "deks",
    codecVersion: 3,
    id: "audio-deck",
    name: "Audio deck",
    revision: 0,
    canvas: { width: 1600, height: 900 },
    motionBeatMs: 600,
    motion: {
      in: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-out" },
      out: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in" },
      morph: { animation: { kind: "morph" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in-out" },
    },
    palette: {
      primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
      background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
    },
    history: { canUndo: false, canRedo: false },
    assets: [{ id: "narration", kind: "embedded", mediaType }],
    elements: [],
    slides: [{
      id: "slide-1", name: "Intro", isTemplate: false,
      background: { kind: "solid", color: "#0b0c0e" },
      narration: {
        script: "Portable narration",
        pauseBeforeMs: 0,
        pauseAfterMs: 400,
        audio: { assetId: "narration", provenance: "human-recorded" },
      },
      states: [],
    }],
  };
}

describe("portable audio assets", () => {
  it("sniffs and structurally validates canonical PCM RIFF/WAVE", () => {
    const bytes = wav();
    expect(sniffDeksAudioMediaType(bytes)).toBe("audio/wav");
    expect(inspectDeksAudio(bytes, "audio/wav")).toMatchObject({
      mediaType: "audio/wav",
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      durationMs: 10,
    });
    expect(inspectAndNormalizeDeksAsset(bytes)).toMatchObject({ mediaType: "audio/wav" });
  });

  it("normalizes mixed portable file assets without treating audio as an image", () => {
    const source = document("audio/wav");
    const normalized = normalizeDeksFileAssets(source, [{
      id: "narration", mediaType: "audio/wav", bytes: wav(), contentHash: "",
    }]);
    expect(normalized[0]).toMatchObject({ id: "narration", mediaType: "audio/wav" });
  });

  it("sniffs and validates complete MPEG-1 Layer III frame streams", () => {
    const bytes = mp3();
    expect(sniffDeksAudioMediaType(bytes)).toBe("audio/mpeg");
    expect(inspectDeksAudio(bytes, "audio/mpeg")).toMatchObject({
      mediaType: "audio/mpeg",
      sampleRate: 44_100,
      channels: 2,
      frameCount: 3,
    });
  });

  it("rejects MIME lies, metadata/trailing bytes and malformed WAV profiles", () => {
    expect(() => inspectAndNormalizeDeksAudio(wav(), "audio/mpeg")).toThrow(/media type/i);
    expect(() => inspectAndNormalizeDeksAudio(mp3(), "audio/wav")).toThrow(/media type/i);

    const withId3 = new Uint8Array(10 + mp3().byteLength);
    withId3.set(new TextEncoder().encode("ID3"));
    withId3.set(mp3(), 10);
    expect(() => inspectAndNormalizeDeksAudio(withId3, "audio/mpeg")).toThrow(/canonical|ID3|frame/i);

    const trailing = new Uint8Array(mp3().byteLength + 1);
    trailing.set(mp3());
    expect(() => inspectAndNormalizeDeksAudio(trailing, "audio/mpeg")).toThrow(/canonical|trailing|frame/i);

    expect(() => inspectDeksAudio(wav({ channels: 3 }), "audio/wav")).toThrow(/channels/i);
    expect(() => inspectDeksAudio(wav({ sampleRate: 96_000 }), "audio/wav")).toThrow(/sample rate/i);
    expect(() => inspectDeksAudio(wav({ bitsPerSample: 8 }), "audio/wav")).toThrow(/bit depth/i);
  });

  it("rejects WAV chunk extensions and inconsistent structural lengths", () => {
    const extended = wav();
    extended.set(new TextEncoder().encode("JUNK"), 12);
    expect(() => inspectDeksAudio(extended, "audio/wav")).toThrow(/fmt|canonical/i);

    const truncated = wav().subarray(0, wav().byteLength - 1);
    expect(() => inspectDeksAudio(truncated, "audio/wav")).toThrow(/length|truncated|RIFF/i);
  });

  it("caps decoded duration independently from archive byte limits", () => {
    const justOverTenMinutes = wav({ sampleRate: 8_000, samples: 8_000 * 600 + 1 });
    expect(() => inspectDeksAudio(justOverTenMinutes, "audio/wav")).toThrow(/too long/i);
  });

  it("does not let an image state reference a declared audio asset", async () => {
    const source = document("audio/wav");
    source.elements.push({ id: "image", kind: "image", name: "Wrong asset kind", isLocked: false });
    source.slides[0]!.states.push({
      elementId: "image", x: 0, y: 0, width: 100, height: 100,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      assetId: "narration", alt: "Audio is not an image", fit: "contain",
    });
    await expect(createDeksFile(source, [{ id: "narration", mediaType: "audio/wav", bytes: wav() }]))
      .rejects.toThrow(/image.*asset|supported image/i);
  });

  it.each([
    ["audio/wav" as const, () => wav()],
    ["audio/mpeg" as const, () => mp3()],
  ])("round-trips embedded %s through the content-addressed archive", async (mediaType, bytes) => {
    const source = document(mediaType);
    const file = await createDeksFile(source, [{ id: "narration", mediaType, bytes: bytes() }]);
    const decoded = await readDeksFile(file.bytes);

    expect(decoded.document).toEqual(source);
    expect(decoded.assets).toHaveLength(1);
    expect(decoded.assets[0]).toMatchObject({ id: "narration", mediaType });
    expect(decoded.assets[0]!.bytes).toEqual(bytes());
    expect(decoded.assets[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
