import { unzipSync } from "fflate";
import type { DeksAssetDescriptor, DeksDocument } from "./presentation.js";
import {
  assertDeksDocument,
  DEKS_DOCUMENT_LIMITS,
  isSha256,
  parseJsonWithUniqueObjectKeys,
} from "./presentation-validation.js";

export const DEKS_FILE_MEDIA_TYPE = "application/vnd.deks+zip" as const;
export const DEKS_ARCHIVE_LIMITS = Object.freeze({
  maxFiles: 10_001,
  maxManifestBytes: 20 * 1024 * 1024,
  maxUncompressedBytes: 512 * 1024 * 1024,
  maxAssetBytes: 100 * 1024 * 1024,
  compressionRatioCheckThresholdBytes: 1024 * 1024,
  maxCompressionRatio: 100,
});

export interface DeksFile {
  filename: string;
  mediaType: typeof DEKS_FILE_MEDIA_TYPE;
  bytes: Uint8Array;
}

export interface DeksFileAssetInput {
  id: string;
  bytes: Uint8Array | Blob;
  mediaType: string;
}

export interface DeksFileAsset extends DeksFileAssetInput {
  bytes: Uint8Array;
  contentHash: string;
}

export type AssetByteProvider = (
  asset: DeksAssetDescriptor,
) => Promise<Uint8Array | Blob | undefined> | Uint8Array | Blob | undefined;

export interface ReadDeksFileResult {
  document: DeksDocument;
  assets: DeksFileAsset[];
}

interface ArchiveEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  flags: number;
  externalAttributes: number;
}

interface PackagedAssetMetadata {
  id: string;
  contentHash: string;
  mediaType: string;
  originalFilename: string | null;
  byteSize: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function deterministicZip(files: ReadonlyArray<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, file.bytes.length, true);
    localView.setUint32(22, file.bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, file.bytes);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 0x0314, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, file.bytes.length, true);
    centralView.setUint32(24, file.bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, (0o100600 << 16) >>> 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + file.bytes.length;
  }
  const centralBytes = concat(centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, offset, true);
  return concat([...locals, centralBytes, end]);
}

async function bytes(value: Uint8Array | Blob): Promise<Uint8Array> {
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(await value.arrayBuffer());
}

