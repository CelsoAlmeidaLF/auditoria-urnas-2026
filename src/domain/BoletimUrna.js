/**
 * Boletim de Urna em texto (imgbu.dat): o mesmo boletim impresso e afixado na porta da seção.
 * O arquivo começa com um cabeçalho binário e termina com o BU digital e a assinatura; o meio é texto.
 */

const numero = s => (s == null ? null : parseInt(s.replace(/\./g, ''), 10));

/** @param {string} texto Conteúdo do imgbu.dat decodificado de Latin-1 */
export function lerBoletim(texto) {
  const inicio = texto.indexOf('Justiça Eleitoral');
  if (inicio < 0) return null;
  const fim = texto.indexOf('BU DIGITAL', inicio);
  const corpo = texto.slice(inicio, fim > 0 ? fim : undefined);
  const linhas = corpo.split(/\r?\n/);

  const campo = rotulo => {
    const re = new RegExp(`^\\s*${rotulo}\\s{2,}(\\S.*?)\\s*$`);
    for (const l of linhas) {
      const m = re.exec(l);
      if (m) return m[1];
    }
    return null;
  };
  const municipioIdx = linhas.findIndex(l => /^Município\s+\d+/.test(l));

  const cargos = [];
  let atual = null;
  for (const l of linhas) {
    const titulo = /^-{3,}\s*([A-ZÀ-Ü ]+?)\s*-{3,}$/.exec(l.trim());
    if (titulo && !/^\d/.test(titulo[1])) {
      atual = { cargo: titulo[1], candidatos: [], nominais: null, brancos: null, nulos: null, apurado: null };
      cargos.push(atual);
      continue;
    }
    if (!atual) continue;
    const cand = /^\s{2}(\S.*?)\s{2,}(\d{1,5})\s+(\d{1,4})\s*$/.exec(l);
    if (cand) { atual.candidatos.push({ nome: cand[1], numero: cand[2], votos: +cand[3] }); continue; }
    const tot = /^(Total de votos Nominais|Brancos|Nulos|Total Apurado)\s+(\d+)\s*$/.exec(l.trim());
    if (tot) atual[{ 'Total de votos Nominais': 'nominais', Brancos: 'brancos', Nulos: 'nulos', 'Total Apurado': 'apurado' }[tot[1]]] = +tot[2];
  }

  const habilitacao = {};
  for (const l of linhas) {
    const m = /^\s*Habilitação (.+?)\s+(\d+)\s*$/.exec(l);
    if (m) habilitacao[m[1]] = +m[2];
  }
  const turno = /(\d)° Turno/.exec(corpo);
  const data = /\((\d{2}\/\d{2}\/\d{4})\)/.exec(corpo);

  return {
    uf: /Tribunal Regional Eleitoral \[([A-Z]{2})\]/.exec(corpo)?.[1] ?? null,
    turno: turno ? +turno[1] : null,
    data: data?.[1] ?? null,
    municipio: municipioIdx >= 0 ? { codigo: linhas[municipioIdx].match(/\d+/)[0], nome: linhas[municipioIdx + 1]?.trim() } : null,
    zona: campo('Zona Eleitoral'),
    local: campo('Local de Votação'),
    secao: campo('Seção Eleitoral'),
    aptos: numero(campo('Eleitores aptos')),
    comparecimento: numero(campo('Comparecimento')),
    faltosos: numero(campo('Eleitores faltosos')),
    habilitacao,
    codigoUrna: campo('Código identificação UE'),
    abertura: { data: campo('Data de abertura da UE'), hora: campo('Horário de abertura') },
    fechamento: { data: campo('Data de fechamento da UE'), hora: campo('Horário de fechamento') },
    cargos: cargos.filter(c => c.candidatos.length || c.apurado != null)
  };
}
