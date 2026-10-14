# APRENDO LMS

Plataforma replicable de cursos en línea. Cada curso vive en su propio subdominio,
los videos se sirven desde Wistia, el progreso se guarda en Supabase y el certificado
se genera en el navegador con jsPDF.

---

## Arquitectura

| Capa | Tecnología | Estado |
|---|---|---|
| Frontend | HTML/CSS/JS estático en GitHub Pages | Pendiente |
| Video | Wistia (Player API + embed async) | Cuenta por crear |
| Backend | Supabase (auth + progreso + cursos) | **Credenciales verificadas** |
| Dominio y CDN | Cloudflare | Pendiente |
| Certificado | jsPDF en el navegador | Pendiente |

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

### ⏳ Pendiente

1. **Aplicar el esquema SQL** en el SQL Editor del proyecto nuevo.
2. **Token de GitHub** (fine-grained, solo `Gregovega/aprendolms`) y primer push.
3. **Cuenta de Wistia** y primer video.
4. **Activar GitHub Pages** cuando exista `index.html`.
5. **Construir el frontend**: diseño premium, panel de admin, página del curso,
   desbloqueo secuencial, examen y certificado.

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

---

## La regla que nunca se rompe

| Archivo | ¿A GitHub? | Por qué |
|---|---|---|
| `.env` | ❌ **Nunca** | Lleva la `service_role` y el token de Wistia |
| `assets/js/config.js` | ✅ Sí | Solo la anon key: es pública y la protege RLS |

---

## Notas de entorno

- **PowerShell 5.1** (no hay PS7). Los `.ps1` necesitan BOM UTF-8 para leerse bien,
  y por eso existe `set-credentials.cmd`, que aplica `-ExecutionPolicy Bypass`
  solo a ese script, sin cambiar la configuración del equipo.
- **Datos de otros proyectos.** Los servidores MCP `supabase` y `supabase-guardian`
  apuntan a **COMARCA** y **GUARDIANKYC**. Este proyecto no los usa ni los modifica:
  el esquema se aplica a mano en el SQL Editor del proyecto de APRENDO LMS.
