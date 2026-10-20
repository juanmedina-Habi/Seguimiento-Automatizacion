/**
 * Una lectura de BigQuery al día. El resultado se comprime y se guarda en Drive.
 * Abrir el tablero y mover filtros no vuelve a consultar: el navegador usa ese archivo.
 * Quien publica el tablero corre setup() una vez desde el editor.
 */

var CARPETA_SNAPSHOTS = 'Seguimiento Automatización — snapshots';
var TOPE_GZIP = 20 * 1024 * 1024;
var TROZO_B64 = 1500000;

function setup() {
  var props = PropertiesService.getScriptProperties();
  var email = emailUsuario_() || Session.getEffectiveUser().getEmail();
  if (email) props.setProperty('OWNER_EMAIL', email);
  asegurarCarpeta_();
  instalarTrigger_();
  return refreshSnapshots();
}

function instalarTrigger_() {
  var hayDiario = false;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshSnapshots') hayDiario = true;
  });
  if (hayDiario) return;
  ScriptApp.newTrigger('refreshSnapshots')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone('America/Bogota')
    .create();
}

function prepararDia() {
  return programarLectura_(false);
}

function programarLectura_(forzar) {
  assertAllowed_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('OWNER_EMAIL')) {
    var email = emailUsuario_();
    if (email) props.setProperty('OWNER_EMAIL', email);
  }
  if (!isOwner_()) return estadoPublico_();
  try { instalarTrigger_(); } catch (e) {}
  if (snapshotListo_() && !forzar) return estadoPublico_();
  if (refreshEnCurso_()) return estadoPublico_();
  try {
    programarUnaVez_();
  } catch (e2) {
    return {
      error: 'No se pudo dejar la lectura en segundo plano. Vuelve a abrir el tablero y acepta los permisos, o ejecuta setup() en el editor.',
    };
  }
  props.setProperty('SNAP_ESTADO', 'programado');
  props.setProperty('SNAP_DESDE', String(Date.now()));
  props.deleteProperty('SNAP_ERROR');
  return estadoPublico_();
}

function programarUnaVez_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'refreshUnaVez') return;
  }
  ScriptApp.newTrigger('refreshUnaVez').timeBased().after(60 * 1000).create();
}

function refreshUnaVez() {
  try {
    refreshSnapshots();
  } finally {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'refreshUnaVez') ScriptApp.deleteTrigger(t);
    });
  }
}

function refreshSnapshots() {
  if (!puedeRefrescar_()) throw new Error('Solo quien publica el tablero puede leer BigQuery.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return estadoPublico_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SNAP_ESTADO', 'corriendo');
  props.setProperty('SNAP_DESDE', String(Date.now()));
  props.deleteProperty('SNAP_ERROR');
  var actualizado = selloBogota();
  var specs = especificaciones_();
  var pendientes = [];
  var fallo = {};
  specs.forEach(function (spec) {
    try {
      spec.ref = lanzarConsulta_(sqlCompacto_(spec));
      pendientes.push(spec);
    } catch (e) {
      fallo[spec.nombre] = e.message;
    }
  });
  var inicio = Date.now();
  // Apps Script corta a los 6 minutos: si BigQuery no termina en 4, se registra el error.
  while (pendientes.length && Date.now() - inicio < 4 * 60 * 1000) {
    var siguen = [];
    pendientes.forEach(function (spec) {
      try {
        if (!jobListo_(spec.ref)) siguen.push(spec);
      } catch (e) {
        fallo[spec.nombre] = e.message;
      }
    });
    pendientes = siguen;
    if (pendientes.length) Utilities.sleep(1500);
  }
  pendientes.forEach(function (spec) {
    if (!fallo[spec.nombre]) fallo[spec.nombre] = 'BigQuery no terminó a tiempo';
  });
  var tablas = leerMeta_().tablas || {};
  var errores = [];
  specs.forEach(function (spec) {
    if (fallo[spec.nombre]) {
      errores.push(spec.nombre + ': ' + fallo[spec.nombre]);
      tablas[spec.nombre] = Object.assign({}, tablas[spec.nombre], { error: fallo[spec.nombre] });
      return;
    }
    try {
      var viejo = tablas[spec.nombre] && tablas[spec.nombre].fileId;
      var info = guardarTabla_(spec);
      tablas[spec.nombre] = info;
      publicarMeta_(actualizado, tablas, errores);
      if (viejo && viejo !== info.fileId) {
        try { DriveApp.getFileById(viejo).setTrashed(true); } catch (e2) {}
      }
    } catch (e) {
      errores.push(spec.nombre + ': ' + e.message);
      tablas[spec.nombre] = Object.assign({}, tablas[spec.nombre], { error: e.message });
    }
  });
  publicarMeta_(actualizado, tablas, errores);
  if (errores.length) {
    props.setProperty('SNAP_ESTADO', 'error');
    props.setProperty('SNAP_ERROR', errores.join(' | '));
    lock.releaseLock();
    throw new Error(errores.join(' | '));
  }
  props.setProperty('SNAP_ESTADO', 'listo');
  props.deleteProperty('SNAP_ERROR');
  lock.releaseLock();
  return resumenMeta_(leerMeta_());
}

