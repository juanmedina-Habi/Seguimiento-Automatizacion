/**
 * Guarda la última consulta 15 minutos para que reabrir el link no vuelva a BigQuery.
 */
function cacheScript() { return CacheService.getScriptCache(); }
function leerJson(clave) {
  var texto = cacheScript().get(clave);
  if (!texto) return null;
  try { return JSON.parse(texto); } catch (e) { return null; }
}
function guardarJson(clave, obj) {
  var texto = JSON.stringify(obj);
  if (texto.length > 95000) return;
  cacheScript().put(clave, texto, CACHE_SEG);
}
function guardarCatalogos(corte, catalogos) {
  guardarJson('cat-base-' + corte, {
    pais: catalogos.pais, fase: catalogos.fase, area: catalogos.area, zg: catalogos.zg,
  });
  var zm = catalogos.zm || [];
  var trozos = [];
  var buf = [];
  var peso = 2;
  zm.forEach(function (nombre) {
    var n = String(nombre).length + 3;
    if (peso + n > 80000 && buf.length) { trozos.push(buf); buf = []; peso = 2; }
    buf.push(nombre);
    peso += n;
  });
  if (buf.length) trozos.push(buf);
  var mapa = {};
  mapa['cat-zm-n-' + corte] = String(trozos.length);
  trozos.forEach(function (t, i) { mapa['cat-zm-' + corte + '-' + i] = JSON.stringify(t); });
  cacheScript().putAll(mapa, CACHE_SEG);
}
function leerCatalogos(corte) {
  var base = leerJson('cat-base-' + corte);
  var n = cacheScript().get('cat-zm-n-' + corte);
  if (!base || n == null) return null;
  var zm = [];
  for (var i = 0; i < Number(n); i++) {
    var parte = leerJson('cat-zm-' + corte + '-' + i);
    if (!parte) return null;
    zm = zm.concat(parte);
  }
  base.zm = zm;
  return base;
}
function claveCorta(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, texto);
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}
