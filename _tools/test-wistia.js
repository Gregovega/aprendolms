/* Prueba de la deteccion de embeds de Wistia (logica pura, sin red).
   Carga assets/js/wistia-player.js en un contexto aislado y comprueba
   que reconoce los formatos reales de la documentacion oficial. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const codigo = fs.readFileSync(path.join(raiz, 'assets', 'js', 'wistia-player.js'), 'utf8');

const sandbox = { window: {}, document: {}, console: console, setTimeout: setTimeout };
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox);

const W = sandbox.window.WistiaLMS;
if (!W || typeof W.parsearEmbed !== 'function') {
  console.error('FALLO: WistiaLMS.parsearEmbed no se expuso');
  process.exit(1);
}

/* --- casos, tomados de la documentacion oficial de Wistia --- */
const aurora = `<script src="https://fast.wistia.com/player.js" async></script>
<script src="https://fast.wistia.com/embed/rbsg3da4jd.js" async type="module"></script>
<style>wistia-player[media-id='rbsg3da4jd']:not(:defined){display:block;padding-top:56.25%;}</style>
<wistia-player media-id="rbsg3da4jd"></wistia-player>`;

const auroraIframe = `<script src="https://fast.wistia.net/player.js" async></script>
<div class="wistia_responsive_padding" style="padding:56.25% 0 0 0;position:relative;">
  <iframe src="https://fast.wistia.net/embed/iframe/abc1234567?web_component=true&seo=true" title="Video" allow="autoplay; fullscreen"></iframe>
</div>`;

const legacy = `<script src="https://fast.wistia.com/embed/medias/89h4tleuq8.jsonp" async></script>
<script src="https://fast.wistia.com/assets/external/E-v1.js" async></script>
<div class="wistia_embed wistia_async_89h4tleuq8 seo=false videoFoam=false" style="height:360px;position:relative;width:640px"><div class="wistia_swatch"></div></div>`;

const soloClase = `<div class="wistia_embed wistia_async_zz99yy88xx videoFoam=true"></div>`;

const casos = [
  { nombre: 'Aurora (embed moderno)',        entrada: aurora,       ok: true,  motor: 'aurora', id: 'rbsg3da4jd', adv: 0 },
  { nombre: 'Aurora con iframe',             entrada: auroraIframe, ok: true,  motor: 'aurora', id: 'abc1234567', adv: 1 },
  { nombre: 'Legacy E-v1 (jsonp)',           entrada: legacy,       ok: true,  motor: 'legacy', id: '89h4tleuq8', adv: 0 },
  { nombre: 'Legacy solo con la clase',      entrada: soloClase,    ok: true,  motor: 'legacy', id: 'zz99yy88xx', adv: 0 },
  { nombre: 'Solo el ID desnudo',            entrada: 'rbsg3da4jd', ok: true,  motor: 'aurora', id: 'rbsg3da4jd', adv: 0 },
  { nombre: 'ID con espacios alrededor',     entrada: '  rbsg3da4jd  ', ok: true, motor: 'aurora', id: 'rbsg3da4jd', adv: 0 },
  { nombre: 'Vacio',                         entrada: '',           ok: false },
  { nombre: 'Solo espacios',                 entrada: '   ',        ok: false },
  { nombre: 'Texto sin ID',                  entrada: 'esto no es un embed', ok: false },
  { nombre: 'ID demasiado corto',            entrada: '<wistia-player media-id="abc"></wistia-player>', ok: false },
  { nombre: 'Media-id con mayusculas',       entrada: '<wistia-player media-id="RBSG3DA4JD"></wistia-player>', ok: true, motor: 'aurora', id: 'rbsg3da4jd', adv: 0 }
];

let fallos = 0;
console.log('=== Prueba de parsearEmbed() ===\n');

for (const c of casos) {
  const r = W.parsearEmbed(c.entrada);
  const problemas = [];

  if (r.ok !== c.ok) problemas.push(`ok esperado=${c.ok} obtenido=${r.ok}`);
  if (c.ok) {
    if (c.motor && r.motor !== c.motor) problemas.push(`motor esperado=${c.motor} obtenido=${r.motor}`);
    if (c.id && r.mediaId !== c.id) problemas.push(`id esperado=${c.id} obtenido=${r.mediaId}`);
    if (c.adv !== undefined && (r.advertencias || []).length !== c.adv) {
      problemas.push(`advertencias esperadas=${c.adv} obtenidas=${(r.advertencias || []).length}`);
    }
  } else {
    if (!r.error) problemas.push('deberia traer mensaje de error');
  }

  if (problemas.length) {
    fallos++;
    console.log(`  FALLO  ${c.nombre}`);
    problemas.forEach(p => console.log(`         -> ${p}`));
  } else {
    const extra = c.ok ? `  motor=${r.motor}  id=${r.mediaId}` + ((r.advertencias||[]).length ? '  (+aviso)' : '') : '  rechazado correctamente';
    console.log(`  OK     ${c.nombre}${extra}`);
  }
}

console.log(`\n=== ${casos.length} casos, ${fallos} fallo(s) ===`);
process.exit(fallos ? 1 : 0);
