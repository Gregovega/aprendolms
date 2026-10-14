/* ============================================================================
   APRENDO LMS — Generación del certificado en PDF con jsPDF
   Requiere: jsPDF UMD cargado (window.jspdf.jsPDF)
   Expone:   window.Certificado.generar(datos) / .descargar(datos) / .vistaPrevia
   ============================================================================ */
(function () {
  'use strict';

  var MORADO  = [20, 33, 61];      // azul marino profundo
  var ORO     = [212, 175, 55];
  var CREMA   = [251, 248, 240];
  var GRIS    = [90, 102, 122];
  var TINTA   = [10, 14, 23];

  function jsPDFCtor() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  /** Convierte una URL de imagen en data URL. Devuelve null si no puede. */
  async function imagenADataURL(url) {
    if (!url) return null;
    try {
      var r = await fetch(url, { mode: 'cors' });
      if (!r.ok) return null;
      var blob = await r.blob();
      return await new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('No se pudo cargar la firma (CORS o red):', e);
      return null;
    }
  }

  function detectarFormato(dataURL) {
    if (!dataURL) return 'PNG';
    if (/^data:image\/jpe?g/i.test(dataURL)) return 'JPEG';
    if (/^data:image\/webp/i.test(dataURL)) return 'WEBP';
    return 'PNG';
  }

  /**
   * Dibuja el certificado sobre un documento jsPDF nuevo.
   * datos = { alumno, curso, academia, fecha, firmaDataURL, codigo }
   */
  function dibujar(datos) {
    var Ctor = jsPDFCtor();
    if (!Ctor) throw new Error('jsPDF no está cargado. Revisa tu conexión y recarga la página.');

    var doc = new Ctor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var W = 297, H = 210, CX = W / 2;

    /* ---- fondo ---- */
    doc.setFillColor(CREMA[0], CREMA[1], CREMA[2]);
    doc.rect(0, 0, W, H, 'F');

    /* ---- marco doble ---- */
    doc.setDrawColor(MORADO[0], MORADO[1], MORADO[2]);
    doc.setLineWidth(2.6);
    doc.rect(9, 9, W - 18, H - 18);
    doc.setDrawColor(ORO[0], ORO[1], ORO[2]);
    doc.setLineWidth(0.7);
    doc.rect(13.5, 13.5, W - 27, H - 27);

    /* ---- esquinas ornamentales ---- */
    doc.setDrawColor(ORO[0], ORO[1], ORO[2]);
    doc.setLineWidth(1.1);
    var e = 20, l = 12;
    [[e, e, 1, 1], [W - e, e, -1, 1], [e, H - e, 1, -1], [W - e, H - e, -1, -1]].forEach(function (c) {
      doc.line(c[0], c[1], c[0] + l * c[2], c[1]);
      doc.line(c[0], c[1], c[0], c[1] + l * c[3]);
    });

    /* ---- membrete ---- */
    doc.setTextColor(ORO[0], ORO[1], ORO[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setCharSpace(3.2);
    doc.text('CERTIFICADO DE FINALIZACIÓN', CX, 38, { align: 'center' });
    doc.setCharSpace(0);

    doc.setDrawColor(ORO[0], ORO[1], ORO[2]);
    doc.setLineWidth(0.5);
    doc.line(CX - 34, 43, CX + 34, 43);

    /* ---- texto introductorio ---- */
    doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text('Se otorga el presente certificado a', CX, 57, { align: 'center' });

    /* ---- nombre del alumno ---- */
    var nombre = String(datos.alumno || 'Alumno').trim();
    doc.setTextColor(TINTA[0], TINTA[1], TINTA[2]);
    doc.setFont('times', 'bold');
    var tamNombre = nombre.length > 34 ? 22 : (nombre.length > 24 ? 26 : 32);
    doc.setFontSize(tamNombre);
    var lineasNombre = doc.splitTextToSize(nombre, 210);
    doc.text(lineasNombre, CX, 74, { align: 'center' });

    var yTrasNombre = 74 + (lineasNombre.length - 1) * (tamNombre * 0.42);

    doc.setDrawColor(ORO[0], ORO[1], ORO[2]);
    doc.setLineWidth(0.9);
    doc.line(CX - 62, yTrasNombre + 5, CX + 62, yTrasNombre + 5);

    /* ---- curso ---- */
    var yCurso = yTrasNombre + 19;
    doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text('por haber completado satisfactoriamente el curso', CX, yCurso, { align: 'center' });

    var curso = String(datos.curso || '').trim();
    doc.setTextColor(MORADO[0], MORADO[1], MORADO[2]);
    doc.setFont('helvetica', 'bold');
    var tamCurso = curso.length > 54 ? 13 : 17;
    doc.setFontSize(tamCurso);
    var lineasCurso = doc.splitTextToSize(curso, 200);
    doc.text(lineasCurso, CX, yCurso + 11, { align: 'center' });

    /* ---- bloques de firma y fecha ---- */
    var yBase = 163;
    doc.setDrawColor(150, 160, 175);
    doc.setLineWidth(0.4);

    // Firma (izquierda)
    var firmaX1 = 34, firmaX2 = 118;
    doc.line(firmaX1, yBase, firmaX2, yBase);
    if (datos.firmaDataURL) {
      try {
        doc.addImage(datos.firmaDataURL, detectarFormato(datos.firmaDataURL), firmaX1 + 8, yBase - 21, 68, 19);
      } catch (e) { console.warn('Firma no incrustada:', e); }
    }
    doc.setTextColor(MORADO[0], MORADO[1], MORADO[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(String(datos.academia || 'Mi Academia'), (firmaX1 + firmaX2) / 2, yBase + 6, { align: 'center' });
    doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Institución', (firmaX1 + firmaX2) / 2, yBase + 11, { align: 'center' });

    // Fecha (derecha)
    var fechaX1 = 179, fechaX2 = 263;
    doc.setDrawColor(150, 160, 175);
    doc.line(fechaX1, yBase, fechaX2, yBase);
    doc.setTextColor(MORADO[0], MORADO[1], MORADO[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(String(datos.fecha || ''), (fechaX1 + fechaX2) / 2, yBase + 6, { align: 'center' });
    doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Fecha de emisión', (fechaX1 + fechaX2) / 2, yBase + 11, { align: 'center' });

    /* ---- código de verificación ---- */
    if (datos.codigo) {
      doc.setFontSize(7.6);
      doc.setTextColor(140, 150, 165);
      doc.text('Código de verificación: ' + datos.codigo, CX, 191, { align: 'center' });
    }
    return doc;
  }

  function nombreArchivo(datos) {
    var limpio = function (s) {
      return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'curso';
    };
    return 'Certificado-' + limpio(datos.curso) + '-' + limpio(datos.alumno) + '.pdf';
  }

  window.Certificado = {
    /**
     * Genera y devuelve el objeto jsPDF (para previsualizar o incrustar).
     * Carga la firma automáticamente si le pasas firmaUrl.
     */
    async generar(datos) {
      datos = datos || {};
      if (!datos.firmaDataURL && datos.firmaUrl) {
        datos.firmaDataURL = await imagenADataURL(datos.firmaUrl);
      }
      if (!datos.fecha) {
        datos.fecha = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
      }
      return dibujar(datos);
    },

    /** Genera y fuerza la descarga del PDF. */
    async descargar(datos) {
      var doc = await window.Certificado.generar(datos);
      doc.save(nombreArchivo(datos));
      return doc;
    },

    /** Devuelve un object URL del PDF, para incrustarlo en un <iframe>. */
    async vistaPrevia(datos) {
      var doc = await window.Certificado.generar(datos);
      return doc.output('bloburl');
    },

    /** Abre el PDF en una pestaña nueva (por si el navegador móvil no descarga). */
    async abrir(datos) {
      var doc = await window.Certificado.generar(datos);
      var url = doc.output('bloburl');
      window.open(url, '_blank');
      return url;
    }
  };
})();