function publicarMeta_(actualizado, tablas, errores) {
  PropertiesService.getScriptProperties().setProperty('SNAP_META', JSON.stringify({
    actualizado: actualizado,
    ok: !errores.length,
    tablas: tablas,
    errores: errores,
  }));
}

function snapshotListo_() {
  var meta = leerMeta_();
  return !!(meta.tablas && meta.tablas.detalle && meta.tablas.detalle.fileId);
}

function refreshEnCurso_() {
  var props = PropertiesService.getScriptProperties();
  var estado = props.getProperty('SNAP_ESTADO') || '';
  if (estado !== 'corriendo' && estado !== 'programado') return false;
  var desde = Number(props.getProperty('SNAP_DESDE') || '0');
  var tope = estado === 'programado' ? 5 * 60 * 1000 : 40 * 60 * 1000;
  return Date.now() - desde < tope;
}

function estadoPublico_() {
  var meta = leerMeta_();
  var props = PropertiesService.getScriptProperties();
  return {
    owner: isOwner_(),
    actualizado: meta.actualizado || '',
    listo: snapshotListo_(),
    corriendo: refreshEnCurso_(),
    hora: '7:00',
    errorRefresh: props.getProperty('SNAP_ERROR') || '',
    errores: meta.errores || [],
  };
}

function getBootstrap() {
  if (!usuarioPermitido_()) return { error: 'Sin acceso' };
  var estado = estadoPublico_();
  var meta = leerMeta_();
  var info = (meta.tablas && meta.tablas.detalle) || {};
  estado.filas = info.filas || 0;
  return estado;
}

function getSnapshot(nombre) {
  if (!usuarioPermitido_()) return { error: 'Sin acceso' };
  if (nombre !== 'detalle') return { error: 'Tabla desconocida' };
  var meta = leerMeta_();
  var info = (meta.tablas && meta.tablas.detalle) || {};
  if (!info.fileId) return { error: 'Todavía no está el archivo del día.' };
  var b64 = b64De_(meta.actualizado, info.fileId);
  var partes = Math.max(1, Math.ceil(b64.length / TROZO_B64));
  return { filas: info.filas || 0, actualizado: meta.actualizado || '', partes: partes };
}

function getSnapshotParte(pedido) {
  if (!usuarioPermitido_()) return { error: 'Sin acceso' };
  pedido = pedido || {};
  if (pedido.nombre !== 'detalle') return { error: 'Tabla desconocida' };
  var meta = leerMeta_();
  var info = (meta.tablas && meta.tablas.detalle) || {};
  if (!info.fileId) return { error: 'Todavía no está el archivo del día.' };
  var b64 = b64De_(meta.actualizado, info.fileId);
  var i = Math.max(0, Number(pedido.i) || 0);
  return { b64: b64.substring(i * TROZO_B64, (i + 1) * TROZO_B64) };
}

function b64De_(actualizado, fileId) {
  var b64 = leerCacheSnap_(actualizado);
  if (b64) return b64;
  b64 = Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes());
  guardarCacheSnap_(actualizado, b64);
  return b64;
}

function especificaciones_() {
  return [{
    nombre: 'detalle',
    sql: sqlDetalle_(),
    string: ['pais', 'fase', 'ciudad', 'area', 'zona_grande', 'zm', 'price_way', 'polynator'],
    fecha: ['fecha'],
    numero: ['nid', 'en_capacity'],
  }];
}

