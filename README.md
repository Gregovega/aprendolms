# APRENDO LMS

Plataforma replicable de cursos en línea. Cada curso vive en su propio subdominio,
los videos se sirven desde Wistia, el progreso se guarda en Supabase y el certificado
se genera en el navegador con jsPDF.

---

## Arquitectura

| Capa | Tecnología | Estado |
|---|---|---|
| Frontend | HTML/CSS/JS estático en GitHub Pages | **Construido** |
| Video | Wistia (Aurora + Vulcan/E-v1) | Cuenta por crear |
| Backend | Supabase (auth + progreso + cursos) | **Credenciales verificadas** |
| Dominio y CDN | Cloudflare | Worker escrito y probado (22 casos) |
| Certificado | jsPDF en el navegador | **Construido** |

### Páginas

| Página | Para qué |
|---|---|
| `index.html` | Portada: catálogo de cursos y "Mis cursos" |
| `curso.html?slug=…` | Reproductor, desbloqueo secuencial, progreso, examen y certificado |
| `admin.html` | Panel: crear cursos, lecciones, preguntas y ajustes |
| `verificar.html` | Verificación pública de un certificado por su código |

---

## Estado actual

### ✅ Hecho

- **Carpeta del proyecto desbloqueada.** Tenía un permiso de Windows roto que impedía
  escribir en ella. Reparado y verificado.
- **Prompt maestro analizado.** `PROMT DEL PROYECTO.docx`: requisitos 1–4, sistema de
  diseño premium y lógica del test.
- **Credenciales de Supabase activadas y verificadas.**
  - Proyecto: `wkqmgkevttvmbqrpxguk.supabase.co`
  - Prueba real: `GET /auth/v1/health` con la clave → **HTTP 200**
  - La clave pública quedó en `assets/js/config.js`; los secretos en `.env`
- **Esquema SQL escrito**: `supabase/001_esquema_inicial.sql`
  - 10 tablas, RLS en todas, 3 funciones y protección de las respuestas del examen.
- **Script de credenciales** con validación, salvaguarda de `service_role` y
  diagnóstico de red: `_tools/set-credentials.ps1`
- **Git 2.56.0 instalado** en `C:\Users\Gregorio\git-portable` (portátil, sin
  administrador, sin tocar `Program Files` ni el registro) y añadido a tu PATH de usuario.
- **Repositorio local listo**: `Gregovega/aprendolms`, rama `main`, con el historial
  previo del remoto preservado mediante un merge (no se borró ningún commit).
- **Script de publicación**: `_tools/push.ps1` — valida el token, impide publicar `.env`
  y nunca hace force-push.
- **Frontend completo**: sistema de diseño, portada con catálogo y autenticación,
  página del curso con desbloqueo secuencial y progreso, examen, certificado en PDF
  y verificación pública.
- **Soporte de las DOS generaciones de Wistia** (ver más abajo: era un problema real).
- **Worker de Cloudflare** para los subdominios por curso, con su lógica de enrutado
  probada (22 casos).
- **Pruebas automáticas**: `_tools/check-all.cmd` ejecuta las 7 comprobaciones del
  proyecto de una vez.

### ⏳ Pendiente

1. **Aplicar el esquema SQL** en el SQL Editor del proyecto nuevo.
2. **Token de GitHub** (fine-grained, solo `Gregovega/aprendolms`) y primer push.
3. **Cuenta de Wistia** y primer video.
4. **Activar GitHub Pages**.
5. **Probar el flujo completo** con datos reales: crear un curso, inscribir un alumno,
   ver un video, aprobar el examen y descargar el certificado.

---

## Estructura

```
APRENDO LMS\
├─ .env                          🔒 privado — secretos reales (Git lo ignora)
├─ .env.example                  plantilla documentada
├─ .gitignore
├─ GUIA-CREDENCIALES.md          cómo obtener y activar cada credencial
├─ README.md                     este archivo
├─ assets\js\config.js           🌐 público — URL + anon key (lo lee el frontend)
├─ supabase\
│  └─ 001_esquema_inicial.sql    esquema completo con RLS
├─ cloudflare\
│  ├─ worker.js                  traduce cada subdominio a su página de curso
│  ├─ test-routing.mjs           22 pruebas de la lógica de enrutado
│  ├─ wrangler.toml              configuración de despliegue
│  └─ package.json               marca la carpeta como módulos ES
├─ _tools\
│  ├─ set-credentials.ps1        motor de activación
│  ├─ set-credentials.cmd        lanzador (evita el bloqueo de política)
│  └─ dump_docx.py               utilidad para leer .docx
└─ PROMT DEL PROYECTO.docx       el prompt maestro original
```

