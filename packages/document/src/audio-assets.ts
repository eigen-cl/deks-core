export const DEKS_AUDIO_LIMITS = Object.freeze({
  mediaTypes: ["audio/mpeg", "audio/wav"] as const,
  maxBytes: 50_000_000,
  maxDurationMs: 10 * 60 * 1_000,
  minSampleRate: 8_000,
  maxSampleRate: 48_000,
  channels: [1, 2] as const,
  pcmBitsPerSample: [16, 24] as const,
});

export type DeksAudioMediaType = (typeof DEKS_AUDIO_LIMITS.mediaTypes)[number];

interface DeksAudioInspectionBase {
  bytes: Uint8Array;
  mediaType: DeksAudioMediaType;
  durationMs: number;
  sampleRate: number;
  channels: 1 | 2;
}

export type DeksAudioInspection =
  | (DeksAudioInspectionBase & { mediaType: "audio/wav"; bitsPerSample: 16 | 24 })
  | (DeksAudioInspectionBase & { mediaType: "audio/mpeg"; frameCount: number });

export type DeksAudioErrorCode =
  | "asset_empty"
  | "asset_too_large"
  | "asset_media_type_unsupported"
  | "asset_unsafe"
  | "asset_too_complex";

const ERROR_MESSAGES: Record<DeksAudioErrorCode, string> = {
  asset_empty: "audio asset is empty",
  asset_too_large: "audio asset is too large or too long",
  asset_media_type_unsupported: "audio media type is unsupported or does not match its bytes",
  asset_unsafe: "audio asset is not a canonical, structurally valid stream",
  asset_too_complex: "audio asset profile is unsupported or too complex",
};

export class DeksAudioError extends Error {
  readonly code: DeksAudioErrorCode;

  constructor(code: DeksAudioErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code], cause === undefined ? undefined : { cause });
    this.name = "DeksAudioError";
    this.code = code;
  }
}

