/**
 * Métricas de um dia de votação tiradas do log, para somar por estado e por país.
 * Contagens são somáveis; tempos vão em faixas (somáveis) e em soma + quantidade (para a média).
 *
 * Ciclo de um eleitor no log:
 *   "Identificador do eleitor digitado pelo mesário" → (digital: "Solicita digital. Tentativa [n]")
 *   → (sem digital: "Solicitação de dado pessoal … habilitação manual") → "Eleitor foi habilitado"
 *   → "Voto confirmado para [cargo]" … → "O voto do eleitor foi computado"
 */

export const FAIXAS_CABINE = [[30, 'até 29 s'], [60, '30–59 s'], [120, '1–2 min'], [300, '2–5 min'], [Infinity, '5 min ou mais']];
export const FAIXAS_ATENDIMENTO = [[60, 'até 1 min'], [120, '1–2 min'], [180, '2–3 min'], [300, '3–5 min'], [Infinity, '5 min ou mais']];

const faixa = (s, faixas) => faixas.find(([lim]) => s < lim)[1];
const normalizar = msg => msg.replace(/\d+/g, '#');

/** @param {{nivel: string, app: string, msg: string, seg: number, hora: string, urna: string}[]} eventos do dia */
export function metricasDoDia(eventos) {
  const m = {
    eleitoresAtendidos: 0, habilitados: 0, votos: 0, desistencias: 0,
    liberadosDigital: 0, liberadosSemDigital: 0, digitalTentada: 0, digitalFalhou: 0, tentativasDigital: 0,
    habilitacaoManual: 0, titulosInvalidos: 0, justificativas: 0,
    correcoes: 0, eleitorParado: 0, foneDeOuvido: 0,
    cabineSoma: 0, cabineN: 0, atendimentoSoma: 0, atendimentoN: 0,
    cabine: {}, atendimento: {},
    mesarios: 0, zeresima: null, viasBu: 0,
    religamentos: 0, suspensoes: 0, usouBateria: 0, alertas: 0, erros: 0, alertasImpressora: 0,
    assinaturasOk: 0, assinaturasFalha: 0,
    modelo: null, versao: null,
    ocorrencias: {}
  };
  let ciclo = null;
  for (const e of eventos) {
    const msg = e.msg;
    if (e.nivel === 'ALERTA' || e.nivel === 'ERRO') {
      m[e.nivel === 'ALERTA' ? 'alertas' : 'erros']++;
      const chave = `${e.nivel}|${e.app}|${normalizar(msg)}`;
      m.ocorrencias[chave] = (m.ocorrencias[chave] || 0) + 1;
      if (/impress/i.test(msg)) m.alertasImpressora++;
    }
    if (msg.startsWith('Identificador do eleitor digitado pelo mesário')) {
      if (ciclo?.habilitadoEm != null && !ciclo.votou) m.desistencias++;
      ciclo = { inicio: e.seg, tentativas: 0, manual: false, tipo: null, habilitadoEm: null, votou: false };
      m.eleitoresAtendidos++;
    } else if (msg.startsWith('Solicita digital. Tentativa')) {
      if (ciclo) ciclo.tentativas++;
    } else if (msg.startsWith('Solicitação de dado pessoal do eleitor para habilitação manual')) {
      if (ciclo) ciclo.manual = true;
    } else if (msg.startsWith('Tipo de habilitação do eleitor [')) {
      if (ciclo) ciclo.tipo = msg.slice(32, msg.indexOf(']', 32));
    } else if (msg.startsWith('Eleitor foi habilitado')) {
      m.habilitados++;
      if (ciclo) ciclo.habilitadoEm = e.seg;
    } else if (msg.startsWith('O voto do eleitor foi computado')) {
      m.votos++;
      if (ciclo) {
        ciclo.votou = true;
        if (ciclo.tipo === 'biométrica') m.liberadosDigital++;
        else m.liberadosSemDigital++;
        if (ciclo.tentativas) {
          m.digitalTentada++;
          m.tentativasDigital += ciclo.tentativas;
          if (ciclo.tipo !== 'biométrica') m.digitalFalhou++;
        }
        if (ciclo.manual) m.habilitacaoManual++;
        if (ciclo.habilitadoEm != null) {
          const s = e.seg - ciclo.habilitadoEm;
          m.cabineSoma += s; m.cabineN++;
          const f = faixa(s, FAIXAS_CABINE); m.cabine[f] = (m.cabine[f] || 0) + 1;
        }
        const a = e.seg - ciclo.inicio;
        m.atendimentoSoma += a; m.atendimentoN++;
        const f = faixa(a, FAIXAS_ATENDIMENTO); m.atendimento[f] = (m.atendimento[f] || 0) + 1;
        ciclo = null;
      } else {
        m.liberadosSemDigital++;
      }
    } else if (msg.startsWith('Identificador do eleitor digitado inválido')) m.titulosInvalidos++;
    else if (msg.startsWith('Justificativa recebida')) m.justificativas++;
    else if (msg.startsWith('Eleitor corrigiu')) m.correcoes++;
    else if (msg.startsWith('Mesário indagado se eleitor está votando')) m.eleitorParado++;
    else if (msg.startsWith('Fone de ouvido conectado')) m.foneDeOuvido++;
    else if (/^Mesário \d+ registrado/.test(msg)) m.mesarios++;
    else if (msg.startsWith('Imprimindo relatório [ZERÉSIMA] via nº [1]')) m.zeresima ??= e.hora;
    else if (msg.startsWith('Imprimindo relatório [BU] via')) m.viasBu++;
    else if (msg.startsWith('Urna ligada em')) m.religamentos++;
    else if (msg.startsWith('Votação suspensa')) m.suspensoes++;
    else if (msg.startsWith('Urna operando na bateria interna')) m.usouBateria = 1;
    else if (msg.startsWith('Verificação de assinatura')) m[msg.includes('[SUCESSO]') ? 'assinaturasOk' : 'assinaturasFalha']++;
    else if (msg.startsWith('Identificação do Modelo de Urna:')) m.modelo = msg.slice(32).trim();
    else if (msg.startsWith('Versão da aplicação:')) m.versao = msg.slice(20).trim().split(' - ')[0];
  }
  if (ciclo?.habilitadoEm != null && !ciclo.votou) m.desistencias++;
  // A urna liga uma vez para votar: religamentos contam as vezes a mais
  m.religamentos = Math.max(0, m.religamentos - 1);
  return m;
}

/** Soma métricas (urna anterior + substituta, ou urnas de um estado) */
export function somarMetricas(lista) {
  const t = {};
  for (const m of lista) {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') t[k] = (t[k] || 0) + v;
      else if (v && typeof v === 'object') {
        t[k] ??= {};
        for (const [kk, vv] of Object.entries(v)) t[k][kk] = (t[k][kk] || 0) + vv;
      } else if (v != null && t[k] == null) t[k] = v;
    }
  }
  return t;
}