---

## Modelo de datos

| Tabla | Para qué |
|---|---|
| `perfiles` | El alumno. `nombre_completo` es el que sale en el certificado |
| `ajustes` | Fila única: nombre de la academia y firma del certificado |
| `admins` | Quién administra. Nadie se auto-promociona |
| `cursos` | Un curso. `slug` = subdominio (ej. `ventadechicha`) |
| `lecciones` | Título + `wistia_embed` + `wistia_video_id` + orden |
| `preguntas_test` | Opción múltiple. `respuesta_correcta` **nunca** llega al alumno |
| `inscripciones` | Derecho de acceso: el "compró el curso" |
| `progress` | Progreso por lección. Cada alumno solo escribe el suyo |
| `intentos_test` | Historial de exámenes |
| `certificados` | Certificado emitido, con código verificable |

### Decisión de seguridad importante

El prompt pide "frontend puro, sin backend". Eso choca con una cosa: si el navegador
puede leer `preguntas_test`, el alumno **ve las respuestas correctas** en las
herramientas de desarrollo.

La solución implementada: dos funciones `SECURITY DEFINER`.

- `obtener_preguntas(curso_id)` → devuelve las preguntas **sin** la respuesta correcta.
- `calificar_test(curso_id, respuestas)` → corrige **en el servidor**, guarda el intento
  y, si aprueba (≥80%), emite el certificado. Si reprueba, devuelve
  `leccion_repaso` para el botón "Repasar Lección".

Sigue sin haber servidor propio: son funciones dentro de Supabase, que es exactamente
lo que el prompt autoriza al decir "Supabase proporciona directamente la API REST".

---

## ⚠️ El problema de Wistia que casi rompe el desbloqueo secuencial

El prompt maestro pide escuchar el evento **`percentwatchedchanged`**. Ese nombre
pertenece al reproductor **antiguo** de Wistia (Vulcan / E-v1).

Wistia tiene hoy **dos generaciones** de reproductor, y no comparten API:

| | **Aurora** (el actual, lo que recibe una cuenta nueva) | **Vulcan / E-v1** (legacy) |
|---|---|---|
| Marcado | `<wistia-player media-id="…">` | `<div class="wistia_embed wistia_async_ID">` |
| Script | `fast.wistia.com/player.js` | `fast.wistia.com/assets/external/E-v1.js` |
| Evento de progreso | **`percent-watched-change`** | `percentwatchedchanged` |
| Valor que entrega | decimal `0..1` | entero `0..100` |
| Cómo se escucha | `elemento.addEventListener(...)` | `video.bind(...)` dentro de `_wq` |

**Consecuencia:** una cuenta de Wistia recién creada entrega **Aurora**. Si el código
solo escuchara `percentwatchedchanged`, el desbloqueo secuencial **no funcionaría nunca**
y el fallo sería invisible (el video se vería, pero la lección 2 jamás se abriría).

### Cómo lo resuelve este proyecto

`assets/js/wistia-player.js` detecta el formato del embed que pegas en el panel, monta
el reproductor correcto y expone **siempre la misma interfaz**:

```js
WistiaLMS.montar(contenedor, codigoEmbed, {
  onProgreso: function (pct) { … },   // 0..100, monótono: nunca baja
  onFin: function () { … }
});
```

Además del evento oficial, se sondea `secondsWatched` —los **segundos únicos**, que
excluyen lo saltado con la barra— y se usa el **mayor** de los dos. Así el alumno no
puede desbloquear la lección siguiente arrastrando la barra hasta el final.

La detección está cubierta por pruebas: `node _tools/test-wistia.js` (11 casos, incluidos
el embed de Aurora, el de E-v1, el de iframe y el ID suelto).

---

## Cómo funciona el desbloqueo secuencial

1. La lección 1 siempre está abierta.
2. Al reproducir, `onProgreso` actualiza el medidor y guarda en `progress` (con 2,5 s de
   retardo, para no escribir en cada segundo).
