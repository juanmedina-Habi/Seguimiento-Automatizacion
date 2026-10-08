/**
 * Gráficas. cargarGraficas() es lo que llama la página al abrir y al cambiar un filtro.
 */
function cargarGraficas(pedido) {
  pedido = pedido || {};
  var corte = pedido.corte || hoyBogota();
  var forzar = !!pedido.forzar;
  var clave = 'series-' + claveCorta(JSON.stringify({
    corte: corte,
    tipo: pedido.tipo || 'General',
    pais: pedido.pais || '',
    fases: pedido.fases || [],
    areas: pedido.areas || [],
    zgs: pedido.zgs || [],
    zms: pedido.zms || [],
  }));
  var paquete = forzar ? null : leerJson(clave);
  if (!paquete) {
    paquete = {
      actualizado: selloBogota(),
      filas: seriesDesde(consultar(sqlSeries(), paramsSeries(pedido, corte))),
    };
    guardarJson(clave, paquete);
  }
  var respuesta = { corte: corte, actualizado: paquete.actualizado, filas: paquete.filas };
  if (pedido.conCatalogos) {
    var catalogos = forzar ? null : leerCatalogos(corte);
    if (!catalogos) {
      catalogos = catalogosDesde(consultar(sqlCatalogos(), [pDate('corte', corte)]));
      guardarCatalogos(corte, catalogos);
    }
    respuesta.catalogos = catalogos;
  }
  return respuesta;
}

function sqlSeries() {
  return '' +
    'WITH base AS (' +
    'SELECT DATE(fecha) AS fecha, pais, price_type, ' +
    'IFNULL(NULLIF(area_metropolitana, ""), "(sin área)") AS area, ' +
    'IFNULL(NULLIF(zona_grande, ""), "(sin zona grande)") AS zona_grande, ' +
    'IFNULL(NULLIF(zona_mediana, ""), "(sin zona mediana)") AS zm_nombre, ' +
    'CAST(IFNULL(zona_mediana_id, -1) AS STRING) AS zm_id, ' +
    'price_way, polynator, IFNULL(flag_priceado, 0) AS flag_priceado, nid ' +
    'FROM ' + TABLA + ' WHERE DATE(fecha) <= @corte), ' +
    'etq AS (SELECT *, IF(COUNT(DISTINCT zm_id) OVER (PARTITION BY zm_nombre) > 1, ' +
    'CONCAT(zm_nombre, " · ", zm_id), zm_nombre) AS zm FROM base) ' +
    'SELECT FORMAT_DATE("%F", DATE_TRUNC(fecha, MONTH)) AS mes, price_way, polynator, COUNT(nid) AS n ' +
    'FROM etq WHERE (@sinPais OR pais = @pais) ' +
    'AND (@sinFases OR price_type IN UNNEST(@fases)) ' +
    'AND (@sinAreas OR area IN UNNEST(@areas)) ' +
    'AND (@sinZg OR zona_grande IN UNNEST(@zgs)) ' +
    'AND (@sinZm OR zm IN UNNEST(@zms)) ' +
    'AND (@general OR NOT (price_type = "Inicial" AND flag_priceado != 1)) ' +
    'GROUP BY 1, 2, 3';
}

function sqlCatalogos() {
  return '' +
    'WITH base AS (' +
    'SELECT pais, price_type AS fase, ' +
    'IFNULL(NULLIF(area_metropolitana, ""), "(sin área)") AS area, ' +
    'IFNULL(NULLIF(zona_grande, ""), "(sin zona grande)") AS zona_grande, ' +
    'IFNULL(NULLIF(zona_mediana, ""), "(sin zona mediana)") AS zm_nombre, ' +
    'CAST(IFNULL(zona_mediana_id, -1) AS STRING) AS zm_id ' +
    'FROM ' + TABLA + ' WHERE DATE(fecha) <= @corte), ' +
    'etq AS (SELECT pais, fase, area, zona_grande, ' +
    'IF(COUNT(DISTINCT zm_id) OVER (PARTITION BY zm_nombre) > 1, ' +
    'CONCAT(zm_nombre, " · ", zm_id), zm_nombre) AS zm FROM base) ' +
    'SELECT "pais" AS dim, pais AS valor FROM etq GROUP BY 2 ' +
    'UNION ALL SELECT "fase", fase FROM etq GROUP BY 2 ' +
    'UNION ALL SELECT "area", area FROM etq GROUP BY 2 ' +
    'UNION ALL SELECT "zg", zona_grande FROM etq GROUP BY 2 ' +
    'UNION ALL SELECT "zm", zm FROM etq GROUP BY 2';
}

