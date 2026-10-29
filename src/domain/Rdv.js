/**
 * Registro Digital do Voto (rdv.dat): cada voto da urna gravado em separado, em posição embaralhada,
 * sem horário e sem ligação com o eleitor (é o que garante o sigilo). ASN.1 (DER), como o bu.dat.
 *
 * Para cada cargo, uma lista de votos { tipo, digitado }:
 *   tipo 1 = legenda (o voto vai para o partido: os 2 primeiros dígitos do que foi digitado; ex.: "138" → partido 13)
 *   tipo 2 = nominal (digitado = número do candidato)
 *   tipo 3 = branco
 *   tipos 4, 6 e 7 = nulo (4 traz o que o eleitor digitou; 6 e 7 são outras formas de nulo, somadas como nulo no boletim)
 * Conferido com o boletim (bu.dat): todas as urnas de Roraima no 2º turno e seções do 1º turno (6 cargos).
 */
import { lerDer } from './BuDat.js?v=20261029-1825';

const CARGOS = { 1: 'PRESIDENTE', 3: 'GOVERNADOR', 5: 'SENADOR', 6: 'DEPUTADO FEDERAL', 7: 'DEPUTADO ESTADUAL', 8: 'DEPUTADO DISTRITAL', 11: 'PREFEITO', 13: 'VEREADOR' };
export const TIPO_VOTO = { 1: 'legenda', 2: 'nominal', 3: 'branco', 4: 'nulo', 6: 'nulo', 7: 'nulo' };

const inteiro = no => {
  let v = 0;
  for (const b of no?.bytes || []) v = v * 256 + b;
  return v;
};
const texto = no => (no && !no.construido ? new TextDecoder('latin1').decode(no.bytes) : '');

/**
 * @param {Uint8Array} bytes
 * @returns {{ cargos: { codigo: number, cargo: string, votos: { tipo: string, digitado: string }[] }[] }}
 */
export function lerRdv(bytes) {
  const raiz = lerDer(bytes)[0];
  const conteudo = raiz?.filhos?.find((n, i) => i >= 2 && n.classe === 0 && n.tag === 16 && n.filhos?.some(f => f.classe === 2 && f.tag === 1));
  const eleicoes = conteudo?.filhos.find(n => n.classe === 2 && n.tag === 1);
  if (!eleicoes) throw new Error('rdv.dat sem a lista de votos.');
  const cargos = [];
  for (const eleicao of eleicoes.filhos) {
    const lista = eleicao.filhos.find(n => n.classe === 0 && n.tag === 16);
    for (const cargo of lista?.filhos || []) {
      const codigo = inteiro(cargo.filhos[0]);
      const votos = (cargo.filhos.find(n => n.classe === 0 && n.tag === 16)?.filhos || []).map(v => {
        const codigoTipo = inteiro(v.filhos[0]);
        return { tipo: TIPO_VOTO[codigoTipo] || `tipo ${codigoTipo}`, codigoTipo, digitado: texto(v.filhos[1]) };
      });
      cargos.push({ codigo, cargo: CARGOS[codigo] || `CARGO ${codigo}`, votos });
    }
  }
  return { cargos };
}

/** Soma por número (nominais e de legenda), brancos e nulos; nulos agrupados pelo que foi digitado */
export function somarRdv(cargo) {
  const porNumero = {};
  const nulosDigitados = {};
  let brancos = 0, nulos = 0;
  for (const v of cargo.votos) {
    if (v.tipo === 'nominal') porNumero[v.digitado] = (porNumero[v.digitado] || 0) + 1;
    else if (v.tipo === 'legenda') { const p = v.digitado.slice(0, 2); porNumero[p] = (porNumero[p] || 0) + 1; }
    else if (v.tipo === 'branco') brancos++;
    else if (v.tipo === 'nulo') { nulos++; const d = v.digitado || '(nada)'; nulosDigitados[d] = (nulosDigitados[d] || 0) + 1; }
  }
  return { porNumero, brancos, nulos, nulosDigitados, total: cargo.votos.length };
}

/**
 * Confere o RDV com o boletim (mesmo cargo): votos por número, brancos e nulos.
 * @returns {{ cargo: string, confere: boolean, diferencas: string[] }[]}
 */
export function conferirComBoletim(rdv, boletim) {
  return rdv.cargos.map(c => {
    const s = somarRdv(c);
    const b = boletim?.cargos?.find(x => x.cargo === c.cargo);
    if (!b) return { cargo: c.cargo, confere: null, diferencas: ['cargo não está no boletim aberto'] };
    const diferencas = [];
    for (const cand of b.candidatos) {
      const r = s.porNumero[cand.numero] || 0;
      if (r !== cand.votos) diferencas.push(`${cand.numero}: boletim ${cand.votos}, RDV ${r}`);
    }
    for (const n of Object.keys(s.porNumero)) if (!b.candidatos.some(x => x.numero === n)) diferencas.push(`${n}: ${s.porNumero[n]} no RDV e ausente do boletim`);
    if (b.brancos != null && b.brancos !== s.brancos) diferencas.push(`brancos: boletim ${b.brancos}, RDV ${s.brancos}`);
    if (b.nulos != null && b.nulos !== s.nulos) diferencas.push(`nulos: boletim ${b.nulos}, RDV ${s.nulos}`);
    return { cargo: c.cargo, confere: diferencas.length === 0, diferencas };
  });
}
