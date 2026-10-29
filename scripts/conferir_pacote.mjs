/**
 * Confere todas as urnas de um pacote do TSE pela linha de comando (a mesma análise da aba "Urnas de uma UF").
 *
 *   node scripts/conferir_pacote.mjs bu_imgbu_logjez_rdv_vscmr_2026_2t_RR.zip [saida.csv]
 *
 * Pacotes: https://dadosabertos.tse.jus.br/dataset/resultados-2026-arquivos-transmitidos-para-totalizacao
 */
import { writeFileSync } from 'node:fs';
import { ZipLeitor } from '../src/infrastructure/ZipLeitor.js';
import { ArquivoLocal } from './ArquivoLocal.mjs';
import { identificarNome, resumirUrna } from '../src/application/AuditoriaService.js';

const [arquivo, saida] = process.argv.slice(2);
if (!arquivo) {
  console.error('Uso: node scripts/conferir_pacote.mjs <pacote_UF.zip> [saida.csv]');
  process.exit(1);
}
const zip = await new ZipLeitor(new ArquivoLocal(arquivo)).abrir();
const porUrna = new Map();
for (const e of zip.entradas) {
  const i = identificarNome(e.nome);
  if (!i) continue;
  const u = porUrna.get(i.chave) || { info: i };
  u[i.tipo] = e;
  porUrna.set(i.chave, u);
}
const urnas = [...porUrna.values()].filter(u => u['log.jez']);
const resumos = [];
const inicio = Date.now();
for (const [k, u] of urnas.entries()) {
  try {
    const bu = u['bu.dat'] ? await zip.lerEntrada(u['bu.dat']) : null;
    const imgbu = !bu && u['imgbu.dat'] ? await zip.lerEntrada(u['imgbu.dat']) : null;
    resumos.push({ chave: u.info.chave, ...(await resumirUrna(await zip.lerEntrada(u['log.jez']), imgbu, u.info.uf, bu, u.info)) });
  } catch (e) {
    resumos.push({ chave: u.info.chave, erro: e.message, atencao: [] });
  }
  if ((k + 1) % 500 === 0) process.stderr.write(`${k + 1} de ${urnas.length} urnas…\n`);
}
const soma = c => resumos.reduce((s, r) => s + (r[c] || 0), 0);
const contagem = {};
for (const r of resumos) for (const a of r.atencao) contagem[a] = (contagem[a] || 0) + 1;
console.log(`Urnas: ${urnas.length} em ${Math.round((Date.now() - inicio) / 1000)} s`);
console.log(`Votos no log: ${soma('votos')} · comparecimento nos boletins: ${soma('comparecimento')}`);
console.log(`Urnas com troca: ${resumos.filter(r => r.contingencia).length} · não lidas: ${resumos.filter(r => r.erro).length}`);
console.log(`Pontos para olhar: ${JSON.stringify(contagem)}`);
for (const r of resumos.filter(r => r.atencao.length || r.erro)) console.log(' ', JSON.stringify(r));
if (saida) {
  const cab = ['chave', 'dia', 'votos', 'comparecimento', 'abertura', 'encerramento', 'menorIntervalo', 'semHabilitacao', 'foraDaJanela', 'depoisDas17h', 'alertas', 'erros', 'contingencia', 'atencao', 'erro'];
  writeFileSync(saida, [cab.join(';'), ...resumos.map(r => cab.map(c => `"${String(Array.isArray(r[c]) ? r[c].join(' ') : r[c] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n'));
  console.log(`CSV: ${saida}`);
}