function paramsSeries(pedido, corte) {
  var fases = pedido.fases || [];
  var areas = pedido.areas || [];
  var zgs = pedido.zgs || [];
  var zms = pedido.zms || [];
  return [
    pDate('corte', corte),
    pBool('sinPais', !pedido.pais),
    pString('pais', pedido.pais || ''),
    pBool('sinFases', fases.length === 0),
    pArray('fases', fases.length ? fases : ['']),
    pBool('sinAreas', areas.length === 0),
    pArray('areas', areas.length ? areas : ['']),
    pBool('sinZg', zgs.length === 0),
    pArray('zgs', zgs.length ? zgs : ['']),
    pBool('sinZm', zms.length === 0),
    pArray('zms', zms.length ? zms : ['']),
    pBool('general', pedido.tipo !== 'Capacity'),
  ];
}

function seriesDesde(filas) {
  var auto = {}, manual = {}, si = {}, no = {};
  filas.forEach(function (r) {
    var n = Number(r.n) || 0;
    if (r.price_way === 'Automático') auto[r.mes] = (auto[r.mes] || 0) + n;
    else if (r.price_way === 'Manual') manual[r.mes] = (manual[r.mes] || 0) + n;
    if (r.polynator === 'Si') si[r.mes] = (si[r.mes] || 0) + n;
    else if (r.polynator === 'No') no[r.mes] = (no[r.mes] || 0) + n;
  });
  var meses = {};
  [auto, manual, si, no].forEach(function (mapa) {
    Object.keys(mapa).forEach(function (mes) { meses[mes] = true; });
  });
  var salida = [];
  Object.keys(meses).sort().forEach(function (mes) {
    var a = auto[mes] || 0;
    var m = manual[mes] || 0;
    var s = si[mes] || 0;
    var o = no[mes] || 0;
    if (a) salida.push({ indicador: 'Nivel de automatización', serie: 'Automático', periodicidad: 'mensual', fecha: mes, valor: a });
    if (m) salida.push({ indicador: 'Nivel de automatización', serie: 'Manual', periodicidad: 'mensual', fecha: mes, valor: m });
    if (a + m) salida.push({ indicador: 'Porcentaje de automatización', serie: '% de automatización', periodicidad: 'mensual', fecha: mes, valor: a / (a + m) * 100 });
    if (s) salida.push({ indicador: 'Precios usando Polynator', serie: 'Si', periodicidad: 'mensual', fecha: mes, valor: s });
    if (o) salida.push({ indicador: 'Precios usando Polynator', serie: 'No', periodicidad: 'mensual', fecha: mes, valor: o });
    if (s + o) salida.push({ indicador: 'Porcentaje de uso Polynator', serie: '% de uso Polynator', periodicidad: 'mensual', fecha: mes, valor: s / (s + o) * 100 });
  });
  return salida;
}

function catalogosDesde(filas) {
  var bolsas = { pais: [], fase: [], area: [], zg: [], zm: [] };
  filas.forEach(function (r) {
    if (bolsas[r.dim] && bolsas[r.dim].indexOf(r.valor) === -1) bolsas[r.dim].push(r.valor);
  });
  function ordenar(lista, preferido) {
    var cabeza = (preferido || []).filter(function (v) { return lista.indexOf(v) !== -1; });
    var resto = lista.filter(function (v) { return cabeza.indexOf(v) === -1; });
    resto.sort(function (a, b) { return String(a).localeCompare(String(b), 'es'); });
    return cabeza.concat(resto);
  }
  return {
    pais: ordenar(bolsas.pais, ['Colombia', 'Mexico']),
    fase: ordenar(bolsas.fase, ['Inicial', 'Comite']),
    area: ordenar(bolsas.area),
    zg: ordenar(bolsas.zg),
    zm: ordenar(bolsas.zm),
  };
}
