# Specification

## Canonical document

DEKS has one canonical JSON document. It is the source of truth for authoring, rendering, files,
commands and interchange:

```ts
interface DeksDocument {
  format: "deks";
  codecVersion: 3;
  id: string;
  name: string;
  revision: number;
  canvas: { width: number; height: number };
  motionBeatMs: number;
  motion: MotionSpec;
  palette: Palette;
  history: { canUndo: boolean; canRedo: boolean };
  assets: DeksAssetDescriptor[];
  elements: DeksElement[];
  slides: DeksSlide[];
}
```

`codecVersion` versions the portable document contract, independently of package versions and the
editor's `revision`. The current strict schema is v3. An absent version or explicit
`codecVersion: 1` identifies the previous state-owned text contract, while v2 is the contract before
portable narration. `migrateDeksDocument` upgrades supported versions through a sequential registry;
`decodeDeksJson` adds duplicate-safe JSON parsing. Both return
`{document,warnings,fromVersion,toVersion}`. A v3 input is an idempotent no-op and future versions are
rejected rather than guessed.

The v1 -> v2 step promotes each text identity field from the first state in slide order. If later
states disagree it still makes that deterministic choice and emits a bounded structured warning with
the element, field, chosen source slide/signature and ignored slide signatures. A v1 text identity
with no state is rejected as a missing migration source; the codec never invents authored content or
alignment. `.deks` readers run this same migration and return its warnings.

The v2 -> v3 step changes only `codecVersion`. It never invents a narration script, timing or audio
reference, so an old deck retains exactly its authored slides.

Element identity is declared exactly once in `elements`. A slide stores only checkpoint-local
states containing `elementId`, geometry and subtype properties. Assets are referenced through the
document asset registry. Persisted runtime URLs, storage keys and binary data are not document
fields.

### Logical element groups

The identity graph introduced before v3 is also the portable grouping contract. A named identity with
`kind: "group"` is a logical folder; any identity whose `parentId` points to it is a member. Groups
may be nested, their names are ordinary element identity names, and the parent graph must remain
acyclic. Codec v3 does not change those grouping semantics.

A group is non-rendered and does not own a transform. It may have no state on any slide. If a
historic or editing flow gives it a state, that state does not move, resize, rotate, restyle or
otherwise alter any descendant. Every member continues to store absolute canvas geometry, style,
z-order and motion in its own checkpoint state.

For collision candidate filtering, an element's **effective group** is its outermost `group`
ancestor. Two distinct rendered elements with the same non-null effective group are not collision
candidates. Elements in different effective groups, two ungrouped elements, and one grouped plus
one ungrouped element remain candidates. The outermost rule means nested folders under one logical
group remain one suppression scope. Group identities themselves are never collision candidates.

`effectiveGroupId(document, elementId)` and
`areElementsCollisionCandidates(document, firstElementId, secondElementId)` expose these semantics
as pure `@deks-js/document` helpers. A full pair scan should create one indexed O(1)-per-pair filter
with `createElementCollisionCandidatePredicate(document)`, then call it before each rectangle or
rendered-bounds comparison. These helpers only select candidates; they do not claim that a remaining
pair overlaps.

Group membership is edited with `update-element-identity`: a string `parentId` assigns the group,
while `parentId: null` is the JSON-compatible removal sentinel. Applying the latter deletes the
property; canonical documents never persist `parentId: null`.

There is no alternative document or host-specific wire shape. JSON is
the public contract. PostgreSQL tables, browser state, renderer snapshots, archives and desktop
files are projections or containers around that contract and must round-trip without changing its
meaning.

IDs are opaque strings matching `[A-Za-z0-9][A-Za-z0-9._-]*`; they are not required to be UUIDs.
Relational hosts must preserve them losslessly. All string bounds count Unicode scalar values, not
UTF-16 code units or UTF-8 bytes; unpaired UTF-16 surrogates are invalid.

### Portable slide narration

Each slide may declare one optional `narration` object:

```ts
interface DeksSlideNarration {
  script: string;
  pauseBeforeMs: number;
  pauseAfterMs: number;
  audio?: {
    assetId: string;
    provenance: "human-recorded" | "synthetic";
  };
}
```

