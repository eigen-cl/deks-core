# `@deks-js/renderer-core`

Renderer DOM imperativo y sin React.

```ts
const renderer = new RendererCore({ assetResolver, onOpenExternal });
renderer.mount(host);
renderer.renderSlide(document, slideId);
renderer.setViewportMode("presentation");
```

La misma instancia sirve al editor y al playback. El host puede aplicar y
revertir frames transitorios sin mutar el documento ni repintar la escena:

```ts
renderer.previewElements(nextSnapshots);
renderer.restoreElements(elementIds);
renderer.setSelection(elementIds);
renderer.setOnionSkin(previousSlide, { opacity: 0.24 });
```

`compileTransition()` conserva el contrato 4.0. `seek(milliseconds)`,
`setPlaybackRate(rate)`, `getPlaybackProgress()` y
`subscribePlaybackProgress(listener)` exponen el único reloj lógico, pero Web
Animations API sigue siendo propiedad imperativa del renderer. Los callbacks
del host no avanzan frames.

Al navegar a un índice anterior, `compileTransition(document, fromId, toId)` invierte
el borde original: una entrada se retira por el mismo recorrido y una salida reaparece
deshaciéndolo. También invierte los morphs, curvas y orden temporal. Los extremos
siempre se pasan en orden de reproducción, incluido un salto entre slides no adyacentes.
Para snapshots, que no incluyen el orden del documento, el host declara la dirección:

```ts
renderer.compileTransition(laterSnapshot, earlierSnapshot, { direction: "reverse" });
// La función pura compileTransition acepta la misma opción.
```

Omitir `direction` en la API de snapshots conserva la compilación hacia adelante.
El retroceso refleja cada delay respecto de la duración total del borde; los cortes
conservan su instante sin interpolación. Seek, pausa, velocidad y movimiento reducido
siguen usando el mismo reloj, sin cambiar el documento ni los presets de sus elementos.

`validateSnapshot()` valida el boundary portable y `iconSvgMarkup()` serializa
los íconos offline registrados para adaptadores compartidos, incluida la
exportación PPTX. Ninguno consulta la red.

Los enlaces HTTPS sólo se delegan a `onOpenExternal` en modo presentación. El renderer no abre
ventanas y no descarga assets. Las transiciones usan Web Animations API cuando existe y respetan
`prefers-reduced-motion`. La identidad estable de un elemento compila morphs geométricos; entradas,
salidas y cambios discretos usan presencia o crossfade según los presets, movimientos por elemento y
overrides del `SlideTransition` portable. React sólo inicia o interrumpe el playback: el renderer
imperativo es dueño de los frames.

Los rectángulos proyectan los cuatro valores canónicos de `cornerRadii` en orden top-left,
top-right, bottom-right y bottom-left.

Los cambios de fondo hacen crossfade entre capas para todas las combinaciones portables de sólido y
gradiente lineal. Usan la duración efectiva, delay y easing del beat de transición; con movimiento
reducido se aplica inmediatamente el fondo de destino. Un `renderSlide()` durante playback cancela
las capas transitorias y deja ese snapshot canónico como autoridad.

Codec v3 puede incluir narración por slide, pero este renderer sigue siendo estrictamente visual:
no carga, reproduce ni sincroniza audio. Esa política pertenece al host Web o Desktop.
