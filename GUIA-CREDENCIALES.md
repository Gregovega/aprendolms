# GUÍA DE CREDENCIALES — APRENDO LMS

Todo lo que necesitas conseguir, dónde encontrarlo y cómo activarlo.
Las credenciales se activan con **un solo comando** y el script te avisa si algo está mal.

---

## 0. Antes de empezar: lo que ya revisé en tu equipo

| Elemento | Estado | Qué implica |
|---|---|---|
| Carpeta del proyecto | ✅ Desbloqueada | Tenía un permiso de Windows roto; ya está reparado |
| Prompt maestro | ✅ Leído | `PROMT DEL PROYECTO.docx` — arquitectura completa entendida |
| Node.js | ✅ v24.15.0 | Listo para construir |
| npm | ✅ 11.12.1 | Listo |
| **Git** | ❌ **No instalado** | Hace falta para subir a GitHub |
| **winget** | ❌ Roto | No sirve para instalar Git; hay que bajarlo manual |
| **PowerShell** | ⚠️ 5.1 | No tienes PS7; la guía ya lo tiene en cuenta |
| Política de ejecución | ⚠️ Bloquea `.ps1` | **Por eso existe `set-credentials.cmd`** |
| MCP Supabase | ⚠️ Apunta a **otro proyecto** | Ver la alerta de abajo |
| MCP Cloudflare | ❌ Desconectado | Se vinculará cuando toque el dominio |

> ### 🚨 Alerta importante sobre Supabase
>
> Ahora mismo tengo conectado un servidor de Supabase que apunta al proyecto **COMARCA**
> (`uobznyiquvhfqupvacdp.supabase.co`) y otro a `psldbnrvhjoajhepiwdj.supabase.co`.
> **Ninguno es APRENDO LMS.**
>
> Esto significa que **NO voy a crear tablas por MCP todavía**: escribiría dentro del
> proyecto equivocado y podría dañar COMARCA. Hasta que crees el proyecto nuevo y me
> pases sus datos, el trabajo de base de datos queda en espera. Es una protección, no un atraso.

---

## 1. SUPABASE — el backend (autenticación + progreso + cursos)

Necesitas **2 datos**. No necesitas la base de datos creada todavía: el script crea luego las tablas.

### Paso 1 — Crear el proyecto
1. Entra en <https://supabase.com> y crea la cuenta.
2. **New project**.
3. Rellena:
   - **Name:** `aprendo-lms`
   - **Database Password:** genera una fuerte y **guárdala** en tu gestor de contraseñas
     (no la necesito para el frontend, pero la necesitarás tú).
   - **Region:** la más cercana a tu público (`East US` suele ir bien para Venezuela/LatAm).
4. **Create new project** y espera ~2 minutos a que aprovisione.

### Paso 2 — Copiar el Project URL
1. En el menú lateral baja hasta **Project Settings** (el engranaje).
2. Entra en **Data API** *(en paneles antiguos se llama «API»)*.
3. Copia **Project URL**. Tiene esta forma exacta:
   ```
   https://abcdefghijklmnopqrst.supabase.co
   ```
   Son 20 letras minúsculas antes de `.supabase.co`.

### Paso 3 — Copiar la clave pública
1. En **Project Settings**, entra en **API Keys** *(en paneles antiguos, dentro de «API»)*.
2. Verás dos familias de claves. **Usa la pública:**
   - **Nueva generación:** `Publishable key` → empieza por `sb_publishable_`
   - **Antigua:** `anon` `public` → es un texto largo que empieza por `eyJ`

   Cualquiera de las dos sirve.
3. **NO copies la `service_role` / `Secret key`** para el frontend. Esa clave se salta todas
   las reglas de seguridad y da control total de la base de datos.

> ✅ **Tranquilidad:** la `anon`/`publishable` key es **pública a propósito**. Está diseñada
> para ir dentro del navegador del alumno y va protegida por las políticas **RLS** de Supabase.
> Por eso sí se sube a GitHub Pages. Lo que nunca se sube es la `service_role`.
>
> 🛡️ El script **detecta automáticamente** si pegas la `service_role` por error, se niega a
> guardar y te lo explica. Ya lo probé y funciona.

---

## 2. GITHUB — el repositorio y GitHub Pages

### Paso 1 — Crear el repositorio
1. Entra en <https://github.com/new>.
2. **Repository name:** `aprendo-lms`
3. **Public** (GitHub Pages gratis solo funciona en repos públicos).
4. **NO** marques "Add a README" — la carpeta ya tiene archivos.
5. **Create repository**.
6. Anota el nombre en formato `usuario/repositorio`, por ejemplo `gregorio/aprendo-lms`.

### Paso 2 — Crear el token (solo si subo yo los archivos)
Si prefieres subir tú los archivos arrastrándolos a la web de GitHub, **sáltate este paso**.