function ascii(content: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > content.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (content[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function bounded(content: Uint8Array): void {
  if (!(content instanceof Uint8Array)) throw new Error("audio bytes must be a Uint8Array");
  if (content.byteLength === 0) throw new Error("audio asset is empty");
  if (content.byteLength > DEKS_AUDIO_LIMITS.maxBytes) throw new Error("audio asset is too large");
}

function duration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("audio duration is invalid");
  if (durationMs > DEKS_AUDIO_LIMITS.maxDurationMs) throw new Error("audio duration is too long");
  return Math.round(durationMs);
}

function inspectWav(content: Uint8Array): DeksAudioInspection {
  bounded(content);
  if (content.byteLength < 44 || !ascii(content, 0, "RIFF") || !ascii(content, 8, "WAVE")) {
    throw new Error("invalid RIFF/WAVE header");
  }
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  if (view.getUint32(4, true) !== content.byteLength - 8) throw new Error("RIFF length does not match the file");
  if (!ascii(content, 12, "fmt ") || view.getUint32(16, true) !== 16) {
    throw new Error("canonical WAV requires one 16-byte fmt chunk first");
  }
  if (view.getUint16(20, true) !== 1) throw new Error("canonical WAV requires integer PCM format");
  const channels = view.getUint16(22, true);
  if (!(DEKS_AUDIO_LIMITS.channels as readonly number[]).includes(channels)) throw new Error("WAV channels are unsupported");
  const sampleRate = view.getUint32(24, true);
  if (sampleRate < DEKS_AUDIO_LIMITS.minSampleRate || sampleRate > DEKS_AUDIO_LIMITS.maxSampleRate) {
    throw new Error("WAV sample rate is unsupported");
  }
  const bitsPerSample = view.getUint16(34, true);
  if (!(DEKS_AUDIO_LIMITS.pcmBitsPerSample as readonly number[]).includes(bitsPerSample)) {
    throw new Error("WAV bit depth is unsupported");
  }
  const blockAlign = channels * bitsPerSample / 8;
  if (view.getUint16(32, true) !== blockAlign) throw new Error("WAV block alignment is inconsistent");
  if (view.getUint32(28, true) !== sampleRate * blockAlign) throw new Error("WAV byte rate is inconsistent");
  if (!ascii(content, 36, "data")) throw new Error("canonical WAV requires the data chunk after fmt");
  const dataBytes = view.getUint32(40, true);
  if (dataBytes === 0 || dataBytes % blockAlign !== 0) throw new Error("WAV data length is not sample-aligned");
  const padding = dataBytes % 2;
  if (content.byteLength !== 44 + dataBytes + padding) throw new Error("WAV data length is truncated or has trailing bytes");
  if (padding === 1 && content[content.byteLength - 1] !== 0) throw new Error("WAV padding byte must be zero");
  const sampleCount = dataBytes / blockAlign;
  return {
    bytes: new Uint8Array(content),
    mediaType: "audio/wav",
    durationMs: duration(sampleCount / sampleRate * 1_000),
    sampleRate,
    channels: channels as 1 | 2,
    bitsPerSample: bitsPerSample as 16 | 24,
  };
}

const MPEG1_LAYER3_BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
const MPEG1_SAMPLE_RATES = [44_100, 48_000, 32_000] as const;

function inspectMpeg(content: Uint8Array): DeksAudioInspection {
  bounded(content);
  if (ascii(content, 0, "ID3")) throw new Error("canonical MP3 does not contain ID3 metadata");
  let offset = 0;
  let frameCount = 0;
  let sampleRate: number | undefined;
  let channels: 1 | 2 | undefined;
  while (offset < content.byteLength) {
    if (offset + 4 > content.byteLength) throw new Error("MP3 has trailing bytes after its last frame");
    const first = content[offset]!;
    const second = content[offset + 1]!;
    const third = content[offset + 2]!;
    const fourth = content[offset + 3]!;
    if (first !== 0xff || (second & 0xe0) !== 0xe0) throw new Error("invalid MP3 frame sync");
    if (((second >> 3) & 0x03) !== 0x03 || ((second >> 1) & 0x03) !== 0x01) {
      throw new Error("canonical MP3 requires MPEG-1 Layer III frames");
    }
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleRateIndex = (third >> 2) & 0x03;
    const bitrateKbps = MPEG1_LAYER3_BITRATES_KBPS[bitrateIndex];
    const frameSampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex];
    if (!bitrateKbps || !frameSampleRate) throw new Error("MP3 bitrate or sample rate is unsupported");
    const frameChannels: 1 | 2 = ((fourth >> 6) & 0x03) === 0x03 ? 1 : 2;
    if (sampleRate !== undefined && sampleRate !== frameSampleRate) throw new Error("MP3 sample rate changes between frames");
    if (channels !== undefined && channels !== frameChannels) throw new Error("MP3 channel mode changes between frames");
    sampleRate = frameSampleRate;
    channels = frameChannels;
    const padding = (third >> 1) & 0x01;
    const frameLength = Math.floor(144 * bitrateKbps * 1_000 / frameSampleRate) + padding;
    if (offset + frameLength > content.byteLength) throw new Error("MP3 frame is truncated");
    offset += frameLength;
    frameCount += 1;
  }
  if (frameCount === 0 || sampleRate === undefined || channels === undefined) throw new Error("MP3 has no frames");
  return {
    bytes: new Uint8Array(content),
    mediaType: "audio/mpeg",
    durationMs: duration(frameCount * 1_152 / sampleRate * 1_000),
    sampleRate,
    channels,
    frameCount,
  };
}

export function sniffDeksAudioMediaType(content: Uint8Array): DeksAudioMediaType | undefined {
  if (ascii(content, 0, "RIFF") && ascii(content, 8, "WAVE")) return "audio/wav";
  if (content.byteLength >= 2 && content[0] === 0xff && (content[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  return undefined;
}

export function inspectDeksAudio(content: Uint8Array, mediaType: string): DeksAudioInspection {
  if (mediaType === "audio/wav") return inspectWav(content);
  if (mediaType === "audio/mpeg") return inspectMpeg(content);
  throw new Error(`unsupported DEKS audio media type ${mediaType}`);
}

function audioErrorCode(error: unknown): DeksAudioErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/empty/i.test(message)) return "asset_empty";
  if (/too large|too long/i.test(message)) return "asset_too_large";
  if (/media type|unsupported DEKS audio/i.test(message)) return "asset_media_type_unsupported";
  if (/profile|sample rate|channels|bit depth|MPEG-1 Layer III/i.test(message)) return "asset_too_complex";
  return "asset_unsafe";
}

export function inspectAndNormalizeDeksAudio(
  content: Uint8Array,
  claimedMediaType?: string,
): DeksAudioInspection {
  if (!(content instanceof Uint8Array)) throw new DeksAudioError("asset_media_type_unsupported");
  if (content.byteLength === 0) throw new DeksAudioError("asset_empty");
  const sniffed = sniffDeksAudioMediaType(content);
  if (sniffed !== undefined && claimedMediaType !== undefined && sniffed !== claimedMediaType) {
    throw new DeksAudioError("asset_media_type_unsupported");
  }
  const mediaType = sniffed ?? claimedMediaType;
  if (!(DEKS_AUDIO_LIMITS.mediaTypes as readonly string[]).includes(mediaType ?? "")) {
    throw new DeksAudioError("asset_media_type_unsupported");
  }
  try {
    return inspectDeksAudio(content, mediaType!);
  } catch (error) {
    throw new DeksAudioError(audioErrorCode(error), error);
  }
}