function sqlDetalle_() {
  return [
    'WITH base AS (',
    '  SELECT',
    '    CAST(nid AS STRING) AS nid,',
    '    FORMAT_DATE("%F", DATE(fecha)) AS fecha,',
    '    IFNULL(pais, "") AS pais,',
    '    IFNULL(price_type, "") AS fase,',
    '    IFNULL(NULLIF(ciudad, ""), "(sin ciudad)") AS ciudad,',
    '    IFNULL(NULLIF(area_metropolitana, ""), "(sin área)") AS area,',
    '    IFNULL(NULLIF(zona_grande, ""), "(sin zona grande)") AS zona_grande,',
    '    IFNULL(NULLIF(zona_mediana, ""), "(sin zona mediana)") AS zm_nombre,',
    '    CAST(IFNULL(zona_mediana_id, -1) AS STRING) AS zm_id,',
    '    IFNULL(price_way, "") AS price_way,',
    '    IFNULL(polynator, "") AS polynator,',
    '    IF(price_type = "Inicial" AND IFNULL(flag_priceado, 0) != 1, 0, 1) AS en_capacity',
    '  FROM ' + TABLA,
    '  WHERE nid IS NOT NULL',
    '    AND DATE(fecha) <= CURRENT_DATE("America/Bogota")',
    '),',
    'etq AS (',
    '  SELECT * EXCEPT(zm_nombre, zm_id),',
    '    IF(',
    '      COUNT(DISTINCT zm_id) OVER (PARTITION BY zm_nombre) > 1,',
    '      CONCAT(zm_nombre, " · ", zm_id),',
    '      zm_nombre',
    '    ) AS zm',
    '  FROM base',
    ')',
    'SELECT nid, fecha, pais, fase, ciudad, area, zona_grande, zm, price_way, polynator,',
    '  CAST(en_capacity AS STRING) AS en_capacity',
    'FROM etq',
  ].join('\n');
}

function lanzarConsulta_(sql) {
  var job = BigQuery.Jobs.insert({
    configuration: {
      query: { query: sql, useLegacySql: false, priority: 'INTERACTIVE' },
    },
  }, PROYECTO);
  return job.jobReference;
}

function jobListo_(ref) {
  var job = BigQuery.Jobs.get(ref.projectId, ref.jobId, { location: ref.location });
  var estado = job.status || {};
  if (estado.state !== 'DONE') return false;
  if (estado.errorResult) throw new Error(estado.errorResult.message);
  return true;
}

// BigQuery arma el archivo por columnas: un diccionario y los índices de cada texto, los días
// de cada fecha y los números, en el formato que lee Archivo.html. Así Apps Script recibe unas
// pocas filas en lugar de medio millón y la lectura cabe holgada en los 6 minutos.
function sqlCompacto_(spec) {
  var partes = [];
  var dicts = [];
  spec.string.forEach(function (c, n) {
    dicts.push('d' + n + ' AS (SELECT v, ROW_NUMBER() OVER (ORDER BY v) - 1 AS k FROM (SELECT DISTINCT ' + c + ' AS v FROM t WHERE ' + c + ' IS NOT NULL AND ' + c + ' != ""))');
    partes.push('SELECT "' + c + '" AS col, (SELECT TO_JSON_STRING(ARRAY_AGG(v ORDER BY k)) FROM d' + n + ') AS d, '
      + '(SELECT STRING_AGG(CAST(IFNULL(d' + n + '.k, -1) AS STRING), "," ORDER BY t.rn) FROM t LEFT JOIN d' + n + ' ON d' + n + '.v = t.' + c + ') AS i');
  });
  spec.fecha.forEach(function (c) {
    partes.push('SELECT "' + c + '", NULL, STRING_AGG(IFNULL(CAST(UNIX_DATE(SAFE.PARSE_DATE("%F", ' + c + ')) AS STRING), ""), "," ORDER BY rn) FROM t');
  });
  spec.numero.forEach(function (c) {
    partes.push('SELECT "' + c + '", NULL, STRING_AGG(IFNULL(CAST(' + c + ' AS STRING), ""), "," ORDER BY rn) FROM t');
  });
  partes.push('SELECT "__rows", NULL, CAST(COUNT(*) AS STRING) FROM t');
  return 'WITH base AS (\n' + spec.sql + '\n),\n'
    // El orden por el contenido completo de la fila es estable: todas las columnas salen alineadas.
    + 't AS (SELECT b.*, ROW_NUMBER() OVER (ORDER BY TO_JSON_STRING(b)) AS rn FROM base b),\n'
    + dicts.join(',\n') + '\n'
    + partes.join('\nUNION ALL\n');
}

function jsonCompacto_(ref) {
  var cols = {};
  cadaFila_(ref, function (fila) { cols[fila.col] = fila; }, 2);
  var n = Number((cols.__rows || {}).i || 0);
  var trozos = ['"__rows":' + n];
  Object.keys(cols).forEach(function (c) {
    if (c === '__rows') return;
    var fila = cols[c];
    var i = JSON.stringify(fila.i || '');
    trozos.push(JSON.stringify(c) + ':' + (fila.d == null ? i : '{"d":' + (fila.d || '[]') + ',"i":' + i + '}'));
  });
  return { n: n, json: '{' + trozos.join(',') + '}' };
}

