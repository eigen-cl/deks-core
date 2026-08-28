import type { DeksDocument } from "./presentation.js";
import {
  assertDeksDocument,
  DEKS_DOCUMENT_LIMITS,
  parseJsonWithUniqueObjectKeys,
} from "./presentation-validation.js";

export const DEKS_CODEC_VERSION = 2 as const;

const TEXT_IDENTITY_FIELDS = [
  "content",
  "fontFamily",
  "horizontalAlignment",
  "verticalAlignment",
  "overflowMode",
] as const;

export type DeksCodecWarning = {
  code: "text-identity-conflict";
  elementId: string;
  field: typeof TEXT_IDENTITY_FIELDS[number];
  chosenSlideId: string;
  chosenSignature: string;
  ignored: Array<{ slideId: string; signature: string }>;
};

export interface DeksCodecMigrationResult {
  document: DeksDocument;
  warnings: DeksCodecWarning[];
  fromVersion: number;
  toVersion: typeof DEKS_CODEC_VERSION;
}

type MutableDocument = Record<string, unknown>;
type MigrationStep = (document: MutableDocument) => DeksCodecWarning[];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Bounded stable signature: enums stay readable; long authored content never floods warnings. */
function signature(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return "<missing>";
  if (serialized.length <= 80) return serialized;
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `json:${serialized.length}:fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function migrateV1ToV2(document: MutableDocument): DeksCodecWarning[] {
  if (!Array.isArray(document.elements) || !Array.isArray(document.slides)) {
    throw new Error("v1 DEKS document must define elements and slides arrays");
  }
  const slides = document.slides.map((value, index) => {
    const slide = object(value, `slides[${index}]`);
    if (typeof slide.id !== "string" || !Array.isArray(slide.states)) {
      throw new Error(`slides[${index}] must define id and states`);
    }
    return slide as Record<string, unknown> & { id: string; states: unknown[] };
  });
  const warnings: DeksCodecWarning[] = [];

  document.elements.forEach((value, elementIndex) => {
    const element = object(value, `elements[${elementIndex}]`);
    if (element.kind !== "text") return;
    if (typeof element.id !== "string") throw new Error(`elements[${elementIndex}].id must be a string`);
    const occurrences = slides.flatMap((slide) => slide.states.flatMap((stateValue, stateIndex) => {
      const state = object(stateValue, `slide ${slide.id} states[${stateIndex}]`);
      return state.elementId === element.id ? [{ slideId: slide.id, state }] : [];
    }));
    if (occurrences.length === 0) {
      throw new Error(`cannot migrate v1 text element ${element.id}: no slide state can own its identity values`);
    }

    for (const field of TEXT_IDENTITY_FIELDS) {
      const chosen = occurrences[0]!;
      const chosenValue = chosen.state[field];
      if (chosenValue === undefined) {
        throw new Error(`cannot migrate v1 text element ${element.id}: first state on slide ${chosen.slideId} has no ${field}`);
      }
      const chosenSignature = signature(chosenValue);
      const ignored = occurrences.slice(1).flatMap(({ slideId, state }) => {
        const candidateSignature = signature(state[field]);
        return candidateSignature === chosenSignature ? [] : [{ slideId, signature: candidateSignature }];
      });
      if (ignored.length > 0) warnings.push({
        code: "text-identity-conflict",
        elementId: element.id,
        field,
        chosenSlideId: chosen.slideId,
        chosenSignature,
        ignored,
      });
      element[field] = chosenValue;
      for (const { state } of occurrences) delete state[field];
    }
  });
  document.codecVersion = DEKS_CODEC_VERSION;
  return warnings;
}

/** Registry deliberately keyed by source version so v3 can chain 1 -> 2 -> 3. */
const MIGRATIONS: Readonly<Record<number, MigrationStep>> = Object.freeze({
  1: migrateV1ToV2,
});

function sourceVersion(input: MutableDocument): number {
  if (input.codecVersion === undefined) return 1;
  if (typeof input.codecVersion !== "number" || !Number.isInteger(input.codecVersion) || input.codecVersion < 1) {
    throw new Error("codecVersion must be a positive integer");
  }
  return input.codecVersion;
}

/**
 * Decodes any supported document version to the current strict canonical form.
 * The input is never mutated; applying this to current v2 is an idempotent no-op.
 */
export function migrateDeksDocument(input: unknown): DeksCodecMigrationResult {
  const document = structuredClone(input);
  const mutable = object(document, "DEKS document");
  const fromVersion = sourceVersion(mutable);
  if (fromVersion > DEKS_CODEC_VERSION) {
    throw new Error(`future codecVersion ${fromVersion} is not supported; current version is ${DEKS_CODEC_VERSION}`);
  }
  const warnings: DeksCodecWarning[] = [];
  let version = fromVersion;
  while (version < DEKS_CODEC_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`no DEKS codec migration is registered from version ${version}`);
    warnings.push(...step(mutable));
    version += 1;
  }
  assertDeksDocument(document);
  return { document, warnings, fromVersion, toVersion: DEKS_CODEC_VERSION };
}

/** Duplicate-safe JSON decoding followed by the generic sequential migration pipeline. */
export function decodeDeksJson(serialized: string): DeksCodecMigrationResult {
  if (new TextEncoder().encode(serialized).byteLength > DEKS_DOCUMENT_LIMITS.maxJsonBytes) {
    throw new Error("DEKS document JSON is too large");
  }
  return migrateDeksDocument(parseJsonWithUniqueObjectKeys(serialized));
}