async function sha256(value: Uint8Array): Promise<string> {
  const stable = new Uint8Array(value.byteLength);
  stable.set(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", stable.buffer);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function safeFilename(name: string): string {
  const stem = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  return `${stem || "presentation"}.deks`;
}

export async function createDeksFile(
  document: DeksDocument,
  assetInputs: readonly DeksFileAssetInput[] | AssetByteProvider = [],
): Promise<DeksFile> {
  assertDeksDocument(document);
  if (encoder.encode(JSON.stringify(document)).byteLength > DEKS_DOCUMENT_LIMITS.maxJsonBytes) {
    throw new Error("DEKS document JSON is too large");
  }
  const provided = Array.isArray(assetInputs) ? new Map(assetInputs.map((asset) => [asset.id, asset])) : undefined;
  if (provided && provided.size !== assetInputs.length) throw new Error("duplicate asset input id");
  if (provided) {
    const descriptorIds = new Set(document.assets.map(({ id }) => id));
    for (const id of provided.keys()) {
      if (!descriptorIds.has(id)) throw new Error(`asset input ${id} has no descriptor`);
    }
  }
  const provider: AssetByteProvider | undefined = typeof assetInputs === "function" ? assetInputs : undefined;
  const packaged: Array<{ metadata: PackagedAssetMetadata; bytes: Uint8Array }> = [];
  for (const descriptor of document.assets) {
    if (descriptor.kind !== "embedded") continue;
    const direct = provided?.get(descriptor.id);
    if (direct && direct.mediaType !== descriptor.mediaType) {
      throw new Error(`asset ${descriptor.id} media type does not match its descriptor`);
    }
    const bodySource = direct?.bytes ?? await provider?.(descriptor);
    if (bodySource === undefined) {
      throw new Error(`embedded asset ${descriptor.id} is missing bytes`);
    }
    const body = await bytes(bodySource);
    if (body.byteLength > DEKS_ARCHIVE_LIMITS.maxAssetBytes) throw new Error(`asset ${descriptor.id} is too large`);
    const contentHash = await sha256(body);
    packaged.push({
      metadata: {
        id: descriptor.id,
        contentHash,
        mediaType: descriptor.mediaType,
        originalFilename: descriptor.originalFilename ?? null,
        byteSize: body.byteLength,
      },
      bytes: body,
    });
  }
  packaged.sort((left, right) => left.metadata.contentHash.localeCompare(right.metadata.contentHash)
    || left.metadata.id.localeCompare(right.metadata.id));
  const manifest = {
    format: "deks",
    document: structuredClone(document),
    assets: packaged.map(({ metadata }) => metadata),
  };
  const manifestBody = encoder.encode(JSON.stringify(manifest));
  if (manifestBody.byteLength > DEKS_ARCHIVE_LIMITS.maxManifestBytes) throw new Error("DEKS manifest is too large");
  const uniqueObjects = new Map(packaged.map((asset) => [asset.metadata.contentHash, asset.bytes]));
  const uncompressedBytes = manifestBody.byteLength + [...uniqueObjects.values()].reduce((sum, body) => sum + body.byteLength, 0);
  if (uncompressedBytes > DEKS_ARCHIVE_LIMITS.maxUncompressedBytes) throw new Error("DEKS archive is too large");
  const files = [
    { name: "manifest.json", bytes: manifestBody },
    ...[...uniqueObjects].map(([contentHash, body]) => ({ name: `assets/${contentHash}`, bytes: body })),
  ];
  return { filename: safeFilename(document.name), mediaType: DEKS_FILE_MEDIA_TYPE, bytes: deterministicZip(files) };
}

function archiveEntries(content: Uint8Array): ArchiveEntry[] {
  if (content.byteLength < 22) throw new Error("invalid DEKS ZIP archive");
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  let endOffset = -1;
  for (let offset = content.byteLength - 22; offset >= Math.max(0, content.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error("invalid DEKS ZIP end record");
  const count = view.getUint16(endOffset + 10, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (count > DEKS_ARCHIVE_LIMITS.maxFiles) throw new Error("DEKS archive contains too many files");
  const entries: ArchiveEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > content.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error("invalid DEKS ZIP central directory");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const endName = offset + 46 + nameLength;
    if (endName > content.byteLength) throw new Error("invalid DEKS ZIP entry name");
    entries.push({
      name: decoder.decode(content.subarray(offset + 46, endName)),
      flags: view.getUint16(offset + 8, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      externalAttributes: view.getUint32(offset + 38, true),
    });
    offset = endName + extraLength + commentLength;
  }
  return entries;
}

function validateEntries(entries: readonly ArchiveEntry[]): void {
  if (new Set(entries.map(({ name }) => name)).size !== entries.length) throw new Error("duplicate archive entry");
  let total = 0;
  for (const entry of entries) {
    if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").includes("..")) throw new Error("unsafe DEKS archive path");
    if (entry.name !== "manifest.json" && !/^assets\/[0-9a-f]{64}$/.test(entry.name)) throw new Error(`unsupported DEKS archive entry ${entry.name}`);
    if ((entry.flags & 0x1) !== 0) throw new Error("encrypted DEKS archive entries are unsupported");
    if (((entry.externalAttributes >>> 16) & 0o170000) === 0o120000) throw new Error("DEKS archive symlinks are unsupported");
    if (entry.name.startsWith("assets/") && entry.uncompressedSize > DEKS_ARCHIVE_LIMITS.maxAssetBytes) throw new Error("DEKS archive asset is too large");
    if (entry.uncompressedSize > DEKS_ARCHIVE_LIMITS.compressionRatioCheckThresholdBytes
      && entry.uncompressedSize > Math.max(entry.compressedSize, 1) * DEKS_ARCHIVE_LIMITS.maxCompressionRatio) {
      throw new Error("suspicious DEKS archive compression ratio");
    }
    total += entry.uncompressedSize;
  }
  if (total > DEKS_ARCHIVE_LIMITS.maxUncompressedBytes) throw new Error("DEKS archive is too large");
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid DEKS ${field}`);
  return value as Record<string, unknown>;
}

function assetMetadata(value: unknown, index: number): PackagedAssetMetadata {
  const item = object(value, `assets[${index}]`);
  const allowed = new Set(["id", "contentHash", "mediaType", "originalFilename", "byteSize"]);
  if (Object.keys(item).some((key) => !allowed.has(key)) || Object.keys(item).length !== allowed.size
    || typeof item.id !== "string" || typeof item.contentHash !== "string" || !isSha256(item.contentHash)
    || typeof item.mediaType !== "string" || (item.originalFilename !== null && typeof item.originalFilename !== "string")
    || typeof item.byteSize !== "number" || !Number.isSafeInteger(item.byteSize) || item.byteSize < 0
    || item.byteSize > DEKS_ARCHIVE_LIMITS.maxAssetBytes) {
    throw new Error(`invalid DEKS assets[${index}] metadata`);
  }
  return item as unknown as PackagedAssetMetadata;
}

export async function readDeksFile(content: Uint8Array): Promise<ReadDeksFileResult> {
  const entries = archiveEntries(content);
  validateEntries(entries);
  const files = unzipSync(content);
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) throw new Error("DEKS manifest.json is missing");
  if (manifestBytes.byteLength > DEKS_ARCHIVE_LIMITS.maxManifestBytes) throw new Error("DEKS manifest is too large");
  let raw: unknown;
  try {
    raw = parseJsonWithUniqueObjectKeys(decoder.decode(manifestBytes));
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`invalid DEKS manifest JSON${reason}`);
  }
  const manifest = object(raw, "manifest");
  const manifestKeys = new Set(["format", "document", "assets"]);
  if (Object.keys(manifest).some((key) => !manifestKeys.has(key)) || Object.keys(manifest).length !== manifestKeys.size
    || manifest.format !== "deks") throw new Error("unsupported DEKS manifest");
  const document = manifest.document;
  assertDeksDocument(document);
  if (encoder.encode(JSON.stringify(document)).byteLength > DEKS_DOCUMENT_LIMITS.maxJsonBytes) {
    throw new Error("DEKS document JSON is too large");
  }
  if (!Array.isArray(manifest.assets)) throw new Error("invalid DEKS asset inventory");
  const metadata = manifest.assets.map(assetMetadata);
  if (new Set(metadata.map(({ id }) => id)).size !== metadata.length) {
    throw new Error("duplicate DEKS asset id");
  }
  const descriptors = new Map(document.assets.map((asset) => [asset.id, asset]));
  const embeddedIds = new Set(document.assets.filter(({ kind }) => kind === "embedded").map(({ id }) => id));
  const inventoryIds = new Set(metadata.map(({ id }) => id));
  for (const id of embeddedIds) {
    if (!inventoryIds.has(id)) throw new Error(`embedded asset ${id} is absent from the package inventory`);
  }
  for (const item of metadata) {
    const descriptor = descriptors.get(item.id);
    if (descriptor?.kind !== "embedded") throw new Error(`packaged asset ${item.id} has no embedded descriptor`);
    if (descriptor.mediaType !== item.mediaType) throw new Error(`asset ${item.id} media type does not match its descriptor`);
    if ((descriptor.originalFilename ?? null) !== item.originalFilename) throw new Error(`asset ${item.id} original filename does not match its descriptor`);
  }
  const assets: DeksFileAsset[] = [];
  for (const item of metadata) {
    const body = files[`assets/${item.contentHash}`];
    if (!body) throw new Error(`asset ${item.id} object is missing from archive`);
    if (body.byteLength !== item.byteSize || await sha256(body) !== item.contentHash) throw new Error(`asset ${item.id} hash or size mismatch`);
    assets.push({
      id: item.id,
      bytes: new Uint8Array(body),
      mediaType: item.mediaType,
      ...(item.originalFilename === null ? {} : { originalFilename: item.originalFilename }),
      contentHash: item.contentHash,
    });
  }
  const expectedFiles = new Set(["manifest.json", ...metadata.map(({ contentHash }) => `assets/${contentHash}`)]);
  if (entries.some(({ name }) => !expectedFiles.has(name))) throw new Error("DEKS archive contains an unreferenced file");
  return { document, assets };
}
