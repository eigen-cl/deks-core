# `@deks-js/react`

Componentes React portables de DEKS. El host debe importar una vez los estilos:

```tsx
import { DeksEditor, DeksPresenter } from "@deks-js/react";
import "@deks-js/react/styles.css";
```

## `DeksPresenter`

Mostrar una presentación es pasar el documento canónico y declarar el chrome que quieres:

```tsx
<DeksPresenter presentation={deksDocument} />
```

El comportamiento se declara por props; el host nunca reimplementa reproducción ni teclado.

| Prop | Tipo | Qué controla |
|---|---|---|
| `presentation` | `DeksDocument` | El documento a presentar. Única fuente de verdad. |
| `variant` | `"embedded" \| "immersive"` | `embedded` vive dentro de un layout; `immersive` llena su superficie. |
| `initialSlideId` | `string` | Slide inicial por identidad. Sin ella, abre en la primera. |
| `showControls` | `boolean` | Oculta la barra de controles para un preview decorativo o dirigido por el host. |
| `fullScreen` | `boolean` | Pantalla completa declarativa: entra al pasar a `true` y sale al volver a `false`. |
| `extraControls` | `ReactNode` | Controles propios del host dentro de la misma barra. |
| `onSlideChange` | `(slideId, index) => void` | Notifica cada cambio de checkpoint. |
| `onExit` | `() => void` | Agrega el control de salida. |
| `assetResolver` | `AssetResolver` | El host resuelve assets; Core nunca los descarga. |
| `onOpenExternal` | `(url: HttpsUrl) => void` | El host decide cómo abrir un enlace HTTPS. |

`document` sigue aceptándose como alias en desuso de `presentation` para no romper hosts existentes.

El handle expone `next`, `previous`, `goTo`, `requestFullscreen` y `exitFullscreen`. El fullscreen
nativo nunca ocurre al montar: requiere `fullScreen` explícito o una llamada del handle, porque el
navegador exige un gesto del usuario.

Cuando el renderer termina una transición ya deja el snapshot destino como autoridad; el adaptador
React conserva ese DOM y no vuelve a renderizar la misma slide al actualizar el índice.

## `DeksEditor`

`DeksEditor` acepta `document`, un único `onChange(change)` controlado, `storage`, `assetResolver`,
`extraControls` y `onExit`. Un rechazo (`false` o excepción) revierte la edición optimista. Esta versión
es el seam inicial y no afirma paridad con el `EditorSurface` avanzado que aún vive en `deks-web`.
