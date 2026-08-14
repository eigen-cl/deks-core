# `@deks-js/render-preview`

Worker Node para obtener previews PNG fieles usando `@deks-js/renderer-core` dentro de Chromium.

El proceso acepta una solicitud JSON por línea en `stdin` y entrega una respuesta JSON por línea en
`stdout`. Mantiene un browser vivo, crea un contexto aislado por solicitud, bloquea toda la red y
resuelve únicamente assets raster entregados por el host. No acepta URLs ni paths arbitrarios.