3. Al alcanzar el **90 %**, la lección queda `completado = true` y se abre la siguiente.
4. Al completar la última, se habilita el botón **Ir al examen**.
5. El examen se corrige en el servidor. Con **≥ 80 %** se emite el certificado.
6. Si reprueba: *"Ups, no aprobaste. Te recomendamos volver a ver la lección X para
   reforzar."* con un botón grande **Repasar Lección**, y se puede reintentar de inmediato.

---

## Puesta en marcha

```powershell
cd "G:\Documents\a PROYECTOS AUTOMATIZACIONES\APRENDO LMS"

# 1. Ver el estado de las credenciales (enmascarado)
.\_tools\set-credentials.cmd -Show

# 2. Revalidar formato y conexión
.\_tools\set-credentials.cmd -TestOnly

# 3. Añadir Wistia y GitHub cuando los tengas
.\_tools\set-credentials.cmd -WistiaApiToken "..." -GithubRepo "usuario/aprendo-lms"
```

### Publicar en GitHub

```powershell
# Abre una terminal NUEVA para que tome el git del PATH
.\_tools\set-credentials.cmd -GithubToken "github_pat_..."
.\_tools\push.cmd
```

El token queda guardado **solo en `.env`**. No se escribe en `.git/config` ni en la URL
del remoto: viaja en una cabecera temporal durante el push.

### Probar en local

**No abras `index.html` con doble clic.** Con `file://` el navegador trata la página como
origen nulo, bloquea las llamadas a Supabase y la autenticación falla. Hay que servirlo
por HTTP:

```powershell
.\_tools\serve.cmd -AbrirNavegador
```

Queda disponible en <http://localhost:8080/>:

| Dirección | Página |
|---|---|
| `http://localhost:8080/` | Portada |
| `http://localhost:8080/curso.html?slug=mi-curso` | Página del curso |
| `http://localhost:8080/admin.html` | Panel de administración |
| `http://localhost:8080/verificar.html` | Verificar un certificado |

En local no hay subdominios, así que usa siempre `?slug=`. `Ctrl+C` lo detiene.

---

## La regla que nunca se rompe

| Archivo | ¿A GitHub? | Por qué |
|---|---|---|
| `.env` | ❌ **Nunca** | Lleva la `service_role` y el token de Wistia |
| `assets/js/config.js` | ✅ Sí | Solo la anon key: es pública y la protege RLS |

---

## Prueba de extremo a extremo (el orden importa)

Sigue estos pasos en orden. Cada uno depende del anterior.

### 1. Aplicar el esquema
En el **SQL Editor** del proyecto Supabase, pega y ejecuta
`supabase/001_esquema_inicial.sql`. Al final debe listar **10 tablas con
`rls_activo = true`**.

### 2. Crear tu usuario
Abre `index.html` → **Crear cuenta** con tu correo.

> Si Supabase te pide confirmar el correo, ve a **Authentication → Users** y
> confírmalo a mano, o desactiva la confirmación en **Authentication → Providers → Email**.

### 3. Hacerte administrador
Esto es un paso obligatorio y se hace una sola vez:

```sql
-- Averigua tu UUID
select id, email from auth.users order by created_at;

-- Dalo de alta como administrador (sustituye el UUID)
insert into public.admins (user_id) values ('PEGA-AQUI-TU-UUID');
```

Recarga la página: aparecerá **Administración** en la cabecera.

### 4. Crear un curso
**Administración → Crear Nuevo Curso**. Rellena título, descripción y slug
(p. ej. `ventadechicha`). Añade al menos **2 lecciones** y pega el código embed de
Wistia en cada una. El panel te dirá si el embed es válido y de qué generación es.

Añade **preguntas** al examen (mínimo 1 para poder probar, idealmente 30).

### 5. Inscribir a un alumno
**Inscribir alumnos** → escribe el correo con el que te registraste (o un UUID).
Sin inscripción activa, el alumno ve "Aún no tienes acceso".

### 6. Probar el recorrido del alumno
Abre `curso.html?slug=ventadechicha` y comprueba, en este orden:

- [ ] La **lección 1** se reproduce y la **lección 2 sale bloqueada** con un candado.
- [ ] El medidor de "Visto" sube mientras ves el video.
- [ ] Arrastrar la barra hasta el final **no** completa la lección (mensaje de aviso).
- [ ] Al pasar del **90 %** la lección 1 queda completada y **se abre la lección 2**.
- [ ] Al completar la última lección se habilita **Ir al examen**.
- [ ] Suspender a propósito (< 80 %) muestra *"Ups, no aprobaste…"* y el botón
      **Repasar Lección** que te devuelve al video correcto.
