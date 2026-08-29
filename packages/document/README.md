# @deks-js/document

Contrato portable y offline de DEKS.

- `DeksDocument`: único JSON canónico normalizado.
- `assertDeksDocument`, `parseDeksJson` y `deksDocumentSchema`: validación defensiva y schema
  exhaustivo, también disponible como `@deks-js/document/schema`.
- `DeksPresentation`: fachada scripteable que produce el mismo documento.
- `DeksCommand`, batches/transacciones y `DeksChangeSet`: edición pura por revisión.
- Grupos lógicos nombrados mediante identidades `kind: "group"` y `parentId`, sin transformar la
  geometría absoluta de sus miembros. `effectiveGroupId`, `areElementsCollisionCandidates` y el
  filtro indexado `createElementCollisionCandidatePredicate` permiten omitir del análisis de
  colisiones a miembros del mismo grupo efectivo. `update-element-identity` usa `parentId: null`
  para desagrupar y elimina el campo del documento resultante.
- `createDeksFile`/`readDeksFile`: contenedor `.deks` determinista, content-addressed y sin
  dependencia de filesystem.
- `DeksSlideNarration`, `set-slide-narration` y `clear-slide-narration`: guion y pausas portables,
  con referencia opcional a audio incrustado y procedencia humana o sintética.
- `inspectDeksImage`/`normalizeDeksSvg` y `DEKS_IMAGE_LIMITS`: una frontera portable para PNG,
  JPEG, GIF, WebP y el perfil SVG seguro y canónico de DEKS.
- `sniffDeksImageMediaType`/`inspectAndNormalizeDeksImage`: detección por bytes, normalización y
  errores estables que Web, Desktop y sus adaptadores pueden traducir a su propia interfaz.
- `inspectDeksAudio`/`inspectAndNormalizeDeksAudio`, `sniffDeksAudioMediaType` y
  `DEKS_AUDIO_LIMITS`: inspección determinista para PCM RIFF/WAV canónico y MPEG-1 Layer III.
- `inspectAndNormalizeDeksAsset`: dispatcher portable único para imágenes y audio sin confiar en
  extensiones de archivo.
- `normalizeDeksFileAssets`: verifica que los bytes entregados por un host correspondan exactamente
  a los assets `embedded` declarados por el documento sin persistir metadata del host.

El inspector recorre el contenedor raster completo: exige IEND/EOI/trailer y longitudes RIFF
coherentes, cuenta APNG `fcTL`, GIF image descriptors y WebP `ANMF`, y limita cada imagen a 200
frames y 100 MP agregados además de 40 MP por frame. Es una validación portable de estructura; el
host Cloud decodifica además los píxeles con Pillow antes de persistirlos.

JSON es la fuente de verdad. Tablas relacionales, archivos, estado React y snapshots del renderer
son proyecciones. Los hosts resuelven assets y persistencia sin agregar campos al documento.

La narración vive en la slide, no en el renderer visual. Core conserva sólo el guion, pausas,
referencia content-addressed y procedencia; elección de voz, proveedor, consentimiento, generación,
reproducción y sincronización pertenecen a Web o Desktop.

El SVG aceptado se parsea como XML con namespaces, nunca mediante regex o DOM. Core elimina la
superficie activa (scripts, estilos, eventos, referencias externas, texto renderizado, fuentes,
SMIL e imágenes anidadas), limita complejidad y produce UTF-8 determinista antes de calcular el
hash del asset. Al leer un `.deks`, los SVG deben contener exactamente esos bytes canónicos.

Apache-2.0.
