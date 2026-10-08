/**
 * Seguimiento Automatización — aplicación web.
 * Los .gs comparten el mismo espacio: una función definida aquí se puede llamar desde otro archivo.
 */

var PROYECTO = 'papyrus-delivery-data';
var TABLA = '`papyrus-delivery-data.idm_squad_precios.tabla_automatizacion_polinator`';
var TOPE_CSV = 25000;

function doGet() {
  if (!usuarioPermitido_()) {
    return HtmlService.createHtmlOutput('<!DOCTYPE html><html lang="es"><body><p>Sin acceso</p></body></html>')
      .setTitle('Sin acceso');
  }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Seguimiento Automatización')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nombre) {
  // El JavaScript vive dentro de <script> en su propio HTML.
  // Apps Script rechaza el archivo si ve un "<" suelto, como en <= o en una etiqueta.
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}
