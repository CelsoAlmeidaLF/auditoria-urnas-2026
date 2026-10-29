/**
 * Casos de uso: abrir arquivos do TSE (log .jez, logd.dat, imgbu.dat ou o pacote .zip de uma UF),
 * montar o catálogo de urnas, analisar uma urna e resumir todas as urnas de um pacote.
 * Tudo acontece no aparelho: nenhum arquivo é enviado para lugar nenhum.
 */
import { ZipLeitor, textoLatin1 } from '../infrastructure/ZipLeitor.js?v=20261029-1725';
import { lerLog, diasDoLog, diaDaEleicao, analisarDia, juntarAnalises, localDaUrna } from '../domain/LogUrna.js?v=20261029-1725';
import { lerBoletim } from '../domain/BoletimUrna.js?v=20261029-1725';
import { lerBuDat } from '../domain/BuDat.js?v=20261029-1725';
import { lerRdv } from '../domain/Rdv.js?v=20261029-1725';
import { verificar } from '../domain/Verificacoes.js?v=20261029-1725';
import { metricasDoDia, somarMetricas } from '../domain/Metricas.js?v=20261029-1725';

/** o03221rr0300000040011-log.jez → pleito 3221, RR, município 03000, zona 0004, seção 0011 */
const NOME_TSE = /o0?(\d{4})([a-z]{2})(\d{5})(\d{4})(\d{4})-(log\.jez|imgbu\.dat|bu\.dat|rdv\.dat|vota\.vsc)$/i;

/** Arquivos da seção que o app usa: log, boletim em texto e boletim digital */
const USADOS = new Set(['log.jez', 'imgbu.dat', 'bu.dat', 'rdv.dat']);

export function identificarNome(nome) {
  const m = NOME_TSE.exec(nome.split('/').pop());
  if (!m) return null;
  const [, pleito, uf, municipio, zona, secao, tipo] = m;
  return { chave: `${uf.toUpperCase()}-${municipio}-${zona}-${secao}`, pleito, uf: uf.toUpperCase(), municipio, zona, secao, tipo: tipo.toLowerCase() };
}

/** Bytes de um arquivo solto ou de um arquivo dentro do pacote */
const bytesDe = async fonte => (fonte.zip ? fonte.zip.lerEntrada(fonte.entrada) : new Uint8Array(await fonte.blob.arrayBuffer()));

/**
 * Lê o log: aceita o .jez (ZIP com logd.dat) ou o logd.dat solto.
 * Dentro do .jez podem vir outros .jez: logs de urnas anteriores (troca de urna) ou de sessões antigas.
 * @returns {Promise<{texto: string, internos: {nome: string, texto: string}[]}>}
 */
export async function lerLogDaUrna(bytes) {
  const blob = new Blob([bytes]);
  if (!(await ZipLeitor.ehZip(blob))) return { texto: textoLatin1(bytes), internos: [] };
  const zip = await new ZipLeitor(blob).abrir();
  const log = zip.entradas.find(e => e.nome.toLowerCase().endsWith('logd.dat'));
  if (!log) throw new Error('O .jez não tem o arquivo logd.dat.');
  const texto = textoLatin1(await zip.lerEntrada(log));
  const internos = [];
  for (const entrada of zip.entradas.filter(e => e.nome.toLowerCase().endsWith('.jez'))) {
    try {
      internos.push({ nome: entrada.nome, texto: (await lerLogDaUrna(await zip.lerEntrada(entrada))).texto });
    } catch {
      // log interno ilegível: a própria urna avisa no log ("log corrompido da ME")
    }
  }
  return { texto, internos };
}

/**
 * Logs internos com votação no mesmo dia e da mesma seção = urnas anteriores à troca. Os outros (sessões antigas,
 * ou o log de outra seção que veio no cartão) ficam de fora da conta, mas continuam visíveis na aba Eventos.
 * @param {string|null} secao seção da urna (4 dígitos); sem ela, não filtra por seção
 */