`script` is the authored spoken text and can exist before audio is recorded or generated. The two
pauses are explicit non-negative timing around that slide's narration; they do not change visual
motion beats. When `audio` exists, its asset must be an embedded supported audio descriptor. A
remote URL is not portable narration and is rejected.

`provenance` distinguishes a human recording from synthetic speech. Voice identity, model/provider,
generation request IDs, consent records, credentials, playback position and runtime URLs are host
concerns and are not document fields. Replacing generated audio is therefore an ordinary asset plus
`set-slide-narration` edit, with no provider-specific migration.

`set-slide-narration` replaces the complete object, and `clear-slide-narration` removes it. Removing
an asset referenced by narration is rejected just like removing an asset referenced by an image.
Neither command changes geometry, animation or renderer snapshots. Visual renderers intentionally
ignore narration; a Web or Desktop host owns playback and synchronization.

## Canonical state rules

- Shape identity owns `shapeKind`; shape state uses `shapeFill` and optional `cornerRadii`.
- Uniform shape `cornerRadius` and scalar shape `fill` are not part of the document.
- Link buttons keep `cornerRadius` and `fill` because those are native button state.
- Image state references `assetId`; `assetUrl` is a runtime resolver result and is never persisted.
- External link and remote asset URLs are absolute, credential-free HTTPS URLs.
- Unknown properties are rejected.
- Text identity owns the discrete values `content`, `fontFamily`, `horizontalAlignment`,
  `verticalAlignment` and `overflowMode`. They are edited once for the identity, so every checkpoint
  of a persistent text projects the same decisions and alignment edits cannot turn its morph into a
  crossfade.
- Text state owns the continuously interpolated values `fill`, `fontSize`, `fontWeight`, `lineHeight`
  and `letterSpacing`, plus geometry, opacity, z-order and motion. It may carry exactly one four-sided
  `padding: {top,right,bottom,left}` object; omission means four zeros. Padding sides are non-negative
  canvas-space lengths, paint inside the border box and interpolate independently.
- Different text content or fundamentally different typography is a different element identity. For
  fine visual alignment across checkpoints, keep alignment stable and adjust state `x`/`y`; do not
  redefine alignment as a per-slide nudge.
- Number requires `value`, the same typography text requires, and its complete formatting:
  `decimals`, `groupSeparator`, `decimalSeparator`, `symbol` and `symbolPosition`. It has no
  `content`: the rendered digits are derived from those fields and never stored.
- Number formatting is declared, never inherited from a locale. The document says which separators
  and how many decimals; hosts must not call a locale formatter, because the same document would
  then render different digits depending on the ICU version underneath it.
- `symbol` is an arbitrary short string — `%`, `$`, `USD`, `×`, `pts` — and `symbolPosition` places
  it `before` or `after` the digits. An empty `symbol` means the number renders alone; it is not an
  absent field.
- `animateMagnitude` belongs to the number's identity, not to its states, and declares one boolean
  per role: `{in, morph, out}`. Whether a number counts is a property of that number, decided once;
  what it counts to is the `value` on each slide.
- Shape requires `shapeFill`, `stroke` and `strokeWidth`; `cornerRadii` is optional only for
  rectangles, and line fill must be solid.
- Image requires declared `assetId`, `alt` and `fit`.
- Link button and icon states require their complete visual fields; renderer defaults never become
  hidden document semantics.
- Number and link-button ownership remain unchanged in codec v2. Number formatting is checkpoint
  state because its magnitude/format is authored per checkpoint; link-button label, URL and font
  ownership require a separate host/action migration and are intentionally outside this text-only
  codec step.
- Browser text measurements are renderer results and are not persisted in element states.
- A boundary is the pair of adjacent slides in `slides` order; the document stores no separate
  transition record. Reverse navigation compiles the same two slides in the opposite order.

## Motion

Motion is declared once per role and inherited. Every element plays exactly one of three roles at a
boundary: `in` when it is only on the second slide, `out` when it is only on the first, and `morph`
when it is on both.

