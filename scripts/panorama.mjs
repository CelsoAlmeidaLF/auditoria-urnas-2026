/**
 * Confere todas as urnas de um pacote do TSE e grava o resumo da UF para a aba Panorama.
 *
 *   node scripts/panorama.mjs <UF> <pacote.zip>
 *
 * Grava data/panorama/<UF>.json (totais, distribuições e as urnas com troca ou ponto para olhar)
 * e data/panorama/csv/<UF>.csv (uma linha por urna; não vai para o site, é grande).
 */
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZipLeitor } from '../src/infrastructure/ZipLeitor.js';
import { ArquivoLocal } from './ArquivoLocal.mjs';
import { identificarNome, resumirUrna } from '../src/application/AuditoriaService.js';
import { horaDeBrasilia, localDaUrna } from '../src/domain/LogUrna.js';
import { somarMetricas } from '../src/domain/Metricas.js';

/** Sobe quando a análise muda: o panorama_brasil.sh refaz as UFs gravadas com versão anterior */
export const VERSAO = 3;

const [uf, arquivo] = process.argv.slice(2);
if (!uf || !arquivo) { console.error('Uso: node scripts/panorama.mjs <UF> <pacote.zip>'); process.exit(1); }
const saida = fileURLToPath(new URL('../data/panorama/', import.meta.url));
mkdirSync(`${saida}csv`, { recursive: true });

const zip = await new ZipLeitor(new ArquivoLocal(arquivo)).abrir();
const porUrna = new Map();
let pleito = null;
for (const e of zip.entradas) {
  const i = identificarNome(e.nome);
  if (!i) continue;
  pleito ??= i.pleito;
  const u = porUrna.get(i.chave) || { info: i };
  u[i.tipo] = e;
  porUrna.set(i.chave, u);
}
const urnas = [...porUrna.values()].filter(u => u['log.jez']);
const inicio = Date.now();
const resumos = [];
for (const [k, u] of urnas.entries()) {
  try {
    const bu = u['bu.dat'] ? await zip.lerEntrada(u['bu.dat']) : null;
    const imgbu = !bu && u['imgbu.dat'] ? await zip.lerEntrada(u['imgbu.dat']) : null;
    resumos.push({ chave: u.info.chave, ...(await resumirUrna(await zip.lerEntrada(u['log.jez']), imgbu, uf === 'ZZ' ? null : uf, bu, u.info)) });
  } catch (e) {
    resumos.push({ chave: u.info.chave, erro: String(e.message || e), atencao: [] });
  }
  if ((k + 1) % 2000 === 0) console.error(`${uf}: ${k + 1} de ${urnas.length}`);
}

