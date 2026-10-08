# Seguimiento Automatización

Tablero de Seguimiento Automatización y Seguimiento Polynator, publicado como aplicación web de Apps Script. Abrir y filtrar no consulta BigQuery: a las 7:00, hora de Bogotá, se lee una vez y el archivo queda en Drive.

El enlace que ya usa la gente es el de producción. La rama `dev` publica en otro proyecto de Apps Script, para probar. La pastilla DEV solo vive en `dev`.

## Qué va en cada rama

| Rama | Apps Script | Enlace |
|---|---|---|
| `dev` | proyecto de pruebas | el de desarrollo |
| `main` | el proyecto que ya está publicado | el mismo `/exec` de ahora |

Al hacer push, GitHub sube los archivos de `app/` y actualiza la implementación que ya existe. No crea un enlace nuevo.

Quien publica corre `setup()` una vez en el editor de cada proyecto. Eso crea la carpeta de Drive, deja el disparador de las 7:00 y hace la primera lectura.

## Secrets del repositorio

En Settings → Secrets and variables → Actions:

| Secret | Qué es |
|---|---|
| `CLASPRC` | contenido de `~/.clasprc.json` después de `clasp login` |
| `SCRIPT_ID_PROD` | ID del script de producción |
| `SCRIPT_ID_DEV` | ID del script de desarrollo |
| `DEPLOY_ID_PROD` | ID de la implementación web de producción (`AKfycb…`) |
| `DEPLOY_ID_DEV` | ID de la implementación web de desarrollo |

`CLASPRC` es una credencial. No se commitea.

## Archivos

`app/` es el proyecto de Apps Script. El servidor empieza por `Srv`. La página son los HTML. `index.html` los junta.

El conteo es `COUNT(nid)`. El porcentaje lo arma el navegador: Automático entre todos, y Polynator = Si entre todos.
