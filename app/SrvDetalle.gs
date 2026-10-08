/**
 * Tabla de nid: una página de 50 filas y el CSV del recorte.
 */
function paginaDetalle(pedido) {
  pedido = pedido || {};
  var corte = pedido.corte || hoyBogota();
  var pagina = Math.max(0, Number(pedido.pagina) || 0);
  var filtro = clausulas(pedido, corte);
  var total = Number(consultar(
    'SELECT COUNT(*) AS total FROM (' + sqlBase() + ') WHERE ' + filtro.where,
    filtro.params
  )[0].total);
  var ultima = Math.max(0, Math.ceil(total / 50) - 1);
  if (pagina > ultima) pagina = ultima;
  var params = filtro.params.concat([pInt('limite', 50), pInt('salto', pagina * 50)]);
  var filas = consultar(
    'SELECT nid, FORMAT_DATE("%F", fecha) AS fecha, ciudad, zona_grande, area, fase, polynator, price_way AS metodo ' +
    'FROM (' + sqlBase() + ') WHERE ' + filtro.where +
    ' ORDER BY fecha DESC, nid DESC LIMIT @limite OFFSET @salto',
    params
  );
  return {
    total: total,
    pagina: pagina,
    filas: filas.map(function (f) {
      return {
        nid: f.nid,
        fecha: fechaCorta(f.fecha),
        ciudad: f.ciudad,
        zona_grande: f.zona_grande,
        area: f.area,
        fase: rotulo(f.fase),
        polynator: f.polynator,
        metodo: f.metodo,
      };
    }),
  };
}

function csvDetalle(pedido) {
  pedido = pedido || {};
  var corte = pedido.corte || hoyBogota();
  var filtro = clausulas(pedido, corte);
  var total = Number(consultar(
    'SELECT COUNT(*) AS total FROM (' + sqlBase() + ') WHERE ' + filtro.where,
    filtro.params
  )[0].total);
  if (total > TOPE_CSV) {
    return {
      error: 'Hay ' + miles(total) + ' nid en este recorte. Acota país, fase o zona: la descarga llega hasta ' + miles(TOPE_CSV) + '.',
    };
  }
  var params = filtro.params.concat([pInt('limite', TOPE_CSV), pInt('salto', 0)]);
  var filas = consultar(
    'SELECT nid, FORMAT_DATE("%F", fecha) AS fecha, ciudad, zona_grande, area, fase, polynator, price_way AS metodo ' +
    'FROM (' + sqlBase() + ') WHERE ' + filtro.where +
    ' ORDER BY fecha DESC, nid DESC LIMIT @limite OFFSET @salto',
    params
  );
  var lineas = ['Nid;Fecha;Ciudad;Zona grande;Área;Fase;Polynator;Método'];
  filas.forEach(function (f) {
    lineas.push([
      f.nid, fechaCorta(f.fecha), f.ciudad, f.zona_grande, f.area, rotulo(f.fase), f.polynator, f.metodo,
    ].map(celdaCsv).join(';'));
  });
  var nombre = 'seguimiento-automatizacion-' + corte + '.csv';
  return { csv: lineas.join('\n'), nombre: nombre };
}

function sqlBase() {
  return '' +
    'SELECT nid, DATE(fecha) AS fecha, pais, price_type AS fase, ' +
    'IFNULL(NULLIF(ciudad, ""), "(sin ciudad)") AS ciudad, ' +
    'IFNULL(NULLIF(area_metropolitana, ""), "(sin área)") AS area, ' +
    'IFNULL(NULLIF(zona_grande, ""), "(sin zona grande)") AS zona_grande, ' +
    'IF(COUNT(DISTINCT CAST(IFNULL(zona_mediana_id, -1) AS STRING)) OVER (PARTITION BY IFNULL(NULLIF(zona_mediana, ""), "(sin zona mediana)")) > 1, ' +
    'CONCAT(IFNULL(NULLIF(zona_mediana, ""), "(sin zona mediana)"), " · ", CAST(IFNULL(zona_mediana_id, -1) AS STRING)), ' +
    'IFNULL(NULLIF(zona_mediana, ""), "(sin zona mediana)")) AS zm, ' +
    'price_way, polynator, ' +
    'IF(price_type = "Inicial" AND IFNULL(flag_priceado, 0) != 1, 0, 1) AS en_capacity ' +
    'FROM ' + TABLA + ' ' +
    'WHERE DATE(fecha) <= @corte AND nid IS NOT NULL';
}

function clausulas(pedido, corte) {
  var where = ['1 = 1'];
  var params = [pDate('corte', corte)];
  if (pedido.tipo === 'Capacity') where.push('en_capacity = 1');
  if (pedido.pais) {
    where.push('pais = @pais');
    params.push(pString('pais', pedido.pais));
  }
  agregarIn(where, params, 'fase', 'fases', pedido.fases);
  agregarIn(where, params, 'area', 'areas', pedido.areas);
  agregarIn(where, params, 'zona_grande', 'zgs', pedido.zgs);
  agregarIn(where, params, 'zm', 'zms', pedido.zms);
  if (pedido.nid) {
    where.push('CAST(nid AS STRING) LIKE CONCAT("%", @nid, "%")');
    params.push(pString('nid', String(pedido.nid)));
  }
  return { where: where.join(' AND '), params: params };
}

function agregarIn(where, params, columna, nombre, valores) {
  valores = valores || [];
  if (!valores.length) return;
  where.push(columna + ' IN UNNEST(@' + nombre + ')');
  params.push(pArray(nombre, valores.map(String)));
}
