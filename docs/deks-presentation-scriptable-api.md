# DeksPresentation — canonical v2 and scriptable API

## Decision

`DeksPresentation` is the runtime facade for building a normalized
`DeksPresentationDocument`. The canonical document is `{ format: "deks", version: 2 }`.
`DeksDocument` remains the flat v1 renderer/web compatibility type and is not renamed or removed.

Core remains offline and transport agnostic. It never reads paths, authenticates users, opens a URL,
or fetches an asset. Hosts own persistence, locks, network policy and operating-system capabilities.

## Canonical shape

```ts
interface DeksPresentationDocument {
  format: "deks";
  version: 2;
  id: string;
  name: string;
  revision: number;
  canvas: { width: number; height: number };
  motionBeatMs: number;
  palette: Palette;
  history: { canUndo: boolean; canRedo: boolean };
  assets: DeksAssetDescriptor[];
  elements: DeksPresentationElement[];
  slides: DeksPresentationSlide[];
  transitions: SlideTransition[];
}
```

`elements` stores identity exactly once. A slide stores `states`; each state contains `elementId`
plus geometry and subtype state, never `id`, `kind`, `name`, `shapeKind`, `semanticRole`, `parentId`
or `isLocked`.

### Identity and compatibility matrix

| Field | Canonical owner | Stable across slides | Flat v1 projection |
|---|---|---:|---|
| `id` | element identity | yes | repeated as `elements[].id` |
| `kind` | element identity | yes | repeated as `elements[].kind` |
| `shapeKind` | shape identity | yes | repeated in each shape state |
| `name` | element identity | yes | repeated in each flat state |
| `semanticRole` | element identity | yes | v1 Core cannot preserve it |
| `parentId` | element identity | yes | metadata is not representable; group identity is preserved |
| `isLocked` | element identity | yes | v1 Core cannot preserve it |
| geometry/content/style | slide state | no | flattened into each state |

Los estados de rectángulo pueden declarar `cornerRadii` con `topLeft`, `topRight`, `bottomRight` y
`bottomLeft`. El campo uniforme `cornerRadius` sigue siendo el fallback compatible; `cornerRadii`
prevalece cuando ambos están presentes. El wire v1 conserva `shape.corner_radius` y añade el objeto
opcional `shape.corner_radii` con nombres snake_case.

`group` is a v2 identity kind with base geometry state. The flat compatibility document preserves
group states so v1 codecs do not silently discard identity. The current Core renderer treats the
group as a non-rendering container and renders its child states. Cloud codecs should consume the
canonical fixture directly to preserve `parentId`, `semanticRole` and `isLocked` metadata.

Generated element IDs are namespaced as `<presentationId>:<localId>`. Imported UUID identities are
also valid because the registry gives each ID one unambiguous identity within the presentation.
`parentId` must reference a declared group, and parent graphs must be acyclic.

## Scriptable facade

```ts
const presentation = new DeksPresentation({
  id: "governance",
  name: "Govern without slowing down",
  canvas: { width: 1600, height: 900 },
});

const title = presentation.defineElement({
  id: "title",
  kind: "text",
  name: "Main title",
  semanticRole: "title",
  defaults: { content: "Govern without slowing down", fontSize: 64 },
});

const intro = presentation.addSlide({ id: "intro", name: "Context" });
intro.place(title, { x: 120, y: 120, width: 900, height: 120 });

const proposal = presentation.addSlide({ id: "proposal", name: "Proposal" });
proposal.continue(title, { y: 72, width: 1100, height: 96 });
```

`place` fails on a duplicate `(slideId, elementId)`. `continue` copies the closest prior state or an
explicit earlier slide and applies a patch. Absence means no state. Construction snapshots remain at
revision zero; durable hosts use `applyDeksPresentationCommands` to commit an atomic batch as one
revision and receive one `DeksChangeSet`.

## Assets

The runtime input is a discriminated union:

```ts
type DeksAssetInput =
  | { kind: "bytes"; bytes: Uint8Array; mediaType: string; id?: string; originalFilename?: string }
  | { kind: "blob"; blob: Blob; mediaType?: string; id?: string; originalFilename?: string }
  | { kind: "url"; url: string; mediaType?: string; id?: string; originalFilename?: string };
```

`bytes` and `blob` become an `embedded` descriptor in serialized JSON; their opaque runtime object is
kept only inside the facade. A URL becomes a `remote` descriptor and must be absolute,
credential-free HTTPS. `http:`, `data:`, `file:` and persisted `blob:` sources are invalid.

A `blob:` URL may be returned by a host `AssetResolver` for rendering. The host that calls
`URL.createObjectURL` owns that URL and must call `URL.revokeObjectURL` when the presentation,
asset, renderer or window is disposed. Core never creates, persists or revokes object URLs.

The v2-to-v1 renderer projection carries `assetId`, not a remote descriptor URL. A host resolver may
close over the v2 asset registry, apply its network and cache policy, then return a runtime URL. This
keeps the renderer network-blind and prevents a serialized remote URL from becoming an implicit fetch.

`DeksPresentation.asDeksFile()` packages runtime bytes. For a document loaded without runtime bytes,
the host supplies an `AssetByteProvider`. Core does not fetch remote URLs. The renderer continues to
receive only the resolved runtime URL through `AssetResolver` and performs no network request.

## Commands and realtime

`applyDeksPresentationCommands(source, commands)` clones the source, applies all commands, validates
the final document and commits exactly one revision. If any command or final invariant fails, the
source remains unchanged. The result contains:

```ts
interface DeksChangeSet {
  baseRevision: number;
  revision: number;
  changedPresentation: boolean;
  changedSlideIds: string[];
  changedElementIds: string[];
  changedTransitionIds: string[];
  structuralChange: boolean;
}
```

Desktop may attach the complete local snapshot to this change set. Cloud should publish the change
set as a versioned invalidation only and refetch the authoritative PostgreSQL snapshot. Presence is
ephemeral host state and never belongs to this document or its revision.

## Compatibility and file format

- `upgradeDeksDocumentToPresentation` normalizes the current flat camelCase Core document.
- `downgradeDeksPresentationToDocument` projects v2 for the current renderer/react/web packages.
- `fromDeksV1Document` decodes the API/manifest snake_case wire representation.
- `toDeksV1Document` encodes that wire representation.
- `readDeksFile` accepts `.deks` v1 and v2 and returns canonical v2.
- `createDeksFile` writes a deterministic v2 ZIP with `manifest.json` and assets by SHA-256.

Archive import rejects duplicate entries, traversal/backslashes, encryption, symlinks, suspicious
compression ratios, oversized manifests/archives, missing objects and hash/size mismatches.

The cross-runtime compatibility fixture is
`packages/document/tests/fixtures/presentation-v2.complete.json`. API and Web contract tests should
consume this single fixture rather than maintain a second description of v2.
