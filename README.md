# DEKS Core

El núcleo open source para crear y presentar archivos DEKS en web y desktop.

Este repositorio será el dueño de los componentes portables que hoy viven dentro de
[`deks-web`](https://github.com/eigen-cl/deks-web). DEKS Cloud seguirá siendo un producto separado:
autenticación, workspaces, colaboración, cuotas, publicación y persistencia remota no pertenecen a
este repositorio.

## API objetivo

La API evita un booleano `presentationMode`, porque no expresa la diferencia entre un reproductor
embebido, uno que ocupa la pestaña y el Fullscreen API del navegador.

```tsx
import { DeksEditor, DeksPresenter } from "@deks-js/react";

<DeksEditor
  document={deck}
  onChange={saveLocally}
  assetResolver={resolveAsset}
/>

<DeksPresenter
  document={deck}
  variant="immersive"
  extraControls={<ShareActions />}
  onOpenExternal={(url) => openExternal(url)}
/>
```

`variant="embedded"` conserva el layout del host. `variant="immersive"` ocupa el viewport de la
pestaña con `100dvh`. Entrar al Fullscreen API es una acción separada y siempre nace de un gesto del
usuario.

## Paquetes publicados en este release

| Paquete | Responsabilidad |
|---|---|
| `@deks-js/document` | Tipos, schema portable, validación y comandos puros |
| `@deks-js/renderer-core` | DOM/SVG/WAAPI sin framework y medición de layout |
| `@deks-js/react` | `DeksEditor`, `DeksPresenter` y adaptadores React |
| `@deks-js/render-preview` | Worker Node/Chromium sin red para previews PNG de QA visual |

La exportación PPTX y el MCP local siguen siendo adaptadores de los hosts hasta que tengan un
contrato portable y una implementación propia dentro de este workspace.

`@deks-js/document` también publica contratos para catálogos de íconos offline y recomendaciones de
paleta con roles semánticos y contraste verificable. El contrato del siguiente elemento nativo y su
subtipo relacional está especificado en [`docs/icon-element-slice.md`](docs/icon-element-slice.md).

La separación detallada y el contrato canónico están en
[`docs/architecture.md`](docs/architecture.md) y [`docs/Specification.md`](docs/Specification.md).

## Estado

Primer núcleo importable:

- `@deks-js/document` contiene el único `DeksDocument` JSON canónico, validación defensiva,
  JSON Schema exhaustivo, archivos `.deks` y comandos puros.
- `@deks-js/renderer-core` pinta HTML/SVG-compatible DOM de manera imperativa, delega assets/URLs al host
  y comparte un único renderer para preview transitorio, onion skin, seek y playback observable.
- `@deks-js/react` expone `DeksPresenter` real y un primer `DeksEditor` controlado sobre esos comandos.
- `@deks-js/render-preview` reutiliza ese renderer con fuentes locales, un browser persistente y un
  contexto aislado por render.

El primer `DeksEditor` extraído permite navegar y crear slides, crear texto, seleccionar y renombrar
elementos, y aceptar/rechazar persistencia con rollback. Todavía **no reemplaza** la superficie visual
completa de `deks-web`: timeline, inspector avanzado, drag/resize, PPTX, validación de layout y actividad
Cloud siguen en el repositorio web hasta desacoplar `EditorSurface` de `ApiDeckClient` conservando su
suite de integración.

La especificación y el ADR del contrato están en [`docs/Specification.md`](docs/Specification.md) y
[`docs/adr/0001-canonical-deks-document.md`](docs/adr/0001-canonical-deks-document.md). El fixture
compartible con API/Web vive en `packages/document/tests/fixtures/deks-document.canonical.json`.

## Desarrollo

Todas las verificaciones se ejecutan con Docker:

```bash
docker compose run --rm --build core npm run verify
```

La imagen de desarrollo fija Playwright `1.62.1` e incluye su Chromium compatible. `verify` compila,
ejecuta los contratos unitarios y de release, valida TypeScript y finalmente prueba el preview dentro
de Chromium real. El mismo gate corre antes de publicar cualquier artifact npm.

Para producir artefactos instalables sin publicar ni acoplar repositorios mediante `file:../...`:

```bash
docker compose run --rm core npm run pack:local
```

Los `.tgz` quedan ignorados bajo `artifacts/`. Durante desarrollo, un consumidor puede fijar esos
artefactos o descargarlos desde CI; no debe depender de la ruta relativa de otro checkout.

La publicación automática usa npm Trusted Publishing sin tokens persistentes y publica únicamente
versiones nuevas después de validar el workspace. El bootstrap y la configuración por paquete están en
[`docs/publishing.md`](docs/publishing.md).

## Licencia

Apache-2.0.