function analisarAnteriores(internos, dia, uf, secao = null) {
  const daSecao = internos
    .filter(i => diasDoLog(i.eventos).some(d => d.dia === dia && (d.votos || d.votacao)))
    .filter(i => { const a = analisarDia(i.eventos, dia, uf); return !secao || !a.identificacao.secao || a.identificacao.secao === secao; });
  if (!daSecao.length) return null;
  // Os logs internos podem se repetir (cópia do mesmo log no cartão interno e no externo) ou um conter o outro
  // (o log do cartão traz a história de mais de uma urna). Cada linha tem um código verificador próprio:
  // junta tudo sem repetir linha e analisa uma vez, em ordem de horário.
  const vistas = new Set();
  const eventos = [];
  for (const i of daSecao) {
    for (const e of i.eventos) {
      const k = `${e.urna}|${e.dia}|${e.hora}|${e.msg}|${e.verificador}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      eventos.push(e);
    }
  }
  eventos.sort((a, b) => a.seg - b.seg);
  return analisarDia(eventos, dia, uf);
}

/** Seção da urna: do nome do arquivo do TSE ou, sem ele, do próprio log (a de contingência, 0000, não vale) */
const secaoAlvo = (secaoDoNome, analise) => secaoDoNome || (analise.identificacao.secao !== '0000' ? analise.identificacao.secao : null);

export class AuditoriaService {
  constructor() {
    /** @type {Map<string, {chave: string, uf?: string, municipio?: string, zona?: string, secao?: string, origem: string, log?: object, imgbu?: object}>} */
    this.urnas = new Map();
    /** @type {{nome: string, tamanho: number, zip: ZipLeitor, urnas: number}[]} */
    this.pacotes = [];
    this._cache = new Map();
  }

  _registrar(info, tipo, fonte, origem) {
    const chave = info?.chave ?? `arquivo-${origem}`;
    let u = this.urnas.get(chave);
    if (!u) this.urnas.set(chave, u = { chave, ...(info ? { uf: info.uf, municipio: info.municipio, zona: info.zona, secao: info.secao, pleito: info.pleito } : {}), origem });
    if (tipo === 'log.jez' || tipo === 'logd.dat') u.log = fonte;
    if (tipo === 'imgbu.dat') u.imgbu = fonte;
    if (tipo === 'bu.dat') u.bu = fonte;
    if (tipo === 'rdv.dat') u.rdv = fonte;
    this._cache.delete(chave);
    return chave;
  }

  /**
   * @param {File[]} arquivos
   * @returns {Promise<{urnas: string[], pacotes: string[], ignorados: string[]}>}
   */
  async abrir(arquivos) {
    const novas = new Set();
    const pacotes = [];
    const ignorados = [];
    for (const arquivo of arquivos) {
      const nome = arquivo.name;
      const info = identificarNome(nome);
      if (info && USADOS.has(info.tipo)) {
        novas.add(this._registrar(info, info.tipo, { blob: arquivo }, nome));
        continue;
      }
      if (/logd\.dat$/i.test(nome)) {
        novas.add(this._registrar(null, 'logd.dat', { blob: arquivo }, nome));
        continue;
      }
      if (await ZipLeitor.ehZip(arquivo)) {
        const zip = await new ZipLeitor(arquivo).abrir();
        if (zip.entradas.some(e => e.nome.toLowerCase().endsWith('logd.dat'))) {
          // .jez com outro nome (ex.: baixado e renomeado)
          novas.add(this._registrar(null, 'log.jez', { blob: arquivo }, nome));
          continue;
        }
        let n = 0;
        for (const entrada of zip.entradas) {
          const i = identificarNome(entrada.nome);
          if (i && USADOS.has(i.tipo)) {
            this._registrar(i, i.tipo, { zip, entrada }, nome);
            if (i.tipo === 'log.jez') n++;
          }
        }
        if (n) {
          this.pacotes.push({ nome, tamanho: arquivo.size, zip, urnas: n, arquivo });
          pacotes.push(nome);
          continue;
        }
      }
      ignorados.push(nome);
    }
    return { urnas: [...novas], pacotes, ignorados };
  }

  /**
   * Baixa do site de resultados do TSE o log (e o boletim em texto, quando publicado) de uma seção.
   * @param {import('../infrastructure/TseResultadosGateway.js?v=20261029-1725').TseResultadosGateway} tse
   * @param {string} pleito @param {{uf: string, municipio: string, zona: string, secao: string}} secao
   */
  async abrirDoTse(tse, pleito, secao) {
    const conjuntos = await tse.arquivosDaSecao(pleito, secao);
    // O conjunto totalizado mais recente (o aux.json lista também os substituídos)
    const conjunto = [...conjuntos].reverse().find(c => /totaliz/i.test(c.situacao)) || conjuntos.at(-1);
    const log = conjunto?.arquivos.find(a => a.tipo === 'log' || a.nome.endsWith('-log.jez'));
    if (!log) throw new Error('O TSE não publicou o log desta seção.');
    const nomes = [log.nome, ...conjunto.arquivos.filter(a => /-(imgbu|bu|rdv)\.dat$/.test(a.nome)).map(a => a.nome)];
    const arquivos = await Promise.all(nomes.map(n => tse.baixar(pleito, secao, conjunto.hash, n)));
    const { urnas } = await this.abrir(arquivos);
    const chave = urnas[0];
    const u = this.urnas.get(chave);
    if (u) u.origem = `resultados.tse.jus.br (recebido pelo TSE em ${conjunto.data} às ${conjunto.hora})`;
    return { chave, conjuntos: conjuntos.length, temBoletim: nomes.length > 1 };
  }

  /**
   * O que tinha no log de uma seção, em resumo: baixa do TSE (se ainda não estiver aberta), analisa o dia da
   * eleição e devolve números, horários, marcos, alertas e erros com o texto do log. A urna fica no catálogo,
   * então "abrir o log completo" não baixa de novo.
   */
  async detalharSecao(tse, pleito, secao) {
    const chave = `${secao.uf}-${secao.municipio}-${secao.zona}-${secao.secao}`;
    if (!this.urnas.get(chave)?.log) await this.abrirDoTse(tse, pleito, secao);
    const u = this.urnas.get(chave);
    if (u && secao.nomeMunicipio) u.nomeMunicipio = secao.nomeMunicipio;
    if (u) u.tse = { pleito, ...secao };
    const r = await this.analisar(chave);
    const a = r.analise, o = r.analiseOriginal;
    const m = o ? somarMetricas([metricasDoDia(o.eventos), metricasDoDia(a.eventos)]) : metricasDoDia(a.eventos);
    const ocorrencias = [...(o?.alertas || []), ...(o?.erros || []), ...a.alertas, ...a.erros]
      .reduce((mapa, e) => {
        const k = `${e.nivel}|${e.msg.replace(/\d{6,}/g, '#')}`;
        const x = mapa.get(k) || { nivel: e.nivel, msg: e.msg.replace(/\d{6,}/g, '#'), vezes: 0, primeira: e.hora };
        x.vezes++;
        return mapa.set(k, x);
      }, new Map());
    return {
      chave,
      urnas: [...new Set([...(o?.urnas || []), ...a.urnas])],
      modelo: a.identificacao.modelo,
      votos: a.votos.length + (o ? o.votos.length : 0),
      comparecimento: r.boletim?.comparecimento ?? null,
      aptos: r.boletim?.aptos ?? null,
      abertura: (o?.aberturas[0] ?? a.aberturas[0])?.hora ?? null,
      encerramento: (a.encerramentos.at(-1) ?? o?.encerramentos.at(-1) ?? a.recuperacoes.at(-1))?.hora ?? null,
      menorIntervalo: (o && o.votos.length > a.votos.length ? o : a).intervalos.menor,
      cabineMedia: m.cabineN ? Math.round(m.cabineSoma / m.cabineN) : null,
      liberadosDigital: m.liberadosDigital,
      digitalFalhou: m.digitalFalhou,
      desistencias: m.desistencias,
      jaVotou: m.ocorrencias['ALERTA|VOTA|O eleitor identificado já votou'] || 0,
      religamentos: m.religamentos,
      contingencia: a.contingencia || !!o,
      alertas: m.alertas,
      erros: m.erros,
      uf: a.uf,
      ocorrencias: [...ocorrencias.values()].sort((x, y) => (x.nivel === 'ERRO' ? -1 : 0) - (y.nivel === 'ERRO' ? -1 : 0) || y.vezes - x.vezes),
      marcos: [...(o ? o.marcos.map(x => ({ hora: x.hora, titulo: x.titulo, anterior: true })) : []), ...a.marcos.map(x => ({ hora: x.hora, titulo: x.titulo }))],
      verificacoes: r.verificacoes.filter(v => v.status !== 'ok').map(v => ({ id: v.id, status: v.status, titulo: v.titulo, resultado: v.resultado }))
    };
  }

  /** Urnas do catálogo em ordem (UF, município, zona, seção) */
  listar() {
    return [...this.urnas.values()].sort((a, b) => a.chave.localeCompare(b.chave));
  }

  /** Lê e guarda o log, o log da urna anterior e o boletim de uma urna */
  async carregar(chave) {
    if (this._cache.has(chave)) return this._cache.get(chave);
    const u = this.urnas.get(chave);
    if (!u) throw new Error('Urna não encontrada.');
    const carregado = (async () => {
      let eventos = [], internos = [], boletim = null;
      if (u.log) {
        const log = await lerLogDaUrna(await bytesDe(u.log));
        eventos = lerLog(log.texto);
        internos = log.internos.map(i => ({ nome: i.nome, eventos: lerLog(i.texto) }));
      }
      if (u.imgbu) boletim = lerBoletim(textoLatin1(await bytesDe(u.imgbu)));
      if (!boletim && u.bu) boletim = lerBuDat(await bytesDe(u.bu));
      let rdv = null;
      if (u.rdv) {
        try { rdv = lerRdv(await bytesDe(u.rdv)); } catch { rdv = null; }
      }
      return { urna: u, eventos, dias: diasDoLog(eventos), internos, boletim, rdv };
    })();
    this._cache.set(chave, carregado);
    return carregado;
  }

  /**
   * Análise de um dia (padrão: o dia da eleição) com as verificações.
   * Na troca de urna, o log da urna anterior é analisado no mesmo dia.
   */
  async analisar(chave, dia) {
    const c = await this.carregar(chave);
    const escolhido = dia || (c.boletim?.data && c.dias.some(d => d.dia === c.boletim.data) ? c.boletim.data : diaDaEleicao(c.dias));
    // Exterior (ZZ): cada seção no fuso do país, sem conversão para Brasília
    const uf = c.urna.uf === 'ZZ' ? null : localDaUrna(c.urna.uf || c.boletim?.uf || null, c.urna.municipio);
    const analise = analisarDia(c.eventos, escolhido, uf);
    const original = analisarAnteriores(c.internos, escolhido, uf, secaoAlvo(c.urna.secao, analise));
    return { ...c, analise, analiseOriginal: original, verificacoes: verificar(analise, { boletim: c.boletim, original, rdv: c.rdv }) };
  }
}

/**
 * Resumo de uma urna para a lista do pacote (usado pelo worker e pelos testes).
 * @param {Uint8Array} bytesLog @param {Uint8Array|null} bytesImgbu
 */
export async function resumirUrna(bytesLog, bytesImgbu, ufDoNome = null, bytesBu = null, { municipio = null, secao = null } = {}) {
  const log = await lerLogDaUrna(bytesLog);
  const eventos = lerLog(log.texto);
  const boletim = bytesImgbu ? lerBoletim(textoLatin1(bytesImgbu)) : bytesBu ? lerBuDat(bytesBu) : null;
  const dias = diasDoLog(eventos);
  const dia = boletim?.data && dias.some(d => d.dia === boletim.data) ? boletim.data : diaDaEleicao(dias);
  const uf = ufDoNome === 'ZZ' ? null : localDaUrna(ufDoNome || boletim?.uf || null, municipio);
  const a = analisarDia(eventos, dia, uf);
  const o = analisarAnteriores(log.internos.map(i => ({ nome: i.nome, eventos: lerLog(i.texto) })), dia, uf, secaoAlvo(secao, a));
  const atencao = verificar(a, { boletim, original: o }).filter(v => v.status === 'atencao').map(v => v.id);
  return {
    dia,
    votos: a.votos.length + (o ? o.votos.length : 0),
    comparecimento: boletim?.comparecimento ?? null,
    aptos: boletim?.aptos ?? null,
    abertura: o?.aberturas[0]?.hora ?? a.aberturas[0]?.hora ?? null,
    encerramento: a.encerramentos.at(-1)?.hora ?? o?.encerramentos.at(-1)?.hora ?? a.recuperacoes.at(-1)?.hora ?? o?.recuperacoes.at(-1)?.hora ?? null,
    recuperado: !a.encerramentos.length && !o?.encerramentos.length && (a.recuperacoes.length + (o?.recuperacoes.length || 0)) > 0,
    interrompidos: a.interrompidos.length + (o ? o.interrompidos.length : 0),
    menorIntervalo: [a.intervalos.menor, o?.intervalos.menor].filter(x => x != null).sort((x, y) => x - y)[0] ?? null,
    semHabilitacao: a.semHabilitacao + (o ? o.semHabilitacao : 0),
    foraDaJanela: a.foraDaJanela + (o ? o.foraDaJanela : 0),
    depoisDas17h: a.depoisDas17h + (o ? o.depoisDas17h : 0),
    porHora: o ? juntarAnalises([o, a]).porHora : a.porHora,
    biometricos: a.biometricos + (o ? o.biometricos : 0),
    alertas: a.alertas.length,
    erros: a.erros.length,
    contingencia: a.contingencia || !!o,
    municipio: boletim?.municipio?.nome ?? null,
    atencao,
    metricas: (() => {
      const ma = metricasDoDia(a.eventos);
      const mo = o ? metricasDoDia(o.eventos) : null;
      const m = mo ? somarMetricas([mo, ma]) : ma;
      m.semZeresima = ma.zeresima || mo?.zeresima ? 0 : 1;
      m.modelo = mo?.modelo || ma.modelo;
      return m;
    })()
  };
}
