/**
 * PRUEBAS DE LAS FUNCIONES PURAS DEL PANEL DE ADMINISTRACION
 * ===========================================================
 * Prueba las dos partes de admin.js donde un fallo silencioso haria mas dano:
 *
 *   1. La normalizacion del slug (el subdominio del curso). Tiene que lidiar con
 *      acentos y con la enie, porque "Producción" debe dar "produccion".
 *   2. El validador del JSON que se le pide a la IA. Recibe texto pegado por una
 *      persona desde ChatGPT o Cursor, asi que viene con cercos de Markdown, con
 *      letras en vez de indices, o con el texto exacto de la opcion.
 *
 * admin.js no es un modulo: es un IIFE que vive pegado al DOM. Para poder probarlo
 * se carga en un contexto aislado con un `document` de mentira y se activa su
 * enganche de pruebas (window.__APRENDO_EXPONER_PARA_PRUEBAS__), que expone SOLO
 * funciones puras.
 *
 * Uso:  node _tools/test-admin.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..');
const ruta = path.join(raiz, 'assets', 'js', 'admin.js');

console.log('\n=== Pruebas de las funciones puras del panel ===\n');

/* ---------------------------------------------------------------- cargar admin.js */
const sandbox = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  document: {
    // admin.js solo registra un escuchador al cargarse: con esto basta.
    addEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {}, addEventListener: function () {} }; }
  }
};
sandbox.window = sandbox;
sandbox.window.__APRENDO_EXPONER_PARA_PRUEBAS__ = true;
sandbox.window.APRENDO = { escaparHtml: function (s) { return String(s == null ? '' : s); } };
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
try {
  vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: 'admin.js' });
} catch (e) {
  console.error('  No se pudo cargar admin.js: ' + e.message);
  process.exit(2);
}

const API = sandbox.window.__PRUEBAS_ADMIN__;
if (!API) {
  console.error('  admin.js no expuso el enganche de pruebas.');
  console.error('  Comprueba que siga existiendo el bloque __APRENDO_EXPONER_PARA_PRUEBAS__.');
  process.exit(2);
}
console.log('  admin.js cargado; ' + Object.keys(API).length + ' funciones puras expuestas.\n');

/* ---------------------------------------------------------------- utilidades */
let fallos = 0;
let total = 0;

function igual(descripcion, obtenido, esperado) {
  total++;
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    console.log('  OK     ' + descripcion);
  } else {
    fallos++;
    console.log('  FALLO  ' + descripcion);
    console.log('         esperado: ' + b);
    console.log('         obtenido: ' + a);
  }
}

function grupo(titulo) {
  console.log('  --- ' + titulo + ' ---');
}

/* ================================================================ slug */
grupo('normalizarSlug');

igual('"Venta de Chicha 101" -> venta-de-chicha-101',
  API.normalizarSlug('Venta de Chicha 101'), 'venta-de-chicha-101');

igual('acentos: "Producción y Venta" -> produccion-y-venta',
  API.normalizarSlug('Producción y Venta'), 'produccion-y-venta');

igual('enie: "Año 2026" -> ano-2026',
  API.normalizarSlug('Año 2026'), 'ano-2026');

igual('enie con dieresis: "Ñandú" -> nandu',
  API.normalizarSlug('Ñandú'), 'nandu');

igual('todos los acentos: "áéíóú" -> aeiou',
  API.normalizarSlug('áéíóú'), 'aeiou');

igual('mayusculas: "ABC" -> abc',
  API.normalizarSlug('ABC'), 'abc');

igual('espacios sobrantes: "   hola   " -> hola',
  API.normalizarSlug('   hola   '), 'hola');

igual('guiones repetidos: "a---b" -> a-b',
  API.normalizarSlug('a---b'), 'a-b');

igual('guiones en los extremos: "--hola--" -> hola',
  API.normalizarSlug('--hola--'), 'hola');

igual('signos de puntuacion: "¡Hola, Mundo!" -> hola-mundo',
  API.normalizarSlug('¡Hola, Mundo!'), 'hola-mundo');

igual('guion bajo: "curso_2026" -> curso-2026',
  API.normalizarSlug('curso_2026'), 'curso-2026');

igual('barras: "cursos/video" -> cursos-video',
  API.normalizarSlug('cursos/video'), 'cursos-video');

igual('vacio: "" -> ""',
  API.normalizarSlug(''), '');

igual('solo simbolos: "@#$%" -> ""',
  API.normalizarSlug('@#$%'), '');

