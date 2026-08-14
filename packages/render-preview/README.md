# `@deks-js/render-preview`

Worker Node para obtener previews PNG fieles usando `@deks-js/renderer-core` dentro de Chromium.

El proceso acepta una solicitud JSON por línea en `stdin` y entrega una respuesta JSON por línea en
`stdout`. Mantiene un browser vivo, crea un contexto aislado por solicitud, bloquea toda la red y
resuelve únicamente assets raster entregados por el host. No acepta URLs ni paths arbitrarios.

Cada respuesta exitosa incluye `layout_measurements` para todos los elementos. Los rectángulos se
expresan en coordenadas canónicas del canvas; los textos agregan límites y estado de overflow medidos
por Chromium después de cargar fuentes, imágenes y dos frames de layout.
