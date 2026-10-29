/**
 * Locais de votação do 2º turno de 2026 (TSE, "Eleitorado por local de votação") com o endereço separado em
 * rua, número, complemento, bairro e CEP, para o app e em planilha.
 *
 *   node scripts/locais.mjs <pasta com eleitorado_local_votacao_2026_UF.csv>
 *   https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip
 *
 * Grava:
 *   data/locais/<UF>.json                 um local por linha (o app carrega o da UF escolhida)
 *   data/locais/locais_votacao_2026.csv   todos os locais do país (UTF-8, separador ;)
 */
import { createReadStream, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { separarEndereco, formatarCep, coordenada } from '../src/domain/Endereco.js';

const pasta = process.argv[2];
if (!pasta) { console.error('Uso: node scripts/locais.mjs <pasta com os CSV do TSE>'); process.exit(1); }
const saida = fileURLToPath(new URL('../data/locais/', import.meta.url));
mkdirSync(saida, { recursive: true });

/** Uma linha de CSV do TSE: campos entre aspas, separados por ; */
function campos(linha) {
  const out = [];
  let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
    else if (c === ';' && !aspas) { out.push(atual); atual = ''; }
    else atual += c;
  }
  out.push(atual);
  return out;
}

export const COLUNAS = ['municipio', 'nomeMunicipio', 'zona', 'local', 'nome', 'rua', 'numero', 'complemento', 'bairro', 'cep', 'lat', 'lon', 'tipo', 'acessivel', 'secoes', 'eleitores', 'telefone', 'enderecoTse'];
const csvNacional = [['UF', 'Código do município (TSE)', 'Município', 'Zona', 'Nº do local', 'Local de votação', 'Rua', 'Número', 'Complemento', 'Bairro', 'CEP', 'Latitude', 'Longitude', 'Tipo', 'Acessibilidade', 'Seções', 'Eleitores', 'Endereço como publicado pelo TSE']];
const aspas = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const resumo = { ufs: 0, locais: 0, secoes: 0, comNumero: 0, semNumero: 0, sn: 0, comCep: 0, comCoordenada: 0 };

const arquivos = readdirSync(pasta).filter(n => /^eleitorado_local_votacao_2026_[A-Z]{2}\.csv$/.test(n) && !n.includes('BRASIL')).sort();
for (const nome of arquivos) {
  const uf = nome.slice(-6, -4);
  const exterior = uf === 'ZZ';
  const rl = createInterface({ input: createReadStream(`${pasta}/${nome}`, { encoding: 'latin1' }), crlfDelay: Infinity });
  let cab = null;
  const locais = new Map();
  for await (const linha of rl) {
    const c = campos(linha);
    if (!cab) { cab = Object.fromEntries(c.map((n, i) => [n, i])); continue; }
    const v = n => c[cab[n]];
    if (v('NR_TURNO') !== '2') continue;
    const chave = `${v('CD_MUNICIPIO')}-${v('NR_ZONA')}-${v('NR_LOCAL_VOTACAO')}`;
    let l = locais.get(chave);
    if (!l) {
      const end = separarEndereco(v('DS_ENDERECO'));
      l = {
        municipio: v('CD_MUNICIPIO'), nomeMunicipio: v('NM_MUNICIPIO'), zona: +v('NR_ZONA'), local: +v('NR_LOCAL_VOTACAO'),
        nome: v('NM_LOCAL_VOTACAO'), ...end, bairro: (v('NM_BAIRRO') || '').trim(), cep: formatarCep(v('NR_CEP')),
        lat: coordenada(v('NR_LATITUDE'), 'lat', exterior), lon: coordenada(v('NR_LONGITUDE'), 'lon', exterior),
        tipo: v('DS_TIPO_LOCAL'), acessivel: false, secoes: [], eleitores: 0,
        telefone: (v('NR_TELEFONE_LOCAL') || '').replace(/[^\d+]/g, '').replace(/^-1$/, ''), enderecoTse: (v('DS_ENDERECO') || '').trim()
      };
      if (l.lat == null || l.lon == null) l.lat = l.lon = null;
      locais.set(chave, l);
    }
    l.secoes.push(+v('NR_SECAO'));
    l.eleitores += +v('QT_ELEITOR_SECAO') || 0;
    if (/^Com/i.test(v('DS_SITU_SECAO_ACESSIBILIDADE'))) l.acessivel = true;
  }
  const lista = [...locais.values()].sort((a, b) => a.nomeMunicipio.localeCompare(b.nomeMunicipio, 'pt-BR') || a.zona - b.zona || a.local - b.local);
  for (const l of lista) {
    l.secoes.sort((a, b) => a - b);
    resumo.locais++; resumo.secoes += l.secoes.length;
    if (l.numero === 's/n') resumo.sn++; else if (l.numero) resumo.comNumero++; else resumo.semNumero++;
    if (l.cep) resumo.comCep++;
    if (l.lat != null) resumo.comCoordenada++;
    csvNacional.push([uf, l.municipio, l.nomeMunicipio, l.zona, l.local, l.nome, l.rua, l.numero, l.complemento, l.bairro, l.cep,
      l.lat ?? '', l.lon ?? '', l.tipo, l.acessivel ? 'com acessibilidade' : 'sem acessibilidade', l.secoes.join(' '), l.eleitores, l.enderecoTse]);
  }
  // Uma linha por local, colunas na ordem de COLUNAS (arquivo menor que objetos)
  writeFileSync(`${saida}${uf}.json`, JSON.stringify({
    uf, turno: 2, fonte: 'TSE, Eleitorado por local de votação 2026', colunas: COLUNAS,
    locais: lista.map(l => COLUNAS.map(k => (k === 'secoes' ? l.secoes.join(' ') : k === 'acessivel' ? (l.acessivel ? 1 : 0) : l[k])))
  }));
  resumo.ufs++;
  console.log(`${uf}: ${lista.length} locais, ${lista.reduce((s, l) => s + l.secoes.length, 0)} seções`);
}
writeFileSync(`${saida}locais_votacao_2026.csv`, `﻿${csvNacional.map(l => l.map(aspas).join(';')).join('\r\n')}`);
console.log(JSON.stringify(resumo));