```ts
interface MotionSpec {
  in: PresenceMotion;
  out: PresenceMotion;
  morph: MorphMotion;
}

interface PresenceMotion {
  animation:
    | { kind: "none" }
    | { kind: "fade" }
    | { kind: "slide"; edge: "left" | "right" | "top" | "bottom"; distance?: number }
    | { kind: "crop"; edge: "left" | "right" | "top" | "bottom" }
    | { kind: "wipe"; edge: "left" | "right" | "top" | "bottom" }
    | { kind: "scale"; from: number };
  durationBeats: number;
  delayBeats: number;
  delayMs: number;
  easing: Easing;
}

interface MorphMotion {
  animation: { kind: "morph" } | { kind: "cut" };
  durationBeats: number;
  delayBeats: number;
  delayMs: number;
  easing: Easing;
}
```

- `document.motion` is complete: every role declares every property. Resolution therefore never
  falls back to a value hidden inside a renderer.
- `slide.motion` and `state.motion` are partial patches. They are merged property by property, so a
  slide that only changes `in.easing` leaves `in.durationBeats` inherited.
- The resolution order is document, then slide, then the element state on that slide.
- `out` resolves from the slide the element leaves; `in` and `morph` resolve from the slide it
  arrives at.
- Duration is `floor(motionBeatMs * durationBeats + 0.5)`. `durationBeats: 0`, `{kind:"none"}` and
  `{kind:"cut"}` all produce an instant change.
- Delay is `floor(motionBeatMs * delayBeats + 0.5) + delayMs`. The two units add and neither replaces
  the other: `delayBeats` is musical, so one beat waits exactly as long as a one-beat animation
  lasts and a follow-on stays aligned when the deck's tempo changes; `delayMs` is absolute, for an
  offset that is about a specific instant rather than about the rhythm. Both default to zero.
- `slide` travels from (or towards) an edge. Without `distance` the element starts or ends
  completely outside the canvas; with one it travels exactly that many canvas units.
- `crop` travels the same way but inside the element's own rectangle, which acts as a mask. In role
  `in` the content starts displaced by the element's full extent along `edge` and arrives at rest;
  in role `out` it leaves the same way. The rectangle never moves and opacity is never touched, so
  the element reads as revealed from behind an invisible boundary rather than as flying in. It takes
  no `distance`: the travel is exactly the element's own width or height on that axis.
- `crop` clips for the duration of the animation regardless of the state's `overflowMode`, and
  releases the clip when it ends. The mask lives in the element's local space, so a rotated element
  crops along its own axis, not the canvas axis.
- `wipe` is the other half of the same idea and nothing moves at all: the element stays exactly where
  it is and the mask edge travels across it, uncovering it from `edge` in role `in` and covering it
  again in role `out`. It is a curtain opening, where `crop` is something sliding out from behind
  one. Like `crop` it takes no `distance`, never touches opacity, and clips in the element's own
  local space.
- A number whose identity enables `animateMagnitude` for the role being played also tweens its
  magnitude, using that role's resolved duration, delay and easing — the same curve that moves the
  element moves the digits. `in` counts up from zero to `value`, `out` counts down from `value` to
  zero, and `morph` counts from the value on the slide being left to the value on the slide being
  reached. Every frame is formatted with the state's own formatting fields, and the last frame is
  exactly `value`, never an interpolation residue.
- An instant change is instant for magnitude too: `durationBeats: 0`, `{kind:"none"}`, `{kind:"cut"}`
  and reduced-motion playback all show the final value immediately rather than counting quickly.
