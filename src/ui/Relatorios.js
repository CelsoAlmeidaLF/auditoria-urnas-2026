/**
 * Relatórios em PDF (página de impressão → "Salvar como PDF" do navegador) e em Excel (.xlsx gerado no aparelho).
 * Três assuntos: uma urna, os locais/urnas de um filtro (zona, município) e o Panorama do Brasil.
 * Cada função devolve { titulo, html, abas } — html para o PDF, abas para o Excel.
 */
import { esc, br, nomeDaSecao, titulo as tituloDe } from './Formato.js?v=20261029-1825';
import { horaDeBrasilia } from '../domain/LogUrna.js?v=20261029-1825';
import { somarRdv } from '../domain/Rdv.js?v=20261029-1825';

const agora = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const ROTULO = { ok: 'confere', atencao: 'olhe no log', info: 'informação' };
const tabela = (cab, linhas) => `<table><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(v => `<td>${typeof v === 'number' ? br(v) : esc(v ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const rodape = fonte => `<footer><p>${esc(fonte)}</p><p>Gerado em ${esc(agora())} pelo app Auditoria das Urnas (Systekna). Arquivos públicos do TSE, lidos no aparelho de quem gerou este relatório.</p></footer>`;

/** Relatório de uma urna */
export function relatorioUrna(r) {
  const { urna, analise: a, analiseOriginal: o, boletim, verificacoes, local, rdv } = r;
  const uf = a.uf;
  const h = x => (x ? horaDeBrasilia(x, uf) : '—');
  const nome = nomeDaSecao(urna, boletim);
  const votos = a.votos.length + (o ? o.votos.length : 0);
  const titulo = `Auditoria da urna — ${nome}`;
  const resumo = [
    ['Seção', nome], ['Dia analisado', a.dia], ['Urna(s)', [...new Set([...(o?.urnas || []), ...a.urnas])].join(' → ')],
    ['Modelo', a.identificacao.modelo], ['Software', a.identificacao.versao],
    ['Votos registrados no log', votos], ['Comparecimento no boletim', boletim?.comparecimento ?? null], ['Aptos', boletim?.aptos ?? null],
    ['Início da votação', h((o?.aberturas[0] ?? a.aberturas[0])?.hora)], ['Encerramento', h(a.encerramentos.at(-1)?.hora ?? o?.encerramentos.at(-1)?.hora)],
    ['Menor intervalo entre votos (s)', a.intervalos.menor], ['Troca de urna', a.contingencia || o ? 'sim' : 'não'],
    ['Fonte', urna.origem]
  ];
  const enderecoLinhas = local ? [['Local de votação', local.nome], ['Rua', local.rua], ['Número', local.numero || 'não informado'], ['Complemento', local.complemento], ['Bairro', local.bairro], ['CEP', local.cep], ['Município', tituloDe(local.nomeMunicipio)], ['Zona', String(local.zona)], ['Seções no local', local.secoes.join(', ')], ['Endereço no cadastro do TSE', local.enderecoTse]] : [];
  const verifLinhas = verificacoes.map(v => [ROTULO[v.status], v.titulo, v.resultado]);
  const boletimLinhas = boletim ? boletim.cargos.flatMap(c => [...c.candidatos.map(x => [c.cargo, x.numero, x.nome || '', x.votos]), [c.cargo, 'brancos', '', c.brancos], [c.cargo, 'nulos', '', c.nulos]]) : [];
  const rdvLinhas = rdv ? rdv.cargos.flatMap(c => {
    const s = somarRdv(c);
    const b = boletim?.cargos.find(x => x.cargo === c.cargo);
    return [...Object.entries(s.porNumero).sort((x, y) => y[1] - x[1]).map(([n, q]) => [c.cargo, n, q, b?.candidatos.find(x => x.numero === n)?.votos ?? null]),
      [c.cargo, 'brancos', s.brancos, b?.brancos ?? null], [c.cargo, 'nulos', s.nulos, b?.nulos ?? null]];
  }) : [];
  const marcos = [...(o ? o.marcos.map(m => ({ ...m, anterior: true })) : []), ...a.marcos].sort((x, y) => x.seg - y.seg);
  const ocorrencias = [...(o?.alertas || []), ...(o?.erros || []), ...a.alertas, ...a.erros];

  const html = `
    <header><h1>${esc(titulo)}</h1><p>${esc(a.dia)} · votos registrados no log: <strong>${br(votos)}</strong> · comparecimento no boletim: <strong>${br(boletim?.comparecimento)}</strong></p></header>
    <h2>Resumo</h2>${tabela(['Campo', 'Valor'], resumo)}
    ${local ? `<h2>Local de votação</h2>${tabela(['Campo', 'Valor'], enderecoLinhas)}` : ''}
    <h2>Verificações</h2>${tabela(['Situação', 'Verificação', 'Resultado'], verifLinhas)}
    ${boletim ? `<h2>Boletim de urna</h2>${tabela(['Cargo', 'Número', 'Nome', 'Votos'], boletimLinhas)}` : ''}
    ${rdv ? `<h2>Registro Digital do Voto × boletim</h2>${tabela(['Cargo', 'Número', 'No RDV', 'No boletim'], rdvLinhas)}` : ''}
    <h2>Linha do tempo do dia</h2>${tabela(['Hora (Brasília)', 'Marco', 'Urna'], marcos.map(m => [h(m.hora), m.titulo, m.anterior ? 'anterior à troca' : 'esta']))}
    ${ocorrencias.length ? `<h2>Alertas e erros (texto do log)</h2>${tabela(['Hora', 'Nível', 'Aplicação', 'Mensagem'], ocorrencias.map(e => [h(e.hora), e.nivel, e.app, e.msg]))}` : ''}
    ${rodape('Fontes: log (logd.dat), boletim (bu.dat/imgbu.dat) e Registro Digital do Voto (rdv.dat) publicados pelo TSE; endereço do cadastro "Eleitorado por local de votação 2026".')}`;

  const eventos = [...(o ? o.eventos.map(e => ({ ...e, origem: 'urna anterior' })) : []), ...a.eventos.map(e => ({ ...e, origem: 'esta urna' }))];
  const abas = [
    { nome: 'Resumo', linhas: [['Campo', 'Valor'], ...resumo] },
    ...(local ? [{ nome: 'Local de votação', linhas: [['Campo', 'Valor'], ...enderecoLinhas] }] : []),
    { nome: 'Verificações', linhas: [['Situação', 'Verificação', 'Resultado'], ...verifLinhas] },
    ...(boletim ? [{ nome: 'Boletim', linhas: [['Cargo', 'Número', 'Nome', 'Votos'], ...boletimLinhas] }] : []),
    ...(rdv ? [{ nome: 'RDV x boletim', linhas: [['Cargo', 'Número', 'No RDV', 'No boletim'], ...rdvLinhas] },
      { nome: 'RDV voto a voto', linhas: [['Cargo', 'Posição no RDV', 'Tipo', 'Digitado'], ...rdv.cargos.flatMap(c => c.votos.map((v, i) => [c.cargo, i + 1, v.tipo, v.digitado]))] }] : []),
    { nome: 'Linha do tempo', linhas: [['Hora (Brasília)', 'Marco', 'Urna'], ...marcos.map(m => [h(m.hora), m.titulo, m.anterior ? 'anterior à troca' : 'esta'])] },
    { nome: 'Eventos do dia', linhas: [['Linha', 'Data', 'Hora (relógio da urna)', 'Nível', 'Urna', 'Aplicação', 'Mensagem', 'Verificador', 'Log'], ...eventos.map(e => [e.n, e.dia, e.hora, e.nivel, e.urna, e.app, e.msg, e.verificador, e.origem])] }
  ];
  return { titulo, html, abas, arquivo: `urna-${urna.chave}` };
}

/** Relatório dos locais e urnas do filtro atual da aba Locais e zonas */
export function relatorioLocais({ uf, municipio, zona, lista, detalhes }) {
  const nomeMun = lista[0] ? tituloDe(lista[0].nomeMunicipio) : '';
  const titulo = `Locais de votação e logs — ${uf}${municipio ? ` · ${nomeMun}` : ''}${zona ? ` · zona ${zona}` : ''}`;
  const chave = (l, s) => `${uf}-${l.municipio}-${String(l.zona).padStart(4, '0')}-${String(s).padStart(4, '0')}`;
  const locais = lista.map(l => [tituloDe(l.nomeMunicipio), String(l.zona), String(l.local), l.nome, l.rua, l.numero, l.complemento, l.bairro, l.cep, l.secoes.join(' '), l.eleitores]);
  const urnas = [];
  const ocorrencias = new Map();
  for (const l of lista) for (const s of l.secoes) {
    const d = detalhes.get(chave(l, s));
    if (!d || d.erro) continue;
    const hh = x => (x ? horaDeBrasilia(x, d.uf) : '');
    urnas.push([String(l.zona), String(s), l.nome, l.rua, l.numero, l.bairro, l.cep, d.urnas.join(' '), d.votos, d.comparecimento, d.aptos, hh(d.abertura), hh(d.encerramento),
      d.cabineMedia, d.menorIntervalo, d.liberadosDigital, d.digitalFalhou, d.jaVotou, d.desistencias, d.religamentos, d.contingencia ? 'sim' : 'não', d.alertas, d.erros,
      d.verificacoes.filter(v => v.status === 'atencao').map(v => v.titulo).join(' / ') || 'confere']);
    for (const o of d.ocorrencias) {
      const k = `${o.nivel}|${o.msg}`;
      const x = ocorrencias.get(k) || { nivel: o.nivel, msg: o.msg, vezes: 0, urnas: 0 };
      x.vezes += o.vezes; x.urnas++;
      ocorrencias.set(k, x);
    }
  }
  const cabLocais = ['Município', 'Zona', 'Nº do local', 'Local de votação', 'Rua', 'Número', 'Complemento', 'Bairro', 'CEP', 'Seções', 'Eleitores'];
  const cabUrnas = ['Zona', 'Seção', 'Local', 'Rua', 'Número', 'Bairro', 'CEP', 'Urna(s)', 'Votos no log', 'Boletim', 'Aptos', 'Abertura', 'Encerramento', 'Cabine média (s)', 'Menor intervalo (s)', 'Pela digital', 'Digital falhou', 'Já tinha votado', 'Saíram sem votar', 'Religamentos', 'Troca', 'Alertas', 'Erros', 'Situação'];
  const oc = [...ocorrencias.values()].sort((x, y) => y.vezes - x.vezes).map(o => [o.nivel, o.msg, o.vezes, o.urnas]);
  const html = `
    <header><h1>${esc(titulo)}</h1><p>${br(lista.length)} locais · ${br(lista.reduce((s, l) => s + l.secoes.length, 0))} seções · logs conferidos: ${br(urnas.length)} urnas</p></header>
    <h2>Locais de votação</h2>${tabela(cabLocais, locais)}
    ${urnas.length ? `<h2>O que tinha no log de cada urna</h2>${tabela(['Zona', 'Seção', 'Local', 'Votos no log', 'Boletim', 'Abertura', 'Encerramento', 'Religada', 'Troca', 'Alertas/erros', 'Situação'],
      urnas.map(u => [u[0], u[1], u[2], u[8], u[9], u[11], u[12], u[19], u[20], `${u[21]}/${u[22]}`, u[23]]))}` : '<p>Os logs das urnas não foram conferidos neste filtro (use "Conferir os logs" antes de gerar o relatório).</p>'}
    ${oc.length ? `<h2>Alertas e erros (texto do log)</h2>${tabela(['Nível', 'Mensagem', 'Vezes', 'Urnas'], oc)}` : ''}
    ${rodape('Fontes: cadastro "Eleitorado por local de votação 2026" e arquivos de urna do site de resultados do TSE.')}`;
  return {
    titulo, html, paisagem: true, arquivo: `locais-${uf}${municipio ? `-${municipio}` : ''}${zona ? `-zona${zona}` : ''}`,
    abas: [{ nome: 'Locais', linhas: [cabLocais, ...locais] }, ...(urnas.length ? [{ nome: 'Logs das urnas', linhas: [cabUrnas, ...urnas] }, { nome: 'Alertas e erros', linhas: [['Nível', 'Mensagem', 'Vezes', 'Urnas'], ...oc] }] : [])]
  };
}

/** Relatório do Panorama do Brasil */
export function relatorioPanorama(d) {
  const b = d.brasil;
  const m = b.metricas || {};
  const titulo = `Panorama dos logs das urnas — ${d.turno}`;
  const media = (s, n) => (n ? Math.round(s / n) : null);
  const ufs = d.ufs.map(u => {
    const mu = u.metricas || {};
    return [u.uf, u.urnas, u.votos, u.comparecimento, u.votos - u.comparecimento, u.trocas, u.urnasComPonto, mu.votos ? Math.round(mu.liberadosDigital / mu.votos * 1000) / 10 : null,
      media(mu.cabineSoma, mu.cabineN), mu.religamentos ?? null, u.alertas, u.erros, u.semHabilitacao, u.foraDaJanela];
  });
  const cab = ['UF', 'Urnas', 'Votos no log', 'Boletins', 'Diferença', 'Trocas', 'Urnas para olhar', '% pela digital', 'Cabine média (s)', 'Religamentos', 'Alertas', 'Erros', 'Votos sem habilitação', 'Votos fora do horário'];
  const total = ['Brasil', b.urnas, b.votos, b.comparecimento, b.votos - b.comparecimento, b.trocas, d.ufs.reduce((s, u) => s + u.urnasComPonto, 0),
    m.votos ? Math.round(m.liberadosDigital / m.votos * 1000) / 10 : null, media(m.cabineSoma, m.cabineN), m.religamentos ?? null, b.alertas, b.erros, b.semHabilitacao, b.foraDaJanela];
  const destaque = d.destaque.filter(r => r.atencao.length || r.erro).map(r => { const [uf, mun, z, s] = r.chave.split('-'); return [uf, mun, String(+z), String(+s), r.votos, r.comparecimento, r.atencao.join(', ') || r.erro]; });
  const trocas = d.destaque.filter(r => r.contingencia).map(r => { const [uf, mun, z, s] = r.chave.split('-'); return [uf, mun, String(+z), String(+s), r.votos, r.comparecimento]; });
  const oc = Object.entries(m.ocorrencias || {}).map(([k, v]) => { const [nivel, app, msg] = k.split('|'); return [nivel, app, msg, v.vezes, v.urnas]; });
  const html = `
    <header><h1>${esc(titulo)}</h1><p>${br(b.urnas)} urnas de ${d.conferidas.length} de 28 UFs · votos nos logs ${br(b.votos)} · comparecimento nos boletins ${br(b.comparecimento)}${d.faltam.length ? ` · em conferência: ${esc(d.faltam.join(', '))}` : ''}</p></header>
    <h2>Por estado</h2>${tabela(cab, [...ufs, total])}
    <h2>Urnas com ponto para olhar</h2>${destaque.length ? tabela(['UF', 'Município (TSE)', 'Zona', 'Seção', 'Votos no log', 'Boletim', 'Ponto'], destaque) : '<p>Nenhuma.</p>'}
    ${oc.length ? `<h2>Alertas e erros mais frequentes</h2>${tabela(['Nível', 'Aplicação', 'Mensagem', 'Vezes', 'Urnas'], oc.slice(0, 25))}` : ''}
    ${rodape('Fonte: pacotes "Arquivos transmitidos para totalização" (TSE, Dados Abertos), conferidos urna a urna.')}`;
  return {
    titulo, html, paisagem: true, arquivo: 'panorama-urnas-2turno',
    abas: [
      { nome: 'Por estado', linhas: [cab, ...ufs, total] },
      { nome: 'Urnas para olhar', linhas: [['UF', 'Município (TSE)', 'Zona', 'Seção', 'Votos no log', 'Boletim', 'Ponto'], ...destaque] },
      { nome: 'Urnas trocadas', linhas: [['UF', 'Município (TSE)', 'Zona', 'Seção', 'Votos no log', 'Boletim'], ...trocas] },
      { nome: 'Alertas e erros', linhas: [['Nível', 'Aplicação', 'Mensagem', 'Vezes', 'Urnas'], ...oc] },
      { nome: 'Votos por hora', linhas: [['Hora (Brasília)', 'Votos'], ...Object.entries(b.porHora).sort().map(([hh, n]) => [`${hh}h`, n])] }
    ]
  };
}

/** Mostra o relatório na página de impressão e abre o diálogo do navegador (destino "Salvar como PDF") */
export function imprimir({ titulo, html, paisagem = false }) {
  let area = document.getElementById('areaImpressao');
  if (!area) {
    area = document.createElement('div');
    area.id = 'areaImpressao';
    document.body.appendChild(area);
  }
  // Tabelas largas (locais, panorama) saem com a folha na horizontal
  area.innerHTML = `${paisagem ? '<style>@page { size: A4 landscape; }</style>' : ''}<article class="relatorio">${html}</article>`;
  const tituloAntigo = document.title;
  document.title = titulo;
  const limpar = () => { area.innerHTML = ''; document.title = tituloAntigo; window.removeEventListener('afterprint', limpar); };
  window.addEventListener('afterprint', limpar);
  window.print();
}
