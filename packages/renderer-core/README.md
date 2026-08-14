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
