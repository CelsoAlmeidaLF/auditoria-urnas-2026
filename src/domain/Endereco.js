/**
 * Endereço dos locais de votação do TSE (campo DS_ENDERECO, texto livre) separado em rua, número e complemento.
 * O bairro (NM_BAIRRO) e o CEP (NR_CEP) vêm em campos próprios. O texto original fica sempre ao lado para conferência.
 *
 * Formatos encontrados no cadastro de 2026:
 *   "RUA PERU, 34"                         → RUA PERU | 34
 *   "RUA 04 937"                           → RUA 04 | 937
 *   "AV. BRASIL, S/N, POVOADO GUARANI"     → AV. BRASIL | s/n | POVOADO GUARANI
 *   "RUA SARDINHA 389 - 3627-4055"         → RUA SARDINHA | 389 (telefone descartado)
 *   "RUA X, Nº 120 - CENTRO"               → RUA X | 120 | CENTRO
 *   "POVOADO BELA VISTA"                   → POVOADO BELA VISTA | (sem número no cadastro)
 */

const NUMERO = String.raw`(?:S\/?N|SN|N[º°O]?\.?\s*\d+[A-Z]?|\d+[A-Z]?)`;
const SO_NUMERO = new RegExp(`^${NUMERO}$`, 'i');
const COMECA_COM_NUMERO = new RegExp(`^(${NUMERO})\\b\\s*[-,]?\\s*(.*)$`, 'i');
const TERMINA_COM_NUMERO = new RegExp(`^(.*\\S)\\s+(${NUMERO})(?:\\s*[-,]\\s*(.*))?$`, 'i');
// Telefones colados no endereço: "- FONE 85234901", "- 3627-4055", "(83) 3333-4444"
const TELEFONE = /\s*[-–]?\s*(?:FONE|TEL\.?|TELEFONE)?:?\s*(?:\(\d{2}\)\s*)?\d{4,5}-?\d{4}\b/gi;
// Rodovias: o número faz parte do nome ("BR 101", "SC 438"), não é o número do imóvel
const RODOVIA = /\b(?:BR|[A-Z]{2})[- ]?$/;

const limpar = s => (s || '').replace(/\s+/g, ' ').replace(/^[\s,;-]+|[\s,;-]+$/g, '').trim();

function normalizarNumero(n) {
  if (!n) return '';
  if (/^S\/?N$|^SN$/i.test(n)) return 's/n';
  return n.replace(/^N[º°O]?\.?\s*/i, '').replace(/^0+(?=\d)/, '');
}

/** @returns {{ rua: string, numero: string, complemento: string }} */
export function separarEndereco(texto) {
  const original = limpar(String(texto || '').replace(TELEFONE, ''));
  if (!original) return { rua: '', numero: '', complemento: '' };

  // 1) Com vírgula: "RUA X, 123 - COMPLEMENTO" ou "RUA X, QD. 19, BAIRRO"
  const virgula = original.indexOf(',');
  if (virgula > 0) {
    const rua = limpar(original.slice(0, virgula));
    const resto = limpar(original.slice(virgula + 1));
    const m = COMECA_COM_NUMERO.exec(resto);
    if (m) return { rua, numero: normalizarNumero(m[1]), complemento: limpar(m[2]) };
    // número no fim da rua antes da vírgula: "RUA X 123, BAIRRO"
    const f = TERMINA_COM_NUMERO.exec(rua);
    if (f && !RODOVIA.test(f[1])) return { rua: limpar(f[1]), numero: normalizarNumero(f[2]), complemento: resto };
    return { rua, numero: '', complemento: resto };
  }

  // 2) Sem vírgula: "RUA X 123 - COMPLEMENTO", "RUA X S/N"
  const m = TERMINA_COM_NUMERO.exec(original);
  if (m && !RODOVIA.test(m[1]) && !SO_NUMERO.test(m[1])) {
    return { rua: limpar(m[1]), numero: normalizarNumero(m[2]), complemento: limpar(m[3]) };
  }
  // 3) Sem número: "POVOADO BELA VISTA - ZONA RURAL"
  const traco = original.split(/\s+-\s+/);
  return { rua: limpar(traco[0]), numero: '', complemento: limpar(traco.slice(1).join(' - ')) };
}

/** "69378000" → "69378-000"; vazio quando o cadastro não traz CEP válido */
export function formatarCep(cep) {
  const d = String(cep || '').replace(/\D/g, '');
  return d.length === 8 && !/^0+$/.test(d) ? `${d.slice(0, 5)}-${d.slice(5)}` : '';
}

/**
 * Coordenada do TSE ("-10,5721373", ",80202572") em número; null se fora do intervalo válido.
 * @param {'lat'|'lon'} eixo @param {boolean} exterior seções no exterior podem estar em qualquer lugar do mundo
 */
export function coordenada(valor, eixo, exterior = false) {
  const s = String(valor || '').trim().replace(',', '.');
  if (!s || s === '-1' || /NULO/i.test(s)) return null;
  const n = Number(s.startsWith('.') ? `0${s}` : s.startsWith('-.') ? `-0${s.slice(1)}` : s);
  if (!Number.isFinite(n) || n === 0) return null;
  if (exterior) return Math.abs(n) <= (eixo === 'lat' ? 90 : 180) ? n : null;
  return eixo === 'lat' ? (n >= -34 && n <= 6 ? n : null) : (n >= -74.5 && n <= -32 ? n : null);
}

/** Link para o mapa (OpenStreetMap) a partir das coordenadas, ou busca pelo endereço quando não há coordenadas */
export function linkDoMapa({ lat, lon, rua, numero, bairro, municipio, uf, cep }) {
  if (Number.isFinite(lat) && Number.isFinite(lon)) return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
  const q = [rua && `${rua}${numero && numero !== 's/n' ? `, ${numero}` : ''}`, bairro, municipio, uf, cep, 'Brasil'].filter(Boolean).join(', ');
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
}
