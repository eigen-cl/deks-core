# `@deks-js/react`

Componentes React portables de DEKS. El host debe importar una vez los estilos:

```tsx
import { DeksEditor, DeksPresenter } from "@deks-js/react";
import "@deks-js/react/styles.css";
```

`DeksPresenter` acepta `embedded` o `immersive`, controles del host, navegación anterior/siguiente,
assets resueltos por el host y apertura externa HTTPS delegada. Su handle expone `next`, `previous`,
`goTo` y `requestFullscreen`; fullscreen nativo nunca ocurre al montar.

`DeksEditor` acepta `document`, un único `onChange(change)` controlado, `storage`, `assetResolver`,
`extraControls` y `onExit`. Un rechazo (`false` o excepción) revierte la edición optimista. Esta versión
es el seam inicial y no afirma paridad con el `EditorSurface` avanzado que aún vive en `deks-web`.