// Distribuições (horário de Brasília)
const soma = c => resumos.reduce((s, r) => s + (r[c] || 0), 0);
const porHora = {};
const faixa = (h, passos) => passos.find(([lim]) => h && h <= lim)?.[1] ?? (h ? passos.at(-1)[1] : 'sem registro');
const abertura = {};
const encerramento = {};
const menorIntervalo = {};
const pontos = {};
for (const r of resumos) {
  for (const [h, n] of Object.entries(r.porHora || {})) porHora[h] = (porHora[h] || 0) + n;
  const local = localDaUrna(uf, r.chave.split('-')[1]);
  const ab = horaDeBrasilia(r.abertura, local);
  const en = horaDeBrasilia(r.encerramento, local);
  const a = faixa(ab, [['07:59:59', 'antes das 8h'], ['08:05:00', '8h00–8h05'], ['09:00:00', '8h05–9h'], ['99', 'depois das 9h']]);
  const e = faixa(en, [['16:59:59', 'antes das 17h'], ['17:15:00', '17h00–17h15'], ['18:00:00', '17h15–18h'], ['19:00:00', '18h–19h'], ['99', 'depois das 19h']]);
  // Exterior: cada país no seu fuso, as faixas de horário não se aplicam
  if (uf !== 'ZZ') {
    abertura[a] = (abertura[a] || 0) + 1;
    encerramento[e] = (encerramento[e] || 0) + 1;
  }
  const m = r.menorIntervalo;
  const mi = m == null ? 'sem par de votos' : m < 15 ? 'menos de 15 s' : m < 30 ? '15–29 s' : m < 60 ? '30–59 s' : '60 s ou mais';
  menorIntervalo[mi] = (menorIntervalo[mi] || 0) + 1;
  for (const p of r.atencao) pontos[p] = (pontos[p] || 0) + 1;
}
// Métricas somadas da UF: contagens, faixas de tempo, modelos de urna, versões e ocorrências (alertas e erros)
const comMetricas = resumos.filter(r => r.metricas);
const metricas = somarMetricas(comMetricas.map(r => {
  const { modelo, versao, zeresima, ocorrencias, ...resto } = r.metricas;
  return resto;
}));
const contar = campo => {
  const t = {};
  for (const r of comMetricas) { const v = r.metricas[campo] || 'sem registro'; t[v] = (t[v] || 0) + 1; }
  return t;
};
metricas.modelos = contar('modelo');
metricas.versoes = contar('versao');
const ocorrencias = {};
for (const r of comMetricas) for (const [k, v] of Object.entries(r.metricas.ocorrencias)) {
  const o = ocorrencias[k] ??= { vezes: 0, urnas: 0 };
  o.vezes += v; o.urnas++;
}
metricas.ocorrencias = Object.fromEntries(Object.entries(ocorrencias).sort((a, b) => b[1].vezes - a[1].vezes).slice(0, 40));
metricas.aptos = soma('aptos');

const enxuto = r => ({ chave: r.chave, interrompidos: r.interrompidos, votos: r.votos, comparecimento: r.comparecimento, abertura: r.abertura, encerramento: r.encerramento, menorIntervalo: r.menorIntervalo, contingencia: r.contingencia, atencao: r.atencao, erro: r.erro, alertas: r.alertas, erros: r.erros });
const dados = {
  versao: VERSAO, uf, pleito, pacote: arquivo.split('/').pop(), tamanho: statSync(arquivo).size, conferidoEm: new Date().toISOString(),
  segundos: Math.round((Date.now() - inicio) / 1000),
  urnas: resumos.length, naoLidas: resumos.filter(r => r.erro).length,
  votos: soma('votos'), comparecimento: soma('comparecimento'), urnasSemBoletim: resumos.filter(r => !r.erro && r.comparecimento == null).length,
  biometricos: soma('biometricos'), interrompidos: soma('interrompidos'), semHabilitacao: soma('semHabilitacao'), foraDaJanela: soma('foraDaJanela'), depoisDas17h: soma('depoisDas17h'),
  alertas: soma('alertas'), erros: soma('erros'), trocas: resumos.filter(r => r.contingencia).length,
  pontos, porHora, abertura, encerramento, menorIntervalo, metricas,
  // Lista completa só das urnas que interessam: com ponto para olhar, não lidas ou com troca de urna
  destaque: resumos.filter(r => r.atencao.length || r.erro || r.contingencia || r.interrompidos).map(enxuto)
};
writeFileSync(`${saida}${uf}.json`, JSON.stringify(dados));
const cab = ['chave', 'dia', 'votos', 'comparecimento', 'abertura', 'encerramento', 'menorIntervalo', 'semHabilitacao', 'foraDaJanela', 'depoisDas17h', 'alertas', 'erros', 'contingencia', 'atencao', 'erro'];
writeFileSync(`${saida}csv/${uf}.csv`, [cab.join(';'), ...resumos.map(r => cab.map(c => String(Array.isArray(r[c]) ? r[c].join(' ') : r[c] ?? '')).join(';'))].join('\n'));
console.log(`${uf}: ${dados.urnas} urnas em ${dados.segundos} s · log ${dados.votos} · boletins ${dados.comparecimento} · trocas ${dados.trocas} · pontos ${JSON.stringify(pontos)} · não lidas ${dados.naoLidas}`);
