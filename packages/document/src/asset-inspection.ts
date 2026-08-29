import {
  inspectAndNormalizeDeksAudio,
  sniffDeksAudioMediaType,
  type DeksAudioInspection,
} from "./audio-assets.js";
import {
  inspectAndNormalizeDeksImage,
  type DeksImageInspection,
} from "./image-assets.js";

export type DeksAssetInspection = DeksImageInspection | DeksAudioInspection;

/** Byte-sniffed portable asset admission shared by archive and host adapters. */
export function inspectAndNormalizeDeksAsset(
  content: Uint8Array,
  claimedMediaType?: string,
): DeksAssetInspection {
  if (claimedMediaType?.startsWith("audio/") || sniffDeksAudioMediaType(content) !== undefined) {
    return inspectAndNormalizeDeksAudio(content, claimedMediaType);
  }
  return inspectAndNormalizeDeksImage(content, claimedMediaType);
}