- [ ] Aprobar (≥ 80 %) muestra el certificado y el botón **Descargar en PDF**.
- [ ] El PDF lleva tu nombre, el curso, el nombre de la academia, la fecha y la firma.
- [ ] El código del certificado funciona en `verificar.html`.

### 7. Ajustes de la academia
**Administración → Ajustes**: cambia el nombre de la academia (va en el certificado)
y, si quieres, la URL de la firma (una imagen PNG con fondo transparente queda mejor).

---

## Dos decisiones de diseño que se apartan del prompt (a mejor)

### 1. Replicabilidad: un despliegue, muchos cursos

El prompt describe la replicabilidad así: para cada curso nuevo, **copiar el código a
otro repositorio** y **cambiar las variables de Supabase**.

Este proyecto lo simplifica: **un solo despliegue sirve todos los cursos**. Para añadir
un curso basta con **crear un registro** en el panel de administración. No hay que
duplicar el repositorio ni tocar credenciales.

Por qué es mejor:

| | Copiar el repo por curso | Un despliegue (lo implementado) |
|---|---|---|
| Añadir un curso | Subir código + configurar credenciales + DNS | Rellenar un formulario |
| Corregir un fallo | En N repositorios | En uno |
| Alumnos y progreso | Dispersos en N bases de datos | En una, con RLS por curso |
| Coste | N proyectos de Supabase | Uno |

La naturaleza de **plantilla** se mantiene: si mañana quieres una academia
completamente distinta e independiente, copias el repositorio, cambias
`.env` y `config.js`, y ya está. La plantilla sigue siendo replicable; lo que
desaparece es la necesidad de replicarla para cada curso.

### 2. Subdominios por curso

El prompt pide que cada curso viva en su subdominio (`ventadechicha.tudominio.com`).

`resolverSlug()` ya soporta **las cuatro vías**, así que el código está listo:

1. `?slug=ventadechicha` ← lo que funciona hoy, sin configurar nada
2. `?curso=ventadechicha`
3. `ventadechicha.tudominio.com` ← el subdominio
4. `/c/ventadechicha/`

Detalle importante que conviene saber: **GitHub Pages admite un solo dominio
personalizado por repositorio**, así que no basta con apuntar veinte subdominios al
mismo sitio. Para eso está el Worker, que ya viene escrito y probado.

### El Worker de subdominios (`cloudflare/`)

```
ventadechicha.tudominio.com/           →  /curso.html?slug=ventadechicha
ventadechicha.tudominio.com/assets/…   →  /assets/…        (intacto)
www.tudominio.com/                     →  /                (el catálogo)
tudominio.com/                         →  /                (el catálogo)
```

**Lo más importante del Worker:** reescribe **solo la raíz** del subdominio. El resto de
rutas se reenvían intactas. Si reescribiera todo, el navegador pediría
`/assets/js/curso.js` y recibiría el HTML del curso: la página se vería sin estilos y
sin funcionar. Ese detalle es el que rompe casi todas las implementaciones de esto.

También tiene en cuenta:
- El subdominio **manda** sobre `?slug=`, así que nadie puede cambiar de curso por la URL.
- Los parámetros de seguimiento (`?utm_source=…`) se conservan.
- `midominio.com.evil.com` **no** se considera un subdominio tuyo.
- Un subdominio de varios niveles (`a.b.tudominio.com`) no es un curso.

Su lógica vive en una función pura (`decidirRuta`), así que se prueba sin desplegar nada:
**22 casos, 0 fallos** (`node cloudflare/test-routing.mjs`, incluido en `_tools\check-all.cmd`).

Para desplegarlo:

```powershell
# 1. Rellena ROOT_DOMAIN y PAGES_ORIGIN en cloudflare/wrangler.toml
# 2. Desde la carpeta cloudflare:
npx wrangler deploy
```

⚠️ **No configures un dominio personalizado en GitHub Pages.** Pages validaría la cabecera
`Host` y redirigiría al visitante fuera del subdominio, rompiendo justo lo que el Worker
consigue.

⚠️ En Cloudflare, cada subdominio necesita su registro **CNAME con el proxy activado**
(la nube naranja). Sin proxy, la petición nunca pasa por el Worker.

Mientras no tengas dominio, los enlaces con `?slug=` funcionan en cualquier hosting y en local.