igual('numeros solos: "12345" -> 12345',
  API.normalizarSlug('12345'), '12345');

grupo('normalizarSlugSuave (mientras se teclea)');

igual('conserva el guion final: "venta-" -> venta-',
  API.normalizarSlugSuave('venta-'), 'venta-');

igual('sigue normalizando acentos: "Café-" -> cafe-',
  API.normalizarSlugSuave('Café-'), 'cafe-');

grupo('slugValido');

igual('"ventadechicha" es valido', API.slugValido('ventadechicha'), true);
igual('"venta-de-chicha" es valido', API.slugValido('venta-de-chicha'), true);
igual('"a1" es valido', API.slugValido('a1'), true);
igual('"12345" es valido', API.slugValido('12345'), true);
igual('"-venta" NO es valido', API.slugValido('-venta'), false);
igual('"venta-" NO es valido', API.slugValido('venta-'), false);
igual('"venta--chicha" NO es valido', API.slugValido('venta--chicha'), false);
igual('"Venta" NO es valido (mayuscula)', API.slugValido('Venta'), false);
igual('"venta chicha" NO es valido (espacio)', API.slugValido('venta chicha'), false);
igual('"" NO es valido', API.slugValido(''), false);
igual('"venta_de_chicha" NO es valido (guion bajo)', API.slugValido('venta_de_chicha'), false);

/* ================================================================ respuestas */
grupo('indiceRespuesta');

const ops = ['uno', 'dos', 'tres', 'cuatro'];
igual('numero 0 -> 0', API.indiceRespuesta(0, ops), 0);
igual('numero 3 -> 3', API.indiceRespuesta(3, ops), 3);
igual('numero 4 (fuera de rango) -> -1', API.indiceRespuesta(4, ops), -1);
igual('numero -1 -> -1', API.indiceRespuesta(-1, ops), -1);
igual('numero decimal 1.5 -> -1', API.indiceRespuesta(1.5, ops), -1);
igual('texto "2" -> 2', API.indiceRespuesta('2', ops), 2);
igual('texto "9" (fuera de rango) -> -1', API.indiceRespuesta('9', ops), -1);
igual('letra "A" -> 0', API.indiceRespuesta('A', ops), 0);
igual('letra "a" -> 0', API.indiceRespuesta('a', ops), 0);
igual('letra "D" -> 3', API.indiceRespuesta('D', ops), 3);
igual('letra "E" (fuera de rango) -> -1', API.indiceRespuesta('E', ops), -1);
igual('texto exacto de la opcion -> 2', API.indiceRespuesta('tres', ops), 2);
igual('texto de la opcion con mayusculas -> 1', API.indiceRespuesta('DOS', ops), 1);
igual('texto que no es ninguna opcion -> -1', API.indiceRespuesta('cinco', ops), -1);
igual('null -> -1', API.indiceRespuesta(null, ops), -1);
igual('undefined -> -1', API.indiceRespuesta(undefined, ops), -1);
igual('objeto -> -1', API.indiceRespuesta({ a: 1 }, ops), -1);

/* ================================================================ JSON de la IA */
grupo('limpiarJson / extraerJson');

igual('quita los cercos de Markdown',
  API.limpiarJson('```json\n{"preguntas":[]}\n```'), '{"preguntas":[]}');

igual('quita los cercos sin lenguaje',
  API.limpiarJson('```\n{"a":1}\n```'), '{"a":1}');

igual('recorta el texto de alrededor',
  API.limpiarJson('Claro, aqui tienes:\n{"a":1}\nEspero que sirva.'), '{"a":1}');

igual('acepta un array directo',
  API.limpiarJson('Aqui va:\n[{"pregunta":"x"}]\n'), '[{"pregunta":"x"}]');

igual('texto sin JSON -> null',
  API.limpiarJson('no hay nada aqui'), null);

igual('extraerJson parsea correctamente',
  API.extraerJson('```json\n{"preguntas":[]}\n```'), { preguntas: [] });

let lanzo = false;
try { API.extraerJson('esto no es json'); } catch (e) { lanzo = true; }
igual('extraerJson lanza si no hay JSON', lanzo, true);

// El validador debe ser TODO-O-NADA: si una pregunta falla, no devuelve ninguna.
grupo('analizarPreguntas: casos validos');

