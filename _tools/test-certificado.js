/**
 * PRUEBA REAL DE LA GENERACION DEL CERTIFICADO
 * ==============================================
 * Hasta ahora el certificado solo estaba verificado "leyendo el codigo": nadie
 * habia ejecutado jsPDF. Esta prueba lo ejecuta de verdad.
 *
 * Carga assets/js/certificado.js en un contexto aislado, le inyecta jsPDF (la
 * compilacion para Node) y genera un PDF autentico. Despues comprueba el
 * contenido del archivo resultante:
 *
 *   1. Que sea un PDF valido (cabecera %PDF- y marca EOF).
 *   2. Que mida A4 apaisado (842 x 595 puntos).
 *   3. Que tenga una sola pagina.
 *   4. Que el nombre del alumno, el curso, la academia y el codigo esten
 *      DENTRO del archivo.
 *   5. Que los acentos no rompan nada.
 *
 * Uso:  node _tools/test-certificado.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..');
const vendor = path.join(__dirname, 'vendor');
const salida = path.join(__dirname, 'certificado-de-prueba.pdf');

console.log('\n=== Prueba de generacion del certificado ===\n');

/* ---------------------------------------------------------------- 1. jsPDF */
let modulo = null;
let origen = '';

// Se prefiere la instalacion completa (resuelve fflate y las demas dependencias).
const instalado = path.join(vendor, 'node_modules', 'jspdf');
const suelto = path.join(vendor, 'jspdf.node.min.js');

if (fs.existsSync(instalado)) {
  origen = instalado;
  try { modulo = require(instalado); } catch (e) { modulo = null; console.error('  ' + e.message); }
} else if (fs.existsSync(suelto)) {
  origen = suelto;
  try { modulo = require(suelto); } catch (e) { modulo = null; console.error('  ' + e.message); }
}

if (!modulo) {
  console.error('  FALTA jsPDF para las pruebas.');
  console.error('');
  console.error('  Instalalo con:');
  console.error('    cd _tools\\vendor');
  console.error('    npm install jspdf@2.5.2 --no-audit --no-fund');
  console.error('');
  process.exit(2);
}

const jsPDF = modulo.jsPDF || modulo.default || modulo;
if (typeof jsPDF !== 'function') {
  console.error('  jsPDF no expone un constructor utilizable.');
  process.exit(2);
}
console.log('  jsPDF cargado correctamente.');
console.log('    origen: ' + origen.replace(raiz, '.'));

/* ---------------------------------------------------------------- 2. certificado.js */
const rutaCert = path.join(raiz, 'assets', 'js', 'certificado.js');
const codigo = fs.readFileSync(rutaCert, 'utf8');

const sandbox = {
  window: {},
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  // Si algo intentara descargar la firma, que falle de forma controlada.
  fetch: function () { return Promise.reject(new Error('sin red en la prueba')); }
};
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox);

if (!sandbox.window.Certificado) {
  console.error('  certificado.js no expuso window.Certificado');
  process.exit(1);
}
sandbox.window.jspdf = { jsPDF };
console.log('  certificado.js cargado y window.Certificado disponible.');

/* ---------------------------------------------------------------- 3. los datos */
const A = {
  alumno: 'Maria Alejandra Perez',
  curso: 'Venta de Chicha 101',
  academia: 'Academia Aprendo',
  fecha: '14 de octubre de 2026',
  codigo: 'A1B2C3D4E5'
};
// El mismo caso pero con acentos, para comprobar que no rompen el PDF.
const B = {
  alumno: 'José María Peña Gutiérrez',
  curso: 'Producción y Venta de Chicha',
  academia: 'Academia Añeja',
  fecha: '1 de marzo de 2027',
  codigo: 'ZZ99YY88XX'
};

let fallos = 0;
function comprobar(condicion, descripcion, detalle) {
  if (condicion) {
    console.log('  OK     ' + descripcion);
  } else {
    fallos++;
    console.log('  FALLO  ' + descripcion);
    if (detalle) console.log('         -> ' + detalle);
  }
}

/* ---------------------------------------------------------------- 4. generar */
(async function () {
  for (const caso of [{ n: 'sin acentos', d: A }, { n: 'con acentos', d: B }]) {
    console.log(`\n  --- Caso ${caso.n} ---`);
    let doc, buf;

    try {
      doc = await sandbox.window.Certificado.generar(caso.d);
    } catch (e) {
      comprobar(false, 'generar() no lanza excepciones', e.message);
      continue;
    }
    comprobar(!!doc, 'generar() devuelve un documento');

    try {
      buf = Buffer.from(doc.output('arraybuffer'));
    } catch (e) {
      comprobar(false, 'se puede extraer el PDF', e.message);
      continue;
    }

    const texto = buf.toString('latin1');

    // --- PDF valido ---
    comprobar(buf.slice(0, 5).toString() === '%PDF-', 'tiene cabecera %PDF-',
      'empieza por: ' + JSON.stringify(buf.slice(0, 8).toString()));
    comprobar(texto.indexOf('%%EOF') !== -1, 'tiene marca de fin %%EOF');

    // --- tamano A4 apaisado: 842 x 595 puntos ---
    const mb = texto.match(/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    if (mb) {
      const ancho = parseFloat(mb[3]) - parseFloat(mb[1]);
      const alto = parseFloat(mb[4]) - parseFloat(mb[2]);
      comprobar(Math.abs(ancho - 842) < 2 && Math.abs(alto - 595) < 2,
        `mide A4 apaisado (${ancho} x ${alto} pt)`,
        `esperado 842 x 595`);
    } else {
      comprobar(false, 'se encontro MediaBox', 'no aparece en el PDF');
    }

    // --- una sola pagina ---
    const paginas = (texto.match(/\/Type\s*\/Page[^s]/g) || []).length;
    comprobar(paginas === 1, `tiene 1 pagina (encontradas ${paginas})`);

    // --- contenido ---
    comprobar(texto.indexOf('Aprendo LMS') !== -1 || texto.indexOf(caso.d.curso) !== -1,
      'el contenido lleva datos reales');
    comprobar(texto.indexOf(caso.d.curso) !== -1,
      `aparece el nombre del curso ("${caso.d.curso}")`);
    comprobar(texto.indexOf(caso.d.codigo) !== -1,
      `aparece el codigo de verificacion ("${caso.d.codigo}")`);
    comprobar(texto.indexOf('CERTIFICADO DE FINALIZACI') !== -1,
      'aparece el membrete "CERTIFICADO DE FINALIZACION"');
    comprobar(texto.indexOf(caso.d.academia) !== -1,
      `aparece el nombre de la academia ("${caso.d.academia}")`);

    // El nombre puede ir escapado por acentos, asi que se busca la primera palabra.
    const primeraPalabra = caso.d.alumno.split(' ')[0];
    comprobar(texto.indexOf(primeraPalabra) !== -1,
      `aparece el nombre del alumno (al menos "${primeraPalabra}")`);

    if (caso.n === 'sin acentos') {
      comprobar(texto.indexOf(A.alumno) !== -1,
        'el nombre ASCII aparece literal en el PDF');
      fs.writeFileSync(salida, buf);
      console.log(`         (guardado en _tools\\${path.basename(salida)}, ${buf.length} bytes)`);
    }
  }

  console.log('\n=== ' + (fallos === 0 ? 'TODO CORRECTO' : fallos + ' fallo(s)') + ' ===\n');
  process.exit(fallos ? 1 : 0);
})();
