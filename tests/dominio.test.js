/**
 * Domínio e aplicação com os arquivos reais de exemplos/ (Caroebe-RR e Chapada Gaúcha-MG, 2º turno de 2026)
 * e com logs montados à mão para os casos que pedem atenção.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerLog, diasDoLog, diaDaEleicao, analisarDia, horaDeBrasilia } from '../src/domain/LogUrna.js';
import { lerBuDat } from '../src/domain/BuDat.js';
import { lerBoletim } from '../src/domain/BoletimUrna.js';
import { verificar } from '../src/domain/Verificacoes.js';
import { AuditoriaService, identificarNome, resumirUrna, lerLogDaUrna } from '../src/application/AuditoriaService.js';
import { textoLatin1 } from '../src/infrastructure/ZipLeitor.js';

const ex = nome => new Uint8Array(readFileSync(new URL(`../exemplos/${nome}`, import.meta.url)));
const arquivo = nome => new File([ex(nome)], nome.split('/').pop());
const linha = (hora, msg, nivel = 'INFO', app = 'VOTA') => `25/10/2026 ${hora}\t${nivel}\t01234567\t${app}\t${msg}\tABCDEF`;

test('nome do arquivo do TSE identifica pleito, UF, município, zona e seção', () => {
  assert.deepEqual(identificarNome('pasta/o03221rr0300000040011-log.jez'),
    { chave: 'RR-03000-0004-0011', pleito: '3221', uf: 'RR', municipio: '03000', zona: '0004', secao: '0011', tipo: 'log.jez' });
  assert.equal(identificarNome('leiame.pdf'), null);
});

test('log de Caroebe (RR): 212 votos no dia da eleição, todos com eleitor habilitado e dentro do horário', async () => {
  const { texto, internos } = await lerLogDaUrna(ex('rr/o03221rr0300000040011-log.jez'));
  const eventos = lerLog(texto);
  const dias = diasDoLog(eventos);
  assert.equal(diaDaEleicao(dias), '25/10/2026');
  assert.equal(dias.find(d => d.dia === '04/10/2026').votos, 234, 'o mesmo log guarda o 1º turno');
  const a = analisarDia(eventos, '25/10/2026', 'RR');
  assert.equal(a.votos.length, 212);
  assert.equal(a.semHabilitacao, 0);
  assert.equal(a.foraDaJanela, 0);
  assert.equal(a.biometricos, 195);
  assert.equal(a.intervalos.menor, 29);
  assert.equal(a.aberturas[0].hora, '07:00:01');
  assert.equal(horaDeBrasilia(a.aberturas[0].hora, 'RR'), '08:00:01');
  assert.equal(Object.values(a.porHora).reduce((s, n) => s + n, 0), 212);
  assert.deepEqual(a.urnas, ['02282589']);
  assert.equal(internos.length, 0);
});

test('boletim digital (bu.dat) e boletim em texto (imgbu.dat) dizem o mesmo', () => {
  const d = lerBuDat(ex('rr/o03221rr0300000040011-bu.dat'));
  const t = lerBoletim(textoLatin1(ex('rr/o03221rr0300000040011-imgbu.dat')));
  assert.equal(d.comparecimento, 212);
  assert.equal(t.comparecimento, 212);
  assert.equal(d.codigoUrna, t.codigoUrna);
  assert.deepEqual(d.habilitacao, t.habilitacao);
  assert.equal(d.abertura.hora, t.abertura.hora);
  assert.equal(d.fechamento.hora, t.fechamento.hora);
  const pres = b => b.cargos.find(c => c.cargo === 'PRESIDENTE');
  assert.deepEqual(pres(d).candidatos.map(c => [c.numero, c.votos]).sort(), pres(t).candidatos.map(c => [c.numero, c.votos]).sort());
  assert.equal(pres(d).brancos, pres(t).brancos);
  assert.equal(pres(d).nulos, pres(t).nulos);
  assert.equal(t.municipio.nome, 'CAROEBE');
});

test('serviço: urna de RR com log e boletim confere em tudo', async () => {
  const s = new AuditoriaService();
  const r = await s.abrir(['rr/o03221rr0300000040011-log.jez', 'rr/o03221rr0300000040011-bu.dat'].map(arquivo));
  assert.deepEqual(r.urnas, ['RR-03000-0004-0011']);
  const a = await s.analisar('RR-03000-0004-0011');
  assert.equal(a.analise.dia, '25/10/2026');
  assert.deepEqual(a.verificacoes.filter(v => v.status === 'atencao'), []);
  assert.ok(a.verificacoes.find(v => v.id === 'bu-comparecimento').status === 'ok');
  assert.ok(a.verificacoes.find(v => v.id === 'bu-biometria').status === 'ok');
});

test('troca de urna (Chapada Gaúcha-MG): soma a urna anterior e confere com o boletim', async () => {
  const s = new AuditoriaService();
  await s.abrir(['mg/o03221mg4188203200185-log.jez', 'mg/o03221mg4188203200185-bu.dat'].map(arquivo));
  const a = await s.analisar('MG-41882-0320-0185');
  assert.equal(a.analise.votos.length, 0, 'a urna substituta só encerrou');
  assert.equal(a.analiseOriginal.votos.length, 96);
  assert.equal(a.analiseOriginal.biometricos, 79, 'liberados pela digital que votaram (98 liberados, 96 votos)');
  assert.equal(a.analise.identificacao.secao, '0185', 'identificação da seção, não da carga de contingência (0000)');
  assert.deepEqual(a.verificacoes.filter(v => v.status === 'atencao'), []);
  assert.equal(a.verificacoes.find(v => v.id === 'contingencia').status, 'info');
  const resumo = await resumirUrna(ex('mg/o03221mg4188203200185-log.jez'), null, 'MG', ex('mg/o03221mg4188203200185-bu.dat'));
  assert.equal(resumo.votos, 96);
  assert.equal(resumo.comparecimento, 96);
  assert.equal(resumo.abertura, '08:00:01');
});

test('log montado: voto sem habilitação, voto fora do horário e rajada pedem atenção', () => {
  const texto = [
    linha('07:59:00', 'O voto do eleitor foi computado'),
    linha('08:00:01', 'Urna pronta para receber votos'),
    linha('08:01:00', 'Identificador do eleitor digitado pelo mesário'),
    linha('08:01:05', 'Tipo de habilitação do eleitor [biométrica]'),
    linha('08:01:05', 'Eleitor foi habilitado'),
    linha('08:01:30', 'Voto confirmado para [Presidente]'),
    linha('08:01:30', 'O voto do eleitor foi computado'),
    linha('08:01:35', 'O voto do eleitor foi computado'),
    linha('17:05:00', 'Procedimento de encerramento confirmado'),
    linha('17:06:00', 'Problema ao desmontar a MR', 'ERRO', 'GAP')
  ].join('\n');
  const a = analisarDia(lerLog(texto), '25/10/2026', 'SP');
  assert.equal(a.votos.length, 3);
  assert.equal(a.foraDaJanela, 1);
  assert.equal(a.semHabilitacao, 2);
  assert.equal(a.intervalos.rajadas, 1);
  assert.equal(a.erros.length, 1);
  const status = Object.fromEntries(verificar(a, { boletim: { comparecimento: 1, habilitacao: { 'biométrica': 1 }, codigoUrna: '01234567' } }).map(v => [v.id, v.status]));
  assert.equal(status.habilitacao, 'atencao');
  assert.equal(status.janela, 'atencao');
  assert.equal(status.rajadas, 'atencao');
  assert.equal(status['bu-comparecimento'], 'atencao');
  assert.equal(status['bu-biometria'], 'ok');
  assert.equal(status['bu-urna'], 'ok');
});

test('eleitor liberado que não votou não passa a liberação para o próximo', () => {
  const texto = [
    linha('08:00:01', 'Urna pronta para receber votos'),
    linha('08:01:00', 'Identificador do eleitor digitado pelo mesário'),
    linha('08:01:05', 'Tipo de habilitação do eleitor [biométrica]'),
    linha('08:01:05', 'Eleitor foi habilitado'),
    linha('08:03:00', 'Identificador do eleitor digitado pelo mesário'),
    linha('08:03:20', 'Eleitor foi habilitado'),
    linha('08:03:40', 'O voto do eleitor foi computado'),
    linha('08:05:00', 'Identificador do eleitor digitado pelo mesário'),
    linha('08:05:05', 'Eleitor foi habilitado'),
    linha('08:05:05', 'Tipo de habilitação do eleitor [biométrica]'),
    linha('08:05:30', 'O voto do eleitor foi computado')
  ].join('\n');
  const a = analisarDia(lerLog(texto), '25/10/2026', 'SP');
  assert.equal(a.habilitados, 3);
  assert.equal(a.votos.length, 2);
  assert.equal(a.biometricos, 1, 'só o terceiro eleitor (tipo depois do "habilitado") votou pela digital');
  assert.equal(a.semHabilitacao, 0);
});

test('abertura antes das 8h de Brasília pede atenção; sem UF, vira informação', () => {
  const texto = [linha('06:50:00', 'Urna pronta para receber votos'), linha('17:01:00', 'Procedimento de encerramento confirmado')].join('\n');
  const comUf = verificar(analisarDia(lerLog(texto), '25/10/2026', 'MT')).find(v => v.id === 'abertura');
  assert.equal(comUf.status, 'atencao', '06:50 em MT = 07:50 de Brasília');
  const semUf = verificar(analisarDia(lerLog(texto), '25/10/2026', null)).find(v => v.id === 'abertura');
  assert.equal(semUf.status, 'info');
  const ok = verificar(analisarDia(lerLog(texto), '25/10/2026', 'AC')).find(v => v.id === 'abertura');
  assert.equal(ok.status, 'ok', '06:50 no AC = 08:50 de Brasília');
});

test('voto confirmado no instante em que a urna desliga: conta como interrompido e confere com o boletim', () => {
  const texto = [
    linha('08:00:01', 'Urna pronta para receber votos'),
    linha('08:01:00', 'Identificador do eleitor digitado pelo mesário'),
    linha('08:01:05', 'Tipo de habilitação do eleitor [biométrica]'),
    linha('08:01:05', 'Eleitor foi habilitado'),
    linha('08:01:20', 'Voto confirmado para [Presidente]'),
    linha('08:04:00', 'Início das operações do logd', 'INFO', 'LOGD'),
    linha('08:04:00', 'Urna ligada em 25/10/2026 às 08:03:20', 'INFO', 'LOGD'),
    linha('08:06:00', 'Urna pronta para receber votos'),
    linha('08:07:00', 'Identificador do eleitor digitado pelo mesário'),
    linha('08:07:05', 'Eleitor foi habilitado'),
    linha('08:07:30', 'O voto do eleitor foi computado')
  ].join('\n');
  const a = analisarDia(lerLog(texto), '25/10/2026', 'SP');
  assert.equal(a.votos.length, 1);
  assert.equal(a.interrompidos.length, 1);
  assert.equal(a.interrompidos[0].hora, '08:01:20', 'hora do voto confirmado, não da religação');
  const v = Object.fromEntries(verificar(a, { boletim: { comparecimento: 2, habilitacao: { 'biométrica': 1 } } }).map(x => [x.id, x.status]));
  assert.equal(v['bu-comparecimento'], 'info');
  assert.equal(v['bu-biometria'], 'info');
});

test('fuso por município: oeste do Amazonas segue o horário do Acre', async () => {
  const { horaDeBrasilia, localDaUrna } = await import('../src/domain/LogUrna.js');
  assert.equal(horaDeBrasilia('06:00:01', localDaUrna('AM', '98477')), '08:00:01', 'Tabatinga');
  assert.equal(horaDeBrasilia('07:00:01', localDaUrna('AM', '02550')), '08:00:01', 'Manaus');
  assert.equal(horaDeBrasilia('08:00:01', localDaUrna('SP', '71072')), '08:00:01');
});

test('Registro Digital do Voto: voto a voto igual ao boletim (Caroebe-RR, 2º turno)', async () => {
  const { lerRdv, somarRdv, conferirComBoletim } = await import('../src/domain/Rdv.js');
  const rdv = lerRdv(ex('rr/o03221rr0300000040011-rdv.dat'));
  const pres = rdv.cargos.find(c => c.cargo === 'PRESIDENTE');
  const s = somarRdv(pres);
  assert.equal(pres.votos.length, 212);
  assert.deepEqual(s.porNumero, { 13: 42, 22: 166 });
  assert.equal(s.brancos, 1);
  assert.equal(s.nulos, 3);
  assert.deepEqual(Object.keys(s.nulosDigitados).sort(), ['00', '11', '90'], 'o RDV guarda o que quem anulou digitou');
  assert.ok(conferirComBoletim(rdv, lerBuDat(ex('rr/o03221rr0300000040011-bu.dat'))).every(c => c.confere));
});

test('planilha .xlsx: ZIP válido com as abas e o texto escapado', async () => {
  const { gerarXlsx } = await import('../src/infrastructure/XlsxWriter.js');
  const { ZipLeitor } = await import('../src/infrastructure/ZipLeitor.js');
  const blob = gerarXlsx([{ nome: 'Resumo', linhas: [['Campo', 'Valor'], ['Município', 'Caroebe & <RR>'], ['Votos', 212]] }, { nome: 'RDV/boletim', linhas: [['Nº', 'Votos'], ['22', 166]] }]);
  const zip = await new ZipLeitor(blob).abrir();
  const nomes = zip.entradas.map(e => e.nome);
  assert.ok(nomes.includes('xl/workbook.xml') && nomes.includes('xl/worksheets/sheet2.xml'));
  const aba1 = new TextDecoder().decode(await zip.ler('xl/worksheets/sheet1.xml'));
  assert.ok(aba1.includes('Caroebe &amp; &lt;RR&gt;') && aba1.includes('<v>212</v>'));
  const livro = new TextDecoder().decode(await zip.ler('xl/workbook.xml'));
  assert.ok(livro.includes('name="RDV boletim"'), 'barra não é permitida em nome de aba');
});

test('segurança: ASN.1 aninhado demais é recusado e o link do mapa só aceita coordenadas numéricas', async () => {
  const { lerDer } = await import('../src/domain/BuDat.js');
  // 40 SEQUENCEs uma dentro da outra (cada nível declara o resto do arquivo): passa do limite de 32
  const n = 40, bytes = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) { bytes[i * 2] = 0x30; bytes[i * 2 + 1] = (n - i - 1) * 2; }
  assert.throws(() => lerDer(bytes), /aninhamento/);
  assert.doesNotThrow(() => lerDer(bytes.subarray(20 * 2)), '20 níveis ainda são aceitos');
  const { linkDoMapa } = await import('../src/domain/Endereco.js');
  assert.ok(linkDoMapa({ lat: '1#x', lon: 2, rua: 'RUA A', municipio: 'X', uf: 'SP' }).includes('/search?query='), 'coordenada que não é número vira busca por endereço');
});
