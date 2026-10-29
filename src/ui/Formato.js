/** Escape e formatação para o HTML montado em string */
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const br = n => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
export const duracao = s => (s == null ? '—' : s < 120 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);
export const semZeros = s => (s == null ? '' : String(+s));

/** Nome da seção para títulos: "Seção 11 · Zona 4 · Caroebe (RR)" */
export function nomeDaSecao(urna, boletim) {
  const municipio = urna.nomeMunicipio || boletim?.municipio?.nome || (urna.municipio ? `município ${urna.municipio}` : null);
  const partes = [];
  if (urna.secao || boletim?.secao) partes.push(`Seção ${semZeros(urna.secao || boletim.secao)}`);
  if (urna.zona || boletim?.zona) partes.push(`Zona ${semZeros(urna.zona || boletim.zona)}`);
  if (municipio) partes.push(`${titulo(municipio)}${urna.uf ? ` (${urna.uf})` : ''}`);
  return partes.join(' · ') || 'Log aberto do computador';
}

export const titulo = s => String(s).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, m => m.toLowerCase());
