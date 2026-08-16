# Specification

## Canonical document

DEKS has one canonical JSON document. It is the source of truth for authoring, rendering, files,
commands and interchange:

```ts
interface DeksDocument {
  format: "deks";
  id: string;
  name: string;
  revision: number;
  canvas: { width: number; height: number };
  motionBeatMs: number;
  palette: Palette;
  history: { canUndo: boolean; canRedo: boolean };
  assets: DeksAssetDescriptor[];
  elements: DeksElement[];
  slides: DeksSlide[];
  transitions: SlideTransition[];
}
```

Element identity is declared exactly once in `elements`. A slide stores only checkpoint-local
states containing `elementId`, geometry and subtype properties. Assets are referenced through the
document asset registry. Persisted runtime URLs, storage keys and binary data are not document
fields.

There is no alternative document or host-specific wire shape. JSON is
the public contract. PostgreSQL tables, browser state, renderer snapshots, archives and desktop
files are projections or containers around that contract and must round-trip without changing its
meaning.

IDs are opaque strings matching `[A-Za-z0-9][A-Za-z0-9._-]*`; they are not required to be UUIDs.
Relational hosts must preserve them losslessly. All string bounds count Unicode scalar values, not
UTF-16 code units or UTF-8 bytes; unpaired UTF-16 surrogates are invalid.

## Canonical state rules

- Shape identity owns `shapeKind`; shape state uses `shapeFill` and optional `cornerRadii`.
- Uniform shape `cornerRadius` and scalar shape `fill` are not part of the document.
- Link buttons keep `cornerRadius` and `fill` because those are native button state.
- Image state references `assetId`; `assetUrl` is a runtime resolver result and is never persisted.
- External link and remote asset URLs are absolute, credential-free HTTPS URLs.
- Unknown properties are rejected.
- Text requires content, typography, spacing, alignment, overflow and fill.
- Shape requires `shapeFill`, `stroke` and `strokeWidth`; `cornerRadii` is optional only for
  rectangles, and line fill must be solid.
- Image requires declared `assetId`, `alt` and `fit`.
- Link button and icon states require their complete visual fields; renderer defaults never become
  hidden document semantics.
- Browser text measurements are renderer results and are not persisted in element states.
- `transitions` contains exactly one forward edge for every adjacent slide pair, in slide order.
  Reverse navigation derives playback from that same boundary.
- `effectiveDurationMs` uses positive half-up rounding:
  `floor(motionBeatMs * durationMultiplier + 0.5)`.

## Universal format limits

`DEKS_DOCUMENT_LIMITS` and `schema/deks-document.schema.json` define defensive interoperability
limits. They apply in every host:

| Resource | Universal limit |
|---|---:|
| UTF-8 JSON | 5,000,000 bytes |
| JSON nodes | 200,000 root/member/array-entry values |
| Slides | 200 |
| Element identities | 100,000 |
| States per slide | 500 |
| Assets | 10,000 |
| Transitions | 199 |
| Text content | 100,000 characters |
| External URL | 2,048 Unicode scalar values |
| Canvas width | 320 to 16,384 px |
| Canvas height | 180 to 16,384 px |
| Canvas aspect ratio | between 1:4 and 4:1 |
| State x/y coordinate | -100,000 to 100,000 px |
| State width/height | 0.1 to 100,000 px |
| Rotation | -36,000 to 36,000 degrees |
| z-index | -100,000 to 100,000 |
| Transition delay | 0 to 60,000 ms |
| Overrides per transition | 1,000 (the union of two 500-state endpoints) |
| Element motions per transition | 2,000 (two directions per endpoint identity) |
| JSON nesting | 128 levels |

The node budget is enforced by a bounded lexical pre-scan before `JSON.parse`, for standalone
documents and `.deks` manifests. Each root value, object member value and array entry counts once;
characters and escape sequences inside a JSON string do not create nodes. This pre-parse resource
budget cannot be expressed by JSON Schema, so `DEKS_DOCUMENT_LIMITS.maxJsonNodes` is authoritative
for it while the schema remains authoritative for structural collection bounds.

These are format safety bounds, not product quotas. DEKS Cloud may apply stricter limits such as
fewer slides or states per slide based on operational policy. Cloud limits belong to the host and
must not alter this schema or make a Cloud projection a second document format.

## Universal archive limits

`.deks` is a deterministic ZIP container with exact manifest shape
`{format:"deks", document, assets}`. Asset metadata is
`{id,contentHash,mediaType,originalFilename,byteSize}`; `originalFilename` is `null` when absent.
Multiple IDs may reference one content hash and the binary object is stored once.

`DEKS_ARCHIVE_LIMITS` applies in every host:

| Resource | Universal limit |
|---|---:|
| Archive entries | 10,001 |
| Manifest | 20 MiB |
| One asset | 100 MiB |
| Total uncompressed | 512 MiB |
| Compression ratio | 100:1 for entries over 1 MiB |

Archive paths, symlinks, encryption, hashes, declared byte sizes and unreferenced entries are
validated before content is accepted. The embedded document independently remains subject to the
5,000,000-byte JSON bound.

## Golden contract

- JSON Schema: `packages/document/src/schema/deks-document.schema.json` (package export `@deks-js/document/schema`)
- Golden document: `packages/document/tests/fixtures/deks-document.canonical.json`

Every package that reads or writes DEKS JSON must validate against the same document semantics and
exercise the golden document in contract tests.
