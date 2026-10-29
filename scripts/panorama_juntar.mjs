/**
 * Junta data/panorama/<UF>.json em data/panorama/brasil.json, o arquivo que a aba Panorama carrega.
 *   node scripts/panorama_juntar.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { somarMetricas } from '../src/domain/Metricas.js';

const pasta = fileURLToPath(new URL('../data/panorama/', import.meta.url));
const TODAS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO', 'ZZ'];
const ufs = readdirSync(pasta).filter(n => /^[A-Z]{2}\.json$/.test(n)).map(n => JSON.parse(readFileSync(pasta + n, 'utf8')))
  .sort((a, b) => a.uf.localeCompare(b.uf));

const somar = campo => ufs.reduce((s, u) => s + (u[campo] || 0), 0);
const somarMapa = campo => {
  const t = {};
  for (const u of ufs) for (const [k, v] of Object.entries(u[campo] || {})) t[k] = (t[k] || 0) + v;
  return t;
};
const CAMPOS = ['urnas', 'naoLidas', 'votos', 'comparecimento', 'urnasSemBoletim', 'biometricos', 'semHabilitacao', 'foraDaJanela', 'depoisDas17h', 'alertas', 'erros', 'trocas', 'tamanho', 'interrompidos'];
// Votos interrompidos que explicam falta no log (voto confirmado e urna desligada antes do "computado").
// Urnas em que o log bate com o boletim não entram: ali o voto foi computado depois ou refeito.
for (const u of ufs) {
  const semLog = u.destaque.filter(r => r.contingencia && r.atencao.includes('bu-comparecimento')).reduce((t, r) => t + Math.max(0, (r.comparecimento ?? 0) - r.votos), 0);
  u.interrompidos = Math.min(u.interrompidos || 0, Math.max(0, u.comparecimento - u.votos - semLog));
}
const brasil = Object.fromEntries(CAMPOS.map(c => [c, somar(c)]));
for (const c of ['pontos', 'menorIntervalo']) brasil[c] = somarMapa(c);
// Horários do país: sem o exterior, onde cada seção segue o relógio local do país
const noBrasil = ufs.filter(u => u.uf !== 'ZZ');
for (const c of ['porHora', 'abertura', 'encerramento']) {
  brasil[c] = {};
  for (const u of noBrasil) for (const [k, v] of Object.entries(u[c] || {})) brasil[c][k] = (brasil[c][k] || 0) + v;
}
// Métricas do log: só das UFs já processadas com a análise completa (versão 2)
const completas = ufs.filter(u => u.metricas);
brasil.metricas = somarMetricas(completas.map(u => { const { ocorrencias, ...resto } = u.metricas; return resto; }));
const oc = {};
for (const u of completas) for (const [k, v] of Object.entries(u.metricas.ocorrencias || {})) {
  const o = oc[k] ??= { vezes: 0, urnas: 0 };
  o.vezes += v.vezes; o.urnas += v.urnas;
}
brasil.metricas.ocorrencias = Object.fromEntries(Object.entries(oc).sort((a, b) => b[1].vezes - a[1].vezes).slice(0, 40));
brasil.metricasUfs = completas.map(u => u.uf);

// Seções do resultado oficial sem arquivo de urna nos pacotes (gerado a partir do detalhe por seção do TSE)
let semUrna = null;
try { semUrna = JSON.parse(readFileSync(pasta + 'secoes_sem_urna.json', 'utf8')); } catch { semUrna = null; }

const dados = {
  pleito: '3221',
  turno: '2º turno — 25/10/2026',
  geradoEm: new Date().toISOString(),
  conferidas: ufs.map(u => u.uf),
  faltam: TODAS.filter(uf => !ufs.some(u => u.uf === uf)),
  brasil,
  semUrna,
  ufs: ufs.map(({ destaque, ...resto }) => ({ ...resto, urnasComPonto: destaque.filter(d => d.atencao.length || d.erro).length })),
  destaque: ufs.flatMap(u => u.destaque)
};
writeFileSync(pasta + 'brasil.json', JSON.stringify(dados));
console.log(`brasil.json: ${ufs.length} UF(s) · ${brasil.urnas} urnas · log ${brasil.votos} · boletins ${brasil.comparecimento} · ${dados.destaque.length} urnas em destaque · faltam ${dados.faltam.join(' ') || 'nenhuma'}`);