1. Clic en tu foto (arriba a la derecha) → **Settings**.
2. Menú lateral, al final: **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. Rellena:
   - **Token name:** `aprendo-lms-cli`
   - **Expiration:** 90 días (o lo que te resulte cómodo)
   - **Repository access:** *Only select repositories* → elige `aprendo-lms`
   - **Permissions** → *Repository permissions*:
     - **Contents:** `Read and write` ← imprescindible
     - **Workflows:** `Read and write` ← solo si usaremos GitHub Actions
5. **Generate token** y **copia el token** (empieza por `github_pat_`).
   ⚠️ GitHub solo lo muestra una vez.

---

## 3. WISTIA — los videos

### Lo más importante que debes saber
Hay **dos cosas distintas** y solo una necesita token:

| Uso | ¿Necesita token? | Para qué |
|---|---|---|
| **Reproductor** en la página del curso | ❌ **No** | Es la Player API de JavaScript. El código embed + `percentwatchedchanged` funcionan solos, sin token. |
| **Gestionar la videoteca** (subir, listar, borrar videos por código) | ✅ Sí | Es la Data API, y es **secreta**. |

**Conclusión práctica:** el desbloqueo secuencial de lecciones y el guardado de progreso
—que es el corazón del prompt maestro— **no necesitan la API de Wistia en absoluto**.
Solo necesitas pegar el código embed de cada video en el panel de administración, tal como
dice el prompt.

El token solo sirve si más adelante quieres automatizar la subida de videos desde un script.
Es un extra opcional, no un requisito para arrancar.

### Dónde está el token
1. Entra en <https://wistia.com> y crea la cuenta.
2. Clic en tu avatar → **Account Settings**.
3. Busca **API Access** *(a veces aparece bajo «Integrations» o «Developer»)*.
4. **Create a new token** / **New API Token**.
5. Ponle nombre `aprendo-lms` y marca el permiso de **lectura y escritura** de `Projects` y `Medias`
   si quieres gestionar videos; solo lectura basta para listar.
6. Copia el token: es una cadena **hexadecimal** larga (unos 64 caracteres).

### El dato que sí necesitas siempre: el ID de video
En Wistia, entra al video → el **ID** aparece en la URL y en el panel de detalles
(es una cadena corta alfanumérica de 10 caracteres). Ese ID es el que usa la Player API
para saber a qué video engancharse.

---

## 4. CLOUDFLARE — dominio y CDN

Puedes dejarlo para el final: **no hace falta para empezar a desarrollar**. Solo se necesita
cuando vayas a publicar con tu dominio propio y los subdominios por curso
(`ventadechicha.tudominio.com`).

### API Token
1. Entra en <https://dash.cloudflare.com>.
2. Clic en tu avatar → **My Profile**.
3. **API Tokens** → **Create Token**.
4. Usa la plantilla **Edit zone DNS**, o crea uno personalizado con:
   - **Permissions:** `Zone` → `DNS` → **Edit**
   - **Permissions:** `Zone` → `Zone` → **Read**
   - **Zone Resources:** incluye tu dominio
5. **Continue to summary** → **Create Token** y cópialo.

### Zone ID
1. En el panel principal, entra en tu **dominio**.
2. En la columna derecha, dentro de **Overview**, busca **Zone ID**.
3. Es una cadena de **32 caracteres hexadecimales**. Cópiala.

---

## 5. ACTIVAR TODO (un solo comando)

Abre PowerShell **en la carpeta del proyecto** y ejecuta. El `.cmd` se encarga del bloqueo
de política de ejecución, así que no tienes que tocar la configuración de tu equipo.

```powershell
cd "G:\Documents\a PROYECTOS AUTOMATIZACIONES\APRENDO LMS"
```

### Paso 1 — Activar Supabase (lo mínimo para arrancar)
```powershell
.\_tools\set-credentials.cmd `
  -SupabaseUrl     "https://TU-PROYECTO.supabase.co" `
  -SupabaseAnonKey "TU-ANON-KEY" `
  -AcademyName     "Nombre de tu Academia"
```

Qué hace ese comando:
1. **Valida el formato** de la URL y de la clave.
2. **Detecta** si pegaste la `service_role` y aborta.
3. Escribe `.env` (privado, ignorado por Git).
4. **Genera `assets/js/config.js`** — el archivo público que lee el frontend.
5. **Prueba de verdad contra Supabase** y te dice si la URL y la clave responden.

### Paso 2 — Añadir Wistia y GitHub
```powershell
.\_tools\set-credentials.cmd `
  -WistiaApiToken  "tu-token-hexadecimal" `
  -GithubRepo      "usuario/aprendo-lms" `
  -GithubToken     "github_pat_..."
```
Se puede ejecutar las veces que quieras: **fusiona** con lo que ya había, no borra nada.

### Paso 3 — Comprobar en cualquier momento
```powershell
.\_tools\set-credentials.cmd -Show       # estado enmascarado, sin exponer secretos
.\_tools\set-credentials.cmd -TestOnly   # revalida y vuelve a probar la conexión
```

---

