export { DeksPresentation } from "./presentation.js";
export { applyDeksCommand, applyDeksCommands, applyDeksTransaction, commandKind } from "./presentation-commands.js";
export {
  assertDeksDocument,
  DEKS_DOCUMENT_LIMITS,
  deksDocumentSchema,
  isSha256,
  parseDeksJson,
} from "./presentation-validation.js";
export {
  decodeDeksJson,
  DEKS_CODEC_VERSION,
  migrateDeksDocument,
} from "./codec-migration.js";
export type {
  DeksCodecMigrationResult,
  DeksCodecWarning,
} from "./codec-migration.js";
export {
  DEFAULT_MOTION,
  effectiveDelayMs,
  effectiveDurationMs,
  mergeMotion,
  MOTION_ROLES,
  resolveElementMotion,
  resolveSlideMotion,
} from "./motion.js";
export {
  createDeksFile,
  DEKS_ARCHIVE_LIMITS,
  DEKS_FILE_MEDIA_TYPE,
  readDeksFile,
} from "./file-format.js";
export {
  DEKS_IMAGE_LIMITS,
  DeksImageError,
  inspectAndNormalizeDeksImage,
  inspectDeksImage,
  normalizeDeksFileAssets,
  normalizeDeksSvg,
  sniffDeksImageMediaType,
} from "./image-assets.js";
export type {
  DeksImageAssetDescriptorSource,
  DeksImageErrorCode,
  DeksImageInspection,
  DeksImageMediaType,
  NormalizeDeksFileAssetsOptions,
} from "./image-assets.js";
export type {
  AddSlideOptions,
  ContinueElementOptions,
  CreateDeksPresentationOptions,
  DefineElementOptions,
  DeksAssetDescriptor,
  DeksAssetHandle,
  DeksAssetInput,
  DeksAssetRuntimeSource,
  DeksDocument,
  DeksElement,
  DeksElementHandle,
  DeksElementKind,
  DeksElementState,
  DeksSlide,
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
  DeksCommand,
  DeksCommandResult,
  InheritingMotionScope,
  MotionRolePatch,
  MotionScope,
  DeksEditorChange,
  DeksEditorChangeHandler,
  DeksEditorChangeKind,
  DeksEditorChangeResult,
} from "./presentation-commands.js";
export type { AssetByteProvider, DeksFile, DeksFileAsset, DeksFileAssetInput, ReadDeksFileResult } from "./file-format.js";
export { formatDeksNumber } from "./number-format.js";
export { DEFAULT_ANCHOR, reanchorElementState, resolveAnchor } from "./element-geometry.js";
export { asHttpsUrl, isHttpsUrl } from "./validation.js";
export { contrastRatio, isIconCatalog, isPaletteRecommendation } from "./visual-design.js";
export type { ContrastCheck, IconCatalog, IconDefinition, IconFamilyDescriptor, PaletteRecommendation } from "./visual-design.js";
export { getLucideIconData, isLucideIconName, lucideIconNames } from "./lucide-icons.js";
export type { LucideIconData, LucideIconNode, LucideSvgAttribute, LucideSvgTag } from "./lucide-icons.js";
export type {
  AnimateMagnitude,
  Anchor,
  AssetReference,
  AssetResolver,
  CornerRadii,
  DecimalSeparator,
  GroupSeparator,
  NumberFormat,
  SymbolPosition,
  DocumentStorage,
  Easing,
  EasingName,
  ElementKind,
  HttpsUrl,
  MorphAnimation,
  MorphMotion,
  MotionEdge,
  MotionPatch,
  MotionRole,
  MotionSpec,
  Palette,
  Padding,
  PresenceAnimation,
  PresenceMotion,
  ShapeFill,
  ShapeKind,
  SlideBackground,
} from "./types.js";
