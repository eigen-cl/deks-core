# AGENTS.md — `deks-core`

## Propósito

Este repositorio contiene el núcleo open source y portable de DEKS. Debe poder usarse desde una
aplicación web, una aplicación desktop Tauri o un host de pruebas sin depender de DEKS Cloud.

## Límites

- No importar código de autenticación, workspaces, cuotas, billing ni clientes REST de DEKS Cloud.
- El documento portable es la fuente de verdad del núcleo; la persistencia pertenece al host.
- Las APIs públicas deben ser transport-agnostic y funcionar offline.
- `@deks-js/renderer-core` no depende de React.
- React envuelve el núcleo; no contiene reglas de dominio duplicadas.
- Los enlaces externos nunca se ejecutan en modo edición. El host decide cómo abrirlos mediante un
  callback explícito y debe restringirlos a `https:`.
- El modo inmersivo dentro de una pestaña y Fullscreen API son estados distintos.
- Respetar `prefers-reduced-motion`, navegación por teclado y objetivos táctiles de 44 px.

## Calidad

- Escribir primero pruebas de contrato e integración.
- Mantener TypeScript estricto y exports públicos documentados.
- Cambios incompatibles requieren un ADR y una versión mayor.
- No publicar paquetes ni tags desde una rama sin CI verde.