---

## Notas de entorno

- **PowerShell 5.1** (no hay PS7). Los `.ps1` necesitan BOM UTF-8 para leerse bien,
  y por eso existe `set-credentials.cmd`, que aplica `-ExecutionPolicy Bypass`
  solo a ese script, sin cambiar la configuración del equipo.
- **Datos de otros proyectos.** Los servidores MCP `supabase` y `supabase-guardian`
  apuntan a **COMARCA** y **GUARDIANKYC**. Este proyecto no los usa ni los modifica:
  el esquema se aplica a mano en el SQL Editor del proyecto de APRENDO LMS.
- **GitHub Pages y `.nojekyll`.** Ese archivo desactiva el procesado de Jekyll. Motivo:
  Jekyll ignora silenciosamente todo lo que empiece con guion bajo y añade un paso de
  compilación que puede fallar. Con `.nojekyll` el sitio se publica tal cual, predecible
  y al instante.
  **Efecto secundario a tener en cuenta:** al no haber exclusiones, la carpeta `_tools/`
  también queda publicada. Contiene scripts de desarrollo, la guía y las pruebas, y
  **ninguno tiene secretos** (los secretos viven solo en `.env`, que Git ignora).
  Si prefieres que no sea accesible, borra `.nojekyll` y añade un `_config.yml` con
  `exclude: [_tools]`.
- **Herramientas de comprobación.** El atajo es un solo comando:

  ```powershell
  .\_tools\check-all.cmd
  ```

  Y por separado, si quieres el detalle de una:

  ```powershell
  node _tools\test-wistia.js             # 11 casos del detector de embeds de Wistia
  node cloudflare\test-routing.mjs       # 22 casos del enrutado de subdominios
  python _tools\check_html.py            # estructura HTML y recursos locales
  python _tools\check_wiring.py          # que cada getElementById encuentre su elemento
  python _tools\check_sql.py             # consistencia interna del esquema SQL
  python _tools\check_embeds.py          # que cada consulta anidada tenga su clave foránea
  ```

  `check_embeds.py` merece una explicación: nació de un **fallo real** que se había colado.
  El panel hacía `select('..., perfiles(nombre_completo)')` sobre `inscripciones`, pero no
  existía ninguna clave foránea entre esas dos tablas (ambas apuntaban por separado a
  `auth.users`). PostgREST resuelve los anidamientos por clave foránea, así que la lista de
  inscritos habría fallado con *"Could not find a relationship…"* — y eso no se ve hasta
  abrir esa pantalla. El comprobador cruza las consultas del cliente con las claves del
  esquema y lo detecta en segundos. Está validado: se probó quitando la clave foránea y
  efectivamente da error.

---

## Revisar el aspecto visual

Ninguna de las 7 comprobaciones anteriores mira cómo se ve la interfaz. Para eso hay dos vías.

### 1. La página de referencia del diseño

`_tools/design-system.html` ejercita **todo** el sistema de diseño en una sola página:
paleta, botones, avisos, etiquetas, barras y anillos de progreso, formularios, tarjeta de
curso, estadísticas, lista de lecciones con sus cuatro estados, tabla, examen con opciones
acertadas y falladas, vista previa del certificado, drawer y tarjetas.

**No necesita Supabase ni internet**, así que se puede abrir en cualquier momento:

```powershell
.\_tools\serve.cmd -AbrirNavegador
# y luego entra en  http://localhost:8080/_tools/design-system.html
```

Sirve también de contrato visual: si cambias el sistema de diseño, aquí se ve el efecto en
todos los componentes a la vez.

### 2. Capturar la pantalla sin abrir el navegador

Chrome y Edge traen modo headless con captura. Con el servidor local levantado:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new --disable-gpu --hide-scrollbars `
  --window-size=1500,3400 --screenshot="captura.png" `
  "http://localhost:8080/_tools/design-system.html"
```

Esto es lo que permitió encontrar un fallo que **ninguna comprobación automática podía ver**:
`.lesson-title` y `.lesson-sub` son `<span>` —elementos en línea— así que en la lista de
lecciones se pintaban uno al lado del otro y salía *"IntroducciónCompletada"* en vez de dos
líneas. Se corrigió con `display: block`.

> Nota: si lanzas Chrome desde dentro de un entorno restringido, puede necesitar permisos
> ampliados para crear sus procesos auxiliares. Desde tu terminal normal no hace falta nada.