## 6. Qué queda en la carpeta y qué NO se sube a GitHub

```
APRENDO LMS\
├─ .env                    ← 🔒 PRIVADO: tus secretos. Git lo ignora.
├─ .env.example            ← plantilla con instrucciones de cada campo
├─ .gitignore              ← protege .env
├─ assets\js\config.js     ← 🌐 PÚBLICO: URL + anon key. Se sube, es correcto.
├─ supabase\
│  └─ 001_esquema_inicial.sql  ← el esquema de la base de datos
└─ _tools\
   ├─ set-credentials.ps1  ← el motor de activación
   ├─ set-credentials.cmd  ← el lanzador (evita el bloqueo de política)
   ├─ push.ps1             ← publica en GitHub de forma segura
   ├─ push.cmd             ← su lanzador
   └─ dump_docx.py         ← utilidad para leer documentos Word
```

**La regla que nunca se rompe:**

| Archivo | ¿A GitHub? | Por qué |
|---|---|---|
| `.env` | ❌ **Nunca** | Lleva la `service_role` y el token de Wistia |
| `assets/js/config.js` | ✅ Sí | Solo lleva la `anon` key, que es pública y está protegida por RLS |

Si algún día el token de Wistia se filtra, se revoca en Wistia y se genera otro. No pasa nada grave
mientras esté en `.env` y `.env` nunca salga de tu equipo.

---

## 7. Estado del equipo (ya resuelto)

### ✅ Git instalado
`git version 2.56.0.windows.2`, en `C:\Users\Gregorio\git-portable`.

Se instaló de forma **portátil**, es decir:
- **no** pide administrador,
- **no** toca `Program Files`,
- **no** escribe en el registro (salvo la entrada del PATH),
- se desinstala borrando esa única carpeta.

Quedó añadido a tu **PATH de usuario**, así que en cualquier terminal nueva el comando
`git` ya funciona. Abre una ventana nueva para que lo tome.

### Token de GitHub (fine-grained)

El token es la "llave" que autoriza subir archivos. Se crea así:

1. Entra en <https://github.com/settings/personal-access-tokens/new>
2. **Token name:** `aprendo-lms-cli`
3. **Expiration:** 90 días
4. **Repository access:** *Only select repositories* → elige **`Gregovega/aprendolms`**
   ⚠️ Esto es clave: el token solo sirve para ESE repositorio. No puede tocar otros.
5. **Repository permissions:**
   - **Contents:** `Read and write` ← imprescindible
   - (`Metadata: Read-only` se marca sola, es obligatoria)
6. **Generate token** y copia el valor. Empieza por `github_pat_`.
   GitHub solo lo muestra una vez.

### Publicar

Abre una **terminal nueva** y ejecuta **un solo comando**:

```powershell
cd "G:\Documents\a PROYECTOS AUTOMATIZACIONES\APRENDO LMS"
.\_tools\publicar.cmd
```

Te pedira el token y hara todo lo demas. No se ve al pegarlo y no queda en el
historial de PowerShell.

OJO: el token NO se pasa a `push.cmd`. Ese script solo publica; lee el token de `.env`.

`push.ps1` hace cuatro comprobaciones antes de subir nada:
1. Valida el token contra la API de GitHub.
2. Confirma que el token **ve** el repositorio y tiene permiso de escritura.
3. **Aborta si `.env` está rastreado** — tus secretos jamás se publican.
4. Comprueba que el remoto no tenga cambios que tú no tengas, y **nunca hace
   force-push**: si hay conflicto, se detiene y te dice qué hacer.

El token se guarda **solo en `.env`** y viaja en una cabecera temporal durante el push.
No queda escrito en `.git/config` ni en la URL del remoto.

---

## Siguiente paso

**Credenciales de Supabase: ya verificadas.** La prueba real `GET /auth/v1/health` con tu
clave devolvió **HTTP 200**, así que la URL y la anon key están confirmadas contra el
proyecto `wkqmgkevttvmbqrpxguk`. No hay nada más que comprobar ahí.

Lo que queda, en orden:

1. **Aplicar el esquema SQL** — pega `supabase/001_esquema_inicial.sql` en el
   *SQL Editor* del proyecto nuevo. Crea 10 tablas con RLS y protege las respuestas del examen.
2. **Crear el token de GitHub** (sección 7) y lanzar `_tools\push.cmd`.
3. **Sistema de diseño** — fondo `#0A0E17`, acento `#FF6B00`, tarjetas `#1F2937` radius 12px,
   tipografías Inter / Outfit.
4. **Panel de administración** — botón naranja prominente, drawer lateral, "Añadir Lección",
   editor de preguntas con botón "Generar Preguntas con IA".
5. **Página del curso** — control de acceso, desbloqueo secuencial por `percentwatchedchanged ≥ 90%`,
   escritura de progreso en Supabase.
6. **Examen y certificado** — ≥80% aprueba, jsPDF genera el PDF con nombre, curso, academia, fecha y firma.
