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
import { DeksEditor, DeksPresenter } from "@deks/react";

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

## Paquetes previstos

| Paquete | Responsabilidad |
|---|---|
| `@deks/document` | Tipos, schema portable, validación y comandos puros |
| `@deks/renderer-core` | DOM/SVG/WAAPI sin framework y medición de layout |
| `@deks/react` | `DeksEditor`, `DeksPresenter` y adaptadores React |
| `@deks/pptx-export` | Exportación PPTX editable desde el documento portable |
| `@deks/mcp-local` | Servidor MCP local opcional sobre los mismos comandos tipados |

La separación detallada y el plan incremental están en
[`docs/architecture.md`](docs/architecture.md) y [`docs/extraction-plan.md`](docs/extraction-plan.md).

## Estado

Scope inicial. Todavía no se publican paquetes desde este repositorio.

## Licencia propuesta

Apache-2.0, por su permiso de uso comercial y concesión explícita de patentes. La licencia debe
confirmarse antes de mover y publicar el primer paquete.

