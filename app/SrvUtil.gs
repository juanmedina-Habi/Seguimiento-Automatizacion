/**
 * Fechas de Bogotá, rótulos y el formato del CSV.
 */
function miles(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
var CACHE_SEG = 900;

function hoyBogota() {
  return Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
}
function selloBogota() {
  return Utilities.formatDate(new Date(), 'America/Bogota', "yyyy-MM-dd'T'HH:mm:ss") + '-05:00';
}
function fechaCorta(iso) {
  if (!iso) return '';
  var p = String(iso).split('-');
  return Number(p[2]) + '/' + Number(p[1]) + '/' + p[0];
}
function rotulo(v) {
  if (v === 'Comite') return 'Comité';
  if (v === 'Mexico') return 'México';
  return v == null ? '' : String(v);
}
function celdaCsv(v) {
  var s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
