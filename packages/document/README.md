# @deks-js/document

Contrato portable y offline de DEKS.

- `DeksDocument`: único JSON canónico normalizado.
- `assertDeksDocument`, `parseDeksJson` y `deksDocumentSchema`: validación defensiva y schema
  exhaustivo, también disponible como `@deks-js/document/schema`.
- `DeksPresentation`: fachada scripteable que produce el mismo documento.
- `DeksCommand`, batches/transacciones y `DeksChangeSet`: edición pura por revisión.
- `createDeksFile`/`readDeksFile`: contenedor `.deks` determinista, content-addressed y sin
  dependencia de filesystem.

JSON es la fuente de verdad. Tablas relacionales, archivos, estado React y snapshots del renderer
son proyecciones. Los hosts resuelven assets y persistencia sin agregar campos al documento.

Apache-2.0.
