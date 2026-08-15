# `@deks-js/document`

Documento portable, validación y comandos deterministas de DEKS.

Exports principales:

- `DeksPresentation` y `DeksPresentationDocument`: fachada scripteable y formato canónico v2 con
  registros normalizados de identidades y assets.
- `DeksDocument` (`Deck` permanece como alias de compatibilidad).
- `assertDeksDocument`, `parseDeksDocumentJson`, `isHttpsUrl`, `asHttpsUrl`.
- `DeksCommand`, `applyDeksCommand`, `commandKind`.
- `DeksPresentationCommand`, batches/transacciones, `DeksChangeSet` y validación v2 estricta.
- Codecs v1/v2 y `createDeksFile`/`readDeksFile` para contenedores `.deks` sin filesystem.
- `DeksEditorChange` y `DeksEditorChangeHandler` para adaptadores de persistencia.
- `AssetResolver` y `DocumentStorage`; ambos son capacidades aportadas por el host.

Los comandos nunca hacen red ni conocen REST, cookies, filesystem o workspaces.
Los `Blob`/`Uint8Array` viven sólo durante la ejecución; JSON persiste descriptores. URLs remotas
deben ser HTTPS. Un host que crea una URL `blob:` para el renderer también es dueño de revocarla.