function guardarTabla_(spec) {
  var compacto = jsonCompacto_(spec.ref);
  var json = compacto.json;
  var bytes = Utilities.gzip(Utilities.newBlob(json, 'application/json', spec.nombre + '.json')).getBytes();
  if (bytes.length > TOPE_GZIP) throw new Error('El archivo pesa más de 20 MB. Hay que partir la tabla.');
  var archivo = asegurarCarpeta_().createFile(Utilities.newBlob(bytes, 'application/gzip', spec.nombre + '.json.gz'));
  return { filas: compacto.n, bytes: bytes.length, fileId: archivo.getId(), error: '' };
}

function cadaFila_(ref, fn, porPagina) {
  var token = null;
  var campos = null;
  while (true) {
    var opts = { maxResults: porPagina || 20000, location: ref.location };
    if (token) opts.pageToken = token;
    var respuesta = BigQuery.Jobs.getQueryResults(ref.projectId, ref.jobId, opts);
    if (!respuesta.jobComplete) throw new Error('Resultado incompleto');
    if (!campos && respuesta.schema) {
      campos = respuesta.schema.fields.map(function (f) { return f.name; });
    }
    var rows = respuesta.rows || [];
    for (var r = 0; r < rows.length; r++) {
      var obj = {};
      var celdas = rows[r].f;
      for (var c = 0; c < campos.length; c++) obj[campos[c]] = celdas[c].v;
      fn(obj);
    }
    token = respuesta.pageToken;
    if (!token) break;
  }
}

function asegurarCarpeta_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SNAP_FOLDER');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var folder = DriveApp.createFolder(CARPETA_SNAPSHOTS);
  props.setProperty('SNAP_FOLDER', folder.getId());
  return folder;
}

function leerMeta_() {
  var texto = PropertiesService.getScriptProperties().getProperty('SNAP_META') || '';
  if (!texto) return {};
  try { return JSON.parse(texto); } catch (e) { return {}; }
}

function resumenMeta_(meta) {
  var info = (meta.tablas && meta.tablas.detalle) || {};
  return { actualizado: meta.actualizado, ok: meta.ok, filas: info.filas || 0, errores: meta.errores || [] };
}

function guardarCacheSnap_(actualizado, b64) {
  if (!b64 || b64.length > 8 * 1024 * 1024) return;
  var cache = CacheService.getScriptCache();
  var trozo = 90000;
  var n = Math.ceil(b64.length / trozo);
  var lote = {};
  var puestos = 0;
  var base = claveSnap_(actualizado);
  function vaciar() {
    if (!puestos) return;
    cache.putAll(lote, 21600);
    lote = {};
    puestos = 0;
  }
  for (var i = 0; i < n; i++) {
    lote[base + '-' + i] = b64.substring(i * trozo, (i + 1) * trozo);
    puestos++;
    if (puestos === 80) vaciar();
  }
  lote[base + '-n'] = String(n);
  puestos++;
  vaciar();
}

function leerCacheSnap_(actualizado) {
  var cache = CacheService.getScriptCache();
  var base = claveSnap_(actualizado);
  var n = cache.get(base + '-n');
  if (!n) return '';
  var total = Number(n);
  var partes = [];
  for (var i = 0; i < total; i += 80) {
    var claves = [];
    for (var j = i; j < Math.min(total, i + 80); j++) claves.push(base + '-' + j);
    var mapa = cache.getAll(claves);
    for (var k = 0; k < claves.length; k++) {
      if (!mapa[claves[k]]) return '';
      partes.push(mapa[claves[k]]);
    }
  }
  return partes.join('');
}

function claveSnap_(actualizado) {
  return 'seg-snap-' + String(actualizado || '0').replace(/[^A-Za-z0-9_-]/g, '');
}

function emailUsuario_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function isOwner_() {
  var owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '';
  var email = emailUsuario_();
  if (!owner) return true;
  if (!email) return false;
  return email.toLowerCase() === owner.toLowerCase();
}

function puedeRefrescar_() {
  if (!emailUsuario_()) return true;
  return isOwner_();
}

function usuarioPermitido_() {
  var lista = (PropertiesService.getScriptProperties().getProperty('ALLOWED_USERS') || '').trim();
  if (!lista) return true;
  var email = emailUsuario_().toLowerCase();
  if (!email) return false;
  return lista.split(',').some(function (correo) { return correo.trim().toLowerCase() === email; });
}

function assertAllowed_() {
  if (!usuarioPermitido_()) throw new Error('Sin acceso');
}