const validas = {
  preguntas: [
    { pregunta: '¿Cuál es la capital?', opciones: ['Caracas', 'Lima', 'Bogotá', 'Quito'], respuesta_correcta: 0 },
    { pregunta: '¿Cuánto es 2+2?', opciones: ['3', '4'], respuesta_correcta: 1, explicacion: 'Suma basica' }
  ]
};
let r = API.analizarPreguntas(validas);
igual('acepta {preguntas:[...]}', r.ok, true);
igual('cuenta bien las validas', r.validas, 2);
igual('no acumula errores', r.errores.length, 0);
igual('normaliza la respuesta a indice', r.preguntas[0].respuesta_correcta, 0);
igual('normaliza la respuesta de la segunda', r.preguntas[1].respuesta_correcta, 1);

r = API.analizarPreguntas([{ pregunta: 'p', opciones: ['a', 'b'], respuesta_correcta: 'A' }]);
igual('acepta un array directo', r.ok, true);
igual('convierte la letra "A" a indice 0', r.preguntas[0].respuesta_correcta, 0);

r = API.analizarPreguntas({ preguntas: [{ pregunta: 'p', opciones: ['uno', 'dos'], respuesta_correcta: 'dos' }] });
igual('acepta el texto exacto de la opcion', r.preguntas[0].respuesta_correcta, 1);

grupo('analizarPreguntas: casos que debe RECHAZAR');

r = API.analizarPreguntas({ preguntas: [] });
igual('lista vacia -> ok=false', r.ok, false);

r = API.analizarPreguntas({});
igual('sin la clave preguntas -> ok=false', r.ok, false);

r = API.analizarPreguntas({ preguntas: [{ opciones: ['a', 'b'], respuesta_correcta: 0 }] });
igual('sin enunciado -> ok=false', r.ok, false);
igual('  y explica el campo', /pregunta/i.test(r.errores[0] || ''), true);

r = API.analizarPreguntas({ preguntas: [{ pregunta: 'p', opciones: ['a'], respuesta_correcta: 0 }] });
igual('con una sola opcion -> ok=false', r.ok, false);

r = API.analizarPreguntas({ preguntas: [{ pregunta: 'p', opciones: ['a', 'b'], respuesta_correcta: 7 }] });
igual('respuesta fuera de rango -> ok=false', r.ok, false);

r = API.analizarPreguntas({ preguntas: [{ pregunta: 'p', opciones: ['a', ''], respuesta_correcta: 0 }] });
igual('opcion vacia -> ok=false', r.ok, false);

r = API.analizarPreguntas({ preguntas: [{ pregunta: '  ', opciones: ['a', 'b'], respuesta_correcta: 0 }] });
igual('enunciado solo con espacios -> ok=false', r.ok, false);

grupo('analizarPreguntas: es TODO-O-NADA');

// Una buena y una mala: no debe devolver la buena a medias.
r = API.analizarPreguntas({
  preguntas: [
    { pregunta: 'buena', opciones: ['a', 'b'], respuesta_correcta: 0 },
    { pregunta: 'mala', opciones: ['a'], respuesta_correcta: 0 }
  ]
});
igual('con una mala, ok=false', r.ok, false);
igual('y NO devuelve ninguna pregunta (nada a medias)', r.preguntas.length, 0);
igual('informa del total recibido', r.total, 2);
igual('informa de cuantas eran validas', r.validas, 1);
igual('el error nombra la pregunta que falla', /2/.test(r.errores.join(' ')), true);

/* ================================================================ el enganche esta guardado */
grupo('el enganche de pruebas NO debe existir en produccion');

// Se carga admin.js OTRA VEZ, ahora sin la bandera: igual que en el navegador.
// Si esto fallara, el panel estaria exponiendo funciones internas a cualquiera.
const limpio = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  document: sandbox.document
};
limpio.window = limpio;
limpio.window.APRENDO = sandbox.window.APRENDO;
limpio.globalThis = limpio;
vm.createContext(limpio);
try {
  vm.runInContext(fs.readFileSync(ruta, 'utf8'), limpio, { filename: 'admin.js' });
  igual('sin la bandera no se expone __PRUEBAS_ADMIN__',
    typeof limpio.window.__PRUEBAS_ADMIN__, 'undefined');
} catch (e) {
  igual('admin.js se carga sin la bandera', false);
  console.log('         -> ' + e.message);
}

/* ---------------------------------------------------------------- resumen */
console.log('\n' + '='.repeat(58));
if (fallos === 0) {
  console.log('TODO CORRECTO: ' + total + ' comprobaciones, 0 fallos');
} else {
  console.log(fallos + ' FALLO(S) de ' + total + ' comprobaciones');
}
console.log('');
process.exit(fallos ? 1 : 0);
