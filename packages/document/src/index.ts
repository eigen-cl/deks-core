export { applyDeksCommand, commandKind } from "./commands.js";
export { fromDeksV1Document, toDeksV1Document } from "./deks-v1.js";
export { DeksPresentation } from "./presentation.js";
export {
  applyDeksPresentationCommand,
  applyDeksPresentationCommands,
  applyDeksPresentationTransaction,
} from "./presentation-commands.js";
export {
  downgradeDeksPresentationToDocument,
  upgradeDeksDocumentToPresentation,
} from "./presentation-codec.js";
export {
  assertDeksPresentationDocument,
  deksPresentationSchema,
  isSha256,
  parseDeksPresentationJson,
} from "./presentation-validation.js";
export {
  createDeksFile,
  DEKS_FILE_MEDIA_TYPE,
  MAX_DEKS_ARCHIVE_FILES,
  MAX_DEKS_MANIFEST_BYTES,
  MAX_DEKS_UNCOMPRESSED_BYTES,
  readDeksFile,
} from "./file-format.js";
export type {
  DeksCommand,
  DeksEditorChange,
  DeksEditorChangeHandler,
  DeksEditorChangeKind,
  DeksEditorChangeResult,
} from "./commands.js";
export type {
  AddSlideOptions,
  ContinueElementOptions,
  CreateDeksPresentationOptions,
  DefineElementOptions,
  DeksAssetDescriptor,
  DeksAssetHandle,
  DeksAssetInput,
  DeksAssetRuntimeSource,
  DeksElementHandle,
  DeksPresentationDocument,
  DeksPresentationElement,
  DeksPresentationElementKind,
  DeksPresentationSlide,
  DeksPresentationState,
  DeksSlideHandle,
  PresentationAssetByteProvider,
  PresentationIdFactory,
  PresentationIdScope,
  PresentationStateDefaults,
  PresentationStateInput,
  PresentationStatePatch,
  SerializePresentationOptions,
} from "./presentation.js";
export type {
  DeksChangeSet,
  DeksPresentationCommand,
  DeksPresentationCommandResult,
} from "./presentation-commands.js";
export type {
  AssetByteProvider,
  DeksFile,
  DeksFileAsset,
  DeksFileAssetInput,
  ReadDeksFileResult,
} from "./file-format.js";
export { asHttpsUrl, assertDeksDocument, isHttpsUrl, MAX_DEKS_JSON_BYTES, parseDeksDocumentJson } from "./validation.js";
export { contrastRatio, isIconCatalog, isPaletteRecommendation } from "./visual-design.js";
export type {
  ContrastCheck,
  IconCatalog,
  IconDefinition,
  IconFamilyDescriptor,
  PaletteRecommendation,
} from "./visual-design.js";
export type {
  AssetReference,
  AssetResolver,
  Deck,
  DeksDocument,
  DocumentStorage,
  Easing,
  ElementKind,
  ElementState,
  ElementTransitionMotion,
  ElementTransitionOverride,
  HttpsUrl,
  MotionRatio,
  Palette,
  ShapeFill,
  ShapeKind,
  Slide,
  SlideBackground,
  SlidePreset,
  SlideTransition,
} from "./types.js";
