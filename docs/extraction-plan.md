# Plan de extracción desde `deks-web`

La extracción debe conservar comportamiento y permitir rollback. No se hará un big bang ni se
moverá el shell SaaS.

## Fase 0 — estabilizar fronteras en `deks-web`

- [ ] Consolidar el documento y su schema fuera de `apps/web`.
- [ ] Hacer que renderer, editor y exportador consuman un único paquete de tipos.
- [ ] Introducir `DeksPresenter` con variantes `embedded` e `immersive`.
- [ ] Inyectar resolución de assets y apertura de enlaces.
- [ ] Eliminar imports desde packages hacia `apps/web`.
- [ ] Añadir tests de contrato del documento y fixtures `.deks.json` compartidos.

Condición de salida: los packages actuales compilan y pasan sus tests sin importar el shell web.

## Fase 1 — mover con historia

- [ ] Mover `packages/renderer-core`.
- [ ] Extraer tipos, validadores y comandos puros a `packages/document`.
- [ ] Mover `packages/editor-react` y renombrar su API pública a `@deks/react`.
- [ ] Mover `packages/pptx-export` después de aislar su dependencia vulnerable de imágenes.
- [ ] Preservar historia con `git filter-repo` o subtree split y documentar los SHAs de origen.

Condición de salida: CI de `deks-core` reproduce las suites del repositorio de origen.

## Fase 2 — consumir desde la app

- [ ] Publicar versiones prerelease (`0.x`) con provenance.
- [ ] Reemplazar workspaces internos de `deks-web` por versiones fijadas.
- [ ] Mantener adaptadores Cloud dentro de `deks-web`.
- [ ] Ejecutar tests de compatibilidad sobre ejemplos y exports históricos.

Condición de salida: `deks-web` no mantiene forks locales de packages core.

## Fase 3 — desktop Tauri

- [ ] Crear shell Tauri separado.
- [ ] Implementar storage atómico de `.deks`, recientes y recuperación.
- [ ] Integrar `DeksEditor` y `DeksPresenter` sin endpoints Cloud.
- [ ] Añadir `@deks/mcp-local` y flujo explícito de instalación/desinstalación por cliente.
- [ ] Firmar, notarizar y actualizar por canales antes de distribuir públicamente.

## Compatibilidad

- El formato `.deks` mantiene versionado independiente de los paquetes npm.
- Lectura compatible hacia atrás dentro de una versión mayor del formato.
- Migraciones de documento son puras, deterministas y testeadas con fixtures.
- Ningún cambio de paquete reescribe archivos del usuario silenciosamente.

## No objetivos iniciales

- Colaboración realtime.
- Persistencia Cloud o sincronización de cuentas.
- Marketplace propio de templates/plugins.
- Ejecutar agentes dentro del proceso renderer de Tauri.
- Permitir JavaScript, HTML o URLs arbitrarias dentro de una presentación.

