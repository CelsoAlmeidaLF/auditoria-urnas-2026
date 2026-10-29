/**
 * Boletim de Urna digital (bu.dat): o mesmo boletim, em ASN.1 (DER), que a urna assina e o TSE publica
 * no site de resultados. Lê só o que o app compara com o log: urna, horários, comparecimento,
 * eleitores liberados pela digital e votos por número em cada cargo.
 * Mapeamento conferido com os boletins em texto (imgbu.dat) de todas as urnas de Roraima no 2º turno de 2026.
 */

const CARGOS = { 1: 'PRESIDENTE', 3: 'GOVERNADOR', 5: 'SENADOR', 6: 'DEPUTADO FEDERAL', 7: 'DEPUTADO ESTADUAL', 8: 'DEPUTADO DISTRITAL', 11: 'PREFEITO', 13: 'VEREADOR' };

// Limites contra arquivos malformados ou maliciosos: o bu.dat real tem ~10 níveis e poucos milhares de nós
const PROFUNDIDADE_MAXIMA = 32;
const NOS_MAXIMOS = 200000;

/** Árvore DER: { classe, tag, construido, filhos?, bytes } */
export function lerDer(bytes, inicio = 0, fim = bytes.length, prof = 0, contador = { nos: 0 }) {
  if (prof > PROFUNDIDADE_MAXIMA) throw new Error('Arquivo ASN.1 com aninhamento além do esperado.');
  const nos = [];
  let i = inicio;
  while (i < fim) {
    if (++contador.nos > NOS_MAXIMOS) throw new Error('Arquivo ASN.1 com elementos demais.');
    const t = bytes[i++];
    let tag = t & 0x1f;
    if (tag === 0x1f) {
      tag = 0;
      let x;
      do { x = bytes[i++]; tag = tag * 128 + (x & 0x7f); } while (x & 0x80 && i < fim);
    }
    let tam = bytes[i++];
    if (tam & 0x80) {
      const n = tam & 0x7f;
      if (n > 6) throw new Error('Comprimento ASN.1 inválido.');
      tam = 0;
      for (let k = 0; k < n; k++) tam = tam * 256 + bytes[i++];
    }
    if (!Number.isFinite(tam) || i + tam > fim) throw new Error('Arquivo ASN.1 truncado ou inválido.');
    const no = { classe: t >> 6, tag, construido: !!(t & 0x20), bytes: bytes.subarray(i, i + tam) };
    if (no.construido) no.filhos = lerDer(bytes, i, i + tam, prof + 1, contador);
    nos.push(no);
    i += tam;
  }
  return nos;
}

const inteiro = no => {
  if (!no || no.construido) return null;
  let v = 0;
  for (const b of no.bytes) v = v * 256 + b;
  return no.bytes[0] & 0x80 ? v - 2 ** (8 * no.bytes.length) : v;
};
const texto = no => (no && !no.construido ? new TextDecoder('latin1').decode(no.bytes) : null);
const universal = (no, tag) => no && no.classe === 0 && no.tag === tag;
const contexto = (no, tag) => no && no.classe === 2 && no.tag === tag;
const hora = s => (s && /^\d{8}T\d{6}$/.test(s) ? { data: `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`, hora: `${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}` } : null);

/** @param {Uint8Array} bytes */
export function lerBuDat(bytes) {
  const envelope = lerDer(bytes)[0];
  const conteudo = envelope?.filhos?.find(n => universal(n, 4) && n.bytes.length > 50);
  if (!conteudo) throw new Error('bu.dat sem conteúdo.');
  const bu = lerDer(conteudo.bytes)[0];
  const c = bu.filhos;

  // Urna: [2] → correspondência → carga → número interno da urna
  const carga = c[2]?.filhos?.find(n => universal(n, 16))?.filhos?.find(n => universal(n, 16));
  const codigoUrna = inteiro(carga?.filhos?.[0]);

  // Horários de abertura e encerramento: [0] com dois GeneralString
  const horarios = c.find(n => contexto(n, 0) && n.filhos?.length === 2 && universal(n.filhos[0], 27));
  const abertura = hora(texto(horarios?.filhos[0]));
  const fechamento = hora(texto(horarios?.filhos[1]));

  // Liberados por biometria e sem ela: [1] com três inteiros
  const lib = c.find(n => contexto(n, 1) && n.filhos?.length === 3 && n.filhos.every(f => universal(f, 2)));
  const habilitacao = lib ? { 'sem biometria': inteiro(lib.filhos[0]), 'biométrica': inteiro(lib.filhos[1]), 'biográfica': inteiro(lib.filhos[2]) } : {};

  // Resultados: SEQUENCE de eleições → { id, aptos, ..., resultados[ { tipo, comparecimento, cargos[...] } ] }
  const eleicoes = c.find((n, i) => i > 4 && universal(n, 16) && n.filhos?.every(e => universal(e, 16) && universal(e.filhos?.[0], 2)));
  // A urna pode ter mais de uma eleição no mesmo dia (ex.: 2º turno + eleição municipal suplementar).
  // Cada eleição tem os seus aptos e o seu comparecimento; quem vota em pelo menos uma conta na urna.
  const listaEleicoes = [];
  const cargos = [];
  for (const eleicao of eleicoes?.filhos || []) {
    const dadosEleicao = { id: inteiro(eleicao.filhos[0]), aptos: inteiro(eleicao.filhos[1]), comparecimento: null, cargos: [] };
    listaEleicoes.push(dadosEleicao);
    const resultados = eleicao.filhos.find(n => universal(n, 16));
    for (const resultado of resultados?.filhos || []) {
      dadosEleicao.comparecimento = Math.max(dadosEleicao.comparecimento ?? 0, inteiro(resultado.filhos[1]));
      const totais = resultado.filhos.find(n => universal(n, 16));
      for (const cargo of totais?.filhos || []) {
        const codigo = inteiro(cargo.filhos.find(n => contexto(n, 1)));
        const votos = cargo.filhos.find(n => universal(n, 16));
        const item = { cargo: CARGOS[codigo] || `CARGO ${codigo}`, candidatos: [], brancos: 0, nulos: 0, nominais: 0, legenda: 0, apurado: 0 };
        for (const v of votos?.filhos || []) {
          const tipo = inteiro(v.filhos.find(n => contexto(n, 1)));
          const qtd = inteiro(v.filhos.find(n => contexto(n, 2))) ?? 0;
          const id = v.filhos.find(n => contexto(n, 3));
          item.apurado += qtd;
          if (tipo === 1 || tipo === 4) {
            const numero = inteiro(id?.filhos?.at(-1));
            item[tipo === 1 ? 'nominais' : 'legenda'] += qtd;
            item.candidatos.push({ nome: null, numero: String(numero), votos: qtd, legenda: tipo === 4 });
          } else if (tipo === 2) item.brancos += qtd;
          else if (tipo === 3) item.nulos += qtd;
        }
        cargos.push(item);
      }
    }
  }
  // Comparecimento e aptos da urna: os da eleição com mais eleitores (todo eleitor da urna vota nela)
  const principal = listaEleicoes.reduce((m, e) => ((e.comparecimento ?? -1) > (m?.comparecimento ?? -1) ? e : m), null);
  return {
    fonte: 'bu.dat', codigoUrna: codigoUrna != null ? String(codigoUrna).padStart(8, '0') : null, abertura, fechamento,
    aptos: principal?.aptos ?? null, comparecimento: principal?.comparecimento ?? null, eleicoes: listaEleicoes.map(({ cargos: _, ...e }) => e),
    habilitacao, data: abertura?.data ?? null, cargos
  };
}
