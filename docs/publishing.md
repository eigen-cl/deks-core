# Publicación de paquetes npm

`deks-core` publica desde GitHub Actions mediante npm Trusted Publishing (OIDC). No se almacena un
`NPM_TOKEN` en el repositorio ni en los secretos de GitHub.

## Bootstrap único

npm sólo permite asociar un Trusted Publisher después de que el paquete exista. El job `publish`
permanece bloqueado mientras la variable pública del repositorio
`NPM_TRUSTED_PUBLISHING_READY` no sea exactamente `true`; el job `verify` siempre se ejecuta.

Secuencia segura:

1. Mantener `NPM_TRUSTED_PUBLISHING_READY` sin crear y hacer push del workflow a `main`. CI debe
   dejar `verify` verde y mostrar `publish` como omitido.
2. Desde ese mismo commit validado, realizar la primera publicación manual —o mediante staged
   publishing si se habilita explícitamente— con 2FA y en orden:

```bash
npm publish --workspace @deks-js/document --access public
npm publish --workspace @deks-js/renderer-core --access public
npm publish --workspace @deks-js/react --access public
npm publish --workspace @deks-js/render-preview --access public
```

3. En **Settings → Trusted Publisher** de cada paquete en npm, registrar:

| Campo | Valor |
|---|---|
| Proveedor | GitHub Actions |
| Organization or user | `eigen-cl` |
| Repository | `deks-core` |
| Workflow filename | `publish-npm.yml` |
| Environment | vacío |
| Allowed actions | `npm publish` |

El nombre del workflow distingue mayúsculas y minúsculas y se configura sólo como nombre de archivo,
no como `.github/workflows/publish-npm.yml`.

4. Crear la variable de repositorio de GitHub Actions `NPM_TRUSTED_PUBLISHING_READY` con valor exacto
   `true` sólo después de configurar los cuatro Trusted Publishers.
5. Incrementar una versión y hacer push a `main` para comprobar OIDC. Un valor ausente, `false` o con
   otra capitalización mantiene `publish` omitido sin impedir que `verify` termine.

Una vez comprobado OIDC, configurar **Publishing access** como “Require two-factor authentication and
disallow tokens”. Trusted Publishing seguirá funcionando porque usa credenciales OIDC efímeras, no
tokens tradicionales.

## Flujo normal

Cada pull request hacia `main` ejecuta `verify` sin permisos OIDC y nunca ejecuta `publish`. Esto
permite exigir CI verde antes de integrar o crear un tag estable.

Cada push a `main`:

1. instala con `npm ci`;
2. instala con el binario Playwright fijado en el lockfile el Chromium compatible y sus dependencias;
3. ejecuta `npm run verify`: compila, prueba, valida TypeScript y corre el contrato real de Chromium;
4. si el gate público está activo, descarga el artifact validado en un job separado con OIDC;
5. consulta cada `name@version` en el registro público;
6. omite las versiones que ya existen;
7. publica las versiones ausentes en orden `document → renderer-core → react → render-preview`.

Para liberar un cambio se incrementa la versión del paquete correspondiente antes de integrar a
`main`. Un push sin versiones nuevas termina correctamente sin volver a publicar. Los errores de red,
respuestas inesperadas del registro o un fallo de publicación detienen el job.

## Versiones del release `v1.0.0`

| Paquete | Versión | Motivo |
|---|---:|---|
| `@deks-js/document` | `1.0.0` | Contrato JSON canónico único y normalizado. |
| `@deks-js/renderer-core` | `1.0.0` | Consume `DeksDocument` y proyecta snapshots sólo en runtime. |
| `@deks-js/react` | `1.0.0` | Consume el document y renderer actualizados mediante pins exactos. |
| `@deks-js/render-preview` | `1.0.0` | Valida y renderiza directamente el documento canónico. |

Los consumidores internos usan versiones exactas. React y Render Preview dependen de
`@deks-js/renderer-core@1.0.0`, por lo que npm no puede resolver silenciosamente otro renderer.

Trusted Publishing requiere un runner hospedado por GitHub, Node 24, npm 11.5.1 o superior y el
permiso `id-token: write`. npm genera la procedencia automáticamente para paquetes públicos publicados
desde un repositorio público.
