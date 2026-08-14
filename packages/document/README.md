# `@deks-js/document`

Documento portable, validación y comandos deterministas de DEKS.

Exports principales:

- `DeksDocument` (`Deck` permanece como alias de compatibilidad).
- `assertDeksDocument`, `parseDeksDocumentJson`, `isHttpsUrl`, `asHttpsUrl`.
- `DeksCommand`, `applyDeksCommand`, `commandKind`.
- `DeksEditorChange` y `DeksEditorChangeHandler` para adaptadores de persistencia.
- `AssetResolver` y `DocumentStorage`; ambos son capacidades aportadas por el host.

Los comandos nunca hacen red ni conocen REST, cookies, filesystem o workspaces.
