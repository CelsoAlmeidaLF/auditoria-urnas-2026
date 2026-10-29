/**
 * Reconfere as urnas marcadas (ponto para olhar ou não lidas) de data/panorama/<UF>.json, baixando o log e o
 * boletim de cada uma do site de resultados do TSE e analisando com o código atual. Serve para:
 *  - aplicar uma regra corrigida sem baixar de novo o pacote inteiro da UF;
 *  - conferir que o arquivo do site de resultados é o mesmo do pacote de Dados Abertos (mesma contagem).
 *
 *   node scripts/panorama_reconferir.mjs [UF ...]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TseResultadosGateway } from '../src/infrastructure/TseResultadosGateway.js';
import { resumirUrna } from '../src/application/AuditoriaService.js';

const pasta = fileURLToPath(new URL('../data/panorama/', import.meta.url));
const pedidas = process.argv.slice(2);
const tse = new TseResultadosGateway();
const bytes = async f => new Uint8Array(await f.arrayBuffer());

for (const nome of readdirSync(pasta).filter(n => /^[A-Z]{2}\.json$/.test(n))) {
  const dados = JSON.parse(readFileSync(pasta + nome, 'utf8'));
  if (pedidas.length && !pedidas.includes(dados.uf)) continue;
  const marcadas = dados.destaque.filter(r => r.atencao.length || r.erro);
  if (!marcadas.length) continue;
  for (const r of marcadas) {
    const [uf, municipio, zona, secao] = r.chave.split('-');
    const s = { uf, municipio, zona, secao };
    try {
      const conjuntos = await tse.arquivosDaSecao(dados.pleito, s);
      const c = [...conjuntos].reverse().find(x => /totaliz/i.test(x.situacao)) || conjuntos.at(-1);
      const arq = n => c.arquivos.find(a => a.nome.endsWith(n))?.nome;
      const log = await bytes(await tse.baixar(dados.pleito, s, c.hash, arq('-log.jez')));
      const bu = arq('-bu.dat') ? await bytes(await tse.baixar(dados.pleito, s, c.hash, arq('-bu.dat'))) : null;
      const novo = await resumirUrna(log, null, uf, bu, { municipio, secao });
      const mesmaContagem = novo.votos === r.votos;
      // Totais da UF acompanham a urna reconferida (ex.: log de outra seção que tinha sido somado)
      dados.votos += novo.votos - r.votos;
      if (novo.comparecimento != null && r.comparecimento != null) dados.comparecimento += novo.comparecimento - r.comparecimento;
      dados.interrompidos = (dados.interrompidos || 0) + (novo.interrompidos || 0) - (r.interrompidos || 0);
      if (novo.votos !== r.votos) dados.totaisAjustados = true;
      Object.assign(r, { votos: novo.votos, comparecimento: novo.comparecimento, abertura: novo.abertura, encerramento: novo.encerramento, menorIntervalo: novo.menorIntervalo, contingencia: novo.contingencia, interrompidos: novo.interrompidos, atencao: novo.atencao, erro: undefined, reconferida: true });
      console.log(`${r.chave}: ${mesmaContagem ? 'mesma contagem' : 'CONTAGEM DIFERENTE'} no site de resultados · pontos agora: ${novo.atencao.join(', ') || 'nenhum'}`);
    } catch (e) {
      console.log(`${r.chave}: não reconferida (${e.message})`);
    }
  }
  // Recalcula os pontos da UF a partir das urnas em destaque (as demais não tinham ponto)
  dados.pontos = {};
  for (const r of dados.destaque) for (const p of r.atencao) dados.pontos[p] = (dados.pontos[p] || 0) + 1;
  dados.naoLidas = dados.destaque.filter(r => r.erro).length;
  dados.destaque = dados.destaque.filter(r => r.atencao.length || r.erro || r.contingencia || r.interrompidos);
  writeFileSync(pasta + nome, JSON.stringify(dados));
  console.log(`${dados.uf}: pontos ${JSON.stringify(dados.pontos)}`);
}
