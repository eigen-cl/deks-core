# `@deks-js/renderer-core`

Renderer DOM imperativo y sin React.

```ts
const renderer = new RendererCore({ assetResolver, onOpenExternal });
renderer.mount(host);
renderer.renderSlide(document, slideId);
renderer.setViewportMode("presentation");
```

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