- `easing` is `"linear" | "ease-in" | "ease-out" | "ease-in-out"` or four cubic-bezier controls
  `[x1, y1, x2, y2]` with x between 0 and 1.

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
| Text content | 100,000 characters |
| Narration script | 100,000 characters |
| Narration pause before/after | 0 to 60,000 ms each |
| External URL | 2,048 Unicode scalar values |
| Canvas width | 320 to 16,384 px |
| Canvas height | 180 to 16,384 px |
| Canvas aspect ratio | between 1:4 and 4:1 |
| State x/y coordinate | -100,000 to 100,000 px |
| State width/height | 0.1 to 100,000 px |
| Rotation | -36,000 to 36,000 degrees |
| z-index | -100,000 to 100,000 |
| Motion delay | 0 to 60,000 ms |
| Motion duration | 0 to 8 beats |
| Motion delay | 0 to 16 beats |
| Slide distance | 0.1 to 100,000 px |
| Scale factor | 0.01 to 10 |
| Number value | -1,000,000,000,000 to 1,000,000,000,000, finite |
| Number decimals | 0 to 6 |
| Number symbol | 8 Unicode scalar values |
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
| Archive file | 95,000,000 bytes |
| One asset | 50,000,000 bytes |
| Total uncompressed | 90,000,000 bytes |
| Compression ratio | 100:1 for entries over 1 MiB |

Archive paths, symlinks, encryption, hashes, declared byte sizes and unreferenced entries are
validated before content is accepted. The embedded document independently remains subject to the
5,000,000-byte JSON bound.

## Universal image profile

Embedded images are PNG, JPEG, GIF or WebP up to 50,000,000 bytes, or canonical DEKS SVG up to
5,000,000 bytes. Core verifies raster signatures and dimensions from their binary headers instead
of trusting a filename or declared MIME type. Every image is at most 16,384 by 16,384 logical
pixels and 40,000,000 logical pixels in total.

DEKS SVG v1 is a deliberately static subset parsed as namespace-aware XML. It permits `svg`, `g`,
`defs`, `title`, `desc`, basic paths/shapes, linear/radial gradients, stops and clip paths. It rejects
DOCTYPE/entity declarations, processing instructions, non-SVG namespaces, duplicate IDs, unknown
elements or attributes, scripts, styles, `foreignObject`, nested images, `use`, rendered text,
fonts, SMIL, event handlers, classes, `xml:base`, `href`/`xlink:href` and external, `data:`, `blob:`
or `file:` references. Paint references use only `url(#id)`, must resolve to the right local resource
type and cannot form cycles.

SVGs are bounded to 10,000 elements, depth 64, 100,000 attributes and 2,000,000 aggregate path-data
characters. A finite positive `viewBox` is required; Core derives it from positive unitless/`px`
root width and height when absent. Canonical output is UTF-8 without an XML declaration, comments or
structural whitespace; it uses the default SVG namespace, a normalized `viewBox`, stable attributes,
canonical finite numbers and XML escaping. Creation normalizes before hashing. Reading rejects SVG
bytes that are safe but not already canonical so the manifest hash always names the canonical object.

## Universal audio profile

Embedded narration audio uses the same content-addressed asset registry and archive object paths as
images. One audio asset is at most 50,000,000 bytes and 10 minutes, has one or two channels, and uses
a sample rate from 8,000 through 48,000 Hz. Declared MIME types must match inspected bytes.

`audio/wav` is canonical RIFF/WAVE integer PCM with a 16-byte `fmt ` chunk followed immediately by
one non-empty `data` chunk. Core accepts 16-bit or 24-bit samples, validates byte rate and block
alignment, requires exact RIFF/chunk lengths, and allows only the required zero pad byte. This
deliberately small profile lets Web and Desktop record a consistent offline 24 kHz mono file without
a transcoding service.

`audio/mpeg` is a complete sequence of MPEG-1 Layer III frames. Core accepts mono or stereo and
32, 44.1 or 48 kHz frame rates, requires stable sample rate/channel mode, and rejects ID3 metadata,
reserved/free bitrate headers, truncated frames and trailing bytes. Bitrate may vary frame by frame.
The strict profile makes sniffing, hashing and cross-host validation deterministic; it is not a
general-purpose media decoder.

## Golden contract

- JSON Schema: `packages/document/src/schema/deks-document.schema.json` (package export `@deks-js/document/schema`)
- Golden document: `packages/document/tests/fixtures/deks-document.canonical.json`

Every package that reads or writes DEKS JSON must validate against the same document semantics and
exercise the golden document in contract tests.
