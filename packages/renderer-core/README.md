# `@deks-js/renderer-core`

Renderer DOM imperativo y sin React.

```ts
const renderer = new RendererCore({ assetResolver, onOpenExternal });
renderer.mount(host);
renderer.renderSlide(toSlideSnapshot(slide, canvas));
renderer.setViewportMode("presentation");
```

Los enlaces HTTPS sólo se delegan a `onOpenExternal` en modo presentación. El renderer no abre
ventanas y no descarga assets. Las transiciones usan Web Animations API cuando existe y respetan
`prefers-reduced-motion`.

Los cambios de fondo hacen crossfade entre capas para todas las combinaciones portables de sólido y
gradiente lineal. Usan la duración efectiva, delay y easing del beat de transición; con movimiento
reducido se aplica inmediatamente el fondo de destino.
