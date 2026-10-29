/**
 * Aba "Panorama": resultado da conferência dos logs de todas as urnas do 2º turno, já processados
 * (data/panorama/brasil.json, gerado por scripts/panorama_brasil.sh). Tocar numa urna baixa o log dela do TSE.
 *
 * Organização: números do país → tabelas por estado (um tema por vez) → gráficos e faixas →
 * alertas e erros mais frequentes → lista de urnas para olhar ou trocadas.
 */
import { icone } from './Icones.js?v=20261029-1825';
import { esc, br, duracao, semZeros } from './Formato.js?v=20261029-1825';
import { horaDeBrasilia, localDaUrna } from '../domain/LogUrna.js?v=20261029-1825';

const NOMES_UF = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba',
  PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima',
  RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins', ZZ: 'Exterior'
};
const PONTOS = {
  habilitacao: 'voto sem eleitor habilitado', janela: 'voto fora do horário', abertura: 'abertura antes das 8h',
  encerramento: 'sem encerramento no log', rajadas: 'votos com menos de 15 s', assinaturas: 'assinatura sem sucesso',
  'bu-comparecimento': 'log ≠ boletim (votos)', 'bu-biometria': 'log ≠ boletim (biometria)', 'bu-urna': 'urna ≠ boletim'
};
const ORDEM = {
  abertura: ['antes das 8h', '8h00–8h05', '8h05–9h', 'depois das 9h', 'sem registro'],
  encerramento: ['antes das 17h', '17h00–17h15', '17h15–18h', '18h–19h', 'depois das 19h', 'sem registro'],
  menorIntervalo: ['menos de 15 s', '15–29 s', '30–59 s', '60 s ou mais', 'sem par de votos'],
  cabine: ['até 29 s', '30–59 s', '1–2 min', '2–5 min', '5 min ou mais'],
  atendimento: ['até 1 min', '1–2 min', '2–3 min', '3–5 min', '5 min ou mais']
};
/** O que significam os alertas e erros mais comuns (texto do log com números trocados por #) */
const SIGNIFICADO = {
  'Identificador do eleitor digitado inválido': 'O mesário digitou um título ou CPF que não é desta seção; a urna não libera.',
  'Problema ao desmontar a MR': 'Aviso técnico ao liberar a mídia de resultado (pen drive). Aparece em quase todas as urnas, sem efeito no voto.',
  'Digitado título inválido para o registro de mesário': 'Título digitado errado ao registrar um mesário.',
  'Habilitação cancelada durante reconhecimento biométrico': 'O mesário interrompeu a leitura da digital, em geral para liberar o eleitor pelo documento.',
  'Mesário indagado se eleitor está votando': 'O eleitor ficou parado na tela; a urna pergunta ao mesário se ele continua votando.',
  'O eleitor identificado já votou': 'A urna recusou liberar quem já tinha votado nesta seção.',
  'Eleitor já justificou': 'A urna recusou liberar quem já tinha justificado a ausência.',
  'Ano de nascimento digitado é diferente do cadastro': 'Conferência do ano de nascimento falhou; o eleitor não é liberado até conferir.',
  'Eleitor não está votando': 'O mesário respondeu que o eleitor saiu da cabine sem terminar.',
  'Encerramento só pode ser solicitado após as #:#:# horas': 'A urna recusou encerrar a votação antes do horário.',
  'Tempo limite de espera usando bateria interna atingido': 'A urna ficou no limite de tempo na bateria e pediu energia.',
  'Identificado arquivo de log corrompido na ME': 'Na troca de urna, o log da urna anterior veio com defeito no cartão.',
  'Bateria interna ausente': 'A urna está sem bateria interna e funciona só na tomada.',
  'Urna não testada': 'A urna não passou pelo teste de preparação antes da eleição.'
};
const TEMAS = [
  ['votos', 'Votos e boletins'],
  ['eleitores', 'Eleitores'],
  ['tempos', 'Tempos'],
  ['equipamento', 'Equipamento'],
  ['conferencias', 'Conferências']
];
const PAGINA = 200;

const pct = (a, b) => (b ? `${(a / b * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
const media = (soma, n) => (n ? duracao(Math.round(soma / n)) : '—');
const n1 = v => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));

export class PanoramaView {
  /** @param {HTMLElement} raiz @param {{ aoAbrirSecao: (s: {pleito: string, uf: string, municipio: string, zona: string, secao: string}) => void }} acoes */
  constructor(raiz, acoes, url = 'data/panorama/brasil.json') {
    this.raiz = raiz;
    this.acoes = acoes;
    this.url = url;
    this.dados = null;
    this.uf = '';
    this.tema = 'votos';
    this.filtro = 'atencao';
    this.limite = PAGINA;
    raiz.addEventListener('click', e => {
      const alvo = e.target.closest('[data-acao]');
      if (alvo) {
        const a = alvo.dataset.acao;
        if (a.startsWith('filtro-')) { this.filtro = a.slice(7); this.limite = PAGINA; }
        else if (a.startsWith('tema-')) this.tema = a.slice(5);
        else if (a === 'uf') { this.uf = this.uf === alvo.dataset.uf ? '' : alvo.dataset.uf; this.limite = PAGINA; }
        else if (a === 'mais') this.limite += PAGINA;
        this.render();
        if (a === 'uf' && this.uf) this.raiz.querySelector('#detalheUf')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const linha = e.target.closest('tr[data-chave]');
      if (linha) this._abrir(linha.dataset.chave);
    });
    raiz.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const alvo = e.target.closest('tr[data-chave], tr[data-acao]');
      if (!alvo) return;
      e.preventDefault();
      alvo.click();
    });
  }

  async carregar() {
    this.raiz.innerHTML = `<div class="vazio">${icone('clock')}<p>Carregando o panorama…</p></div>`;
    try {
      const r = await fetch(this.url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(String(r.status));
      this.dados = await r.json();
    } catch {
      this.dados = null;
    }
    this.render();
  }

  _abrir(chave) {
    const [uf, municipio, zona, secao] = chave.split('-');
    this.acoes.aoAbrirSecao({ pleito: this.dados.pleito, uf, municipio, zona, secao });
  }

  render() {
    const d = this.dados;
    if (!d) {
      this.raiz.innerHTML = `<div class="vazio">${icone('layers')}<p>O panorama ainda não foi gerado. Use a aba Abrir urna para conferir uma seção.</p></div>`;
      return;
    }
    const b = d.brasil;
    const m = b.metricas || {};
    const comPonto = d.ufs.reduce((s, u) => s + u.urnasComPonto, 0);
    const diferenca = b.votos - b.comparecimento;
    const completo = !d.faltam.length;
    const parcialMetricas = (b.metricasUfs?.length || 0) < d.ufs.length;

    this.raiz.innerHTML = `
      <div class="intro">
        <h2>Os logs de ${completo ? 'todas as urnas' : `${br(b.urnas)} urnas`} do ${esc(d.turno)}</h2>
        <p>Baixamos do TSE o log e o boletim de cada urna ${completo ? 'do país e do exterior' : `de ${d.conferidas.length} de 28 UFs (27 estados e o exterior)`} e conferimos linha por linha. ${completo ? '' : `Ainda em conferência: ${esc(d.faltam.join(', '))}.`} Toque num estado para ver os detalhes dele, ou numa urna para baixar o log dela do TSE.</p>
        <p class="nota">Atualizado em ${esc(new Date(d.geradoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))} · ${br(Math.round(b.tamanho / 1073741824))} GB de arquivos do TSE.${parcialMetricas ? ` Métricas de eleitores, tempos e equipamento: ${esc((b.metricasUfs || []).join(', ') || 'em processamento')} (as demais UFs estão sendo reprocessadas).` : ''}</p>
      </div>

      <section class="secao">
      <h3 class="secao-titulo">${icone('checkCircle')}Resultado da conferência</h3>
      <div class="grade-kpi">
        ${kpi('Urnas conferidas', br(b.urnas), b.naoLidas ? `${br(b.naoLidas)} não lidas` : 'todas lidas')}
        ${kpi('Votos registrados nos logs', br(b.votos), 'linhas "O voto do eleitor foi computado"')}
        ${kpi('Comparecimento nos boletins', br(b.comparecimento), 'boletins digitais assinados')}
        ${kpi('Diferença log − boletim', br(diferenca), notaDiferenca(diferenca, b.interrompidos || 0, d.destaque))}
        ${kpi('Votos sem eleitor habilitado', br(b.semHabilitacao), 'voto "fantasma"')}
        ${kpi('Votos fora do horário', br(b.foraDaJanela), 'antes da abertura ou após o encerramento')}
        ${kpi('Urnas com ponto para olhar', br(comPonto), comPonto ? 'lista no fim da página' : 'em todas, o log confere')}
        ${kpi('Urnas trocadas no dia', br(b.trocas), 'contingência: votos das duas somados')}
      </div>
      </section>

      ${completo && d.semUrna ? contaOficial(b, d.semUrna, d.ufs) : ''}

      ${m.votos ? `
      <section class="secao">
      <h3 class="secao-titulo">${icone('vote')}O que mais o log mostra</h3>
      <div class="grade-kpi">
        ${kpi('Liberados pela digital', pct(m.liberadosDigital, m.votos), `${br(m.liberadosDigital)} de ${br(m.votos)} eleitores`)}
        ${kpi('Digital não reconhecida', pct(m.digitalFalhou, m.digitalTentada), `${br(m.digitalFalhou)} liberados por documento depois de tentar`)}
        ${kpi('Tentativas de digital por eleitor', n1(m.digitalTentada ? m.tentativasDigital / m.digitalTentada : null), 'média de quem tentou')}
        ${kpi('Tempo médio na cabine', media(m.cabineSoma, m.cabineN), 'de "habilitado" a "computado"')}
        ${kpi('Tempo médio de atendimento', media(m.atendimentoSoma, m.atendimentoN), 'do título digitado ao voto')}
        ${kpi('Bloqueios de quem já votou', br(m.ocorrencias?.['ALERTA|VOTA|O eleitor identificado já votou']?.vezes ?? 0), 'a urna recusou liberar de novo')}
        ${kpi('Saíram sem votar', br(m.desistencias), 'liberados que não concluíram')}
        ${kpi('Urnas religadas no dia', br(m.religamentos), `${br(m.suspensoes)} votações suspensas`)}
      </div>
      </section>` : ''}

      <div class="glass-panel cartao">
        <div class="cabecalho-tabela">
          <h3 class="cartao-titulo">${icone('layers')}Por estado</h3>
          <div class="segmented-control" role="tablist" aria-label="Tema da tabela">
            ${TEMAS.map(([k, t]) => `<button type="button" class="segmented-control-btn ${this.tema === k ? 'active' : ''}" role="tab" aria-selected="${this.tema === k}" data-acao="tema-${k}">${t}</button>`).join('')}
          </div>
        </div>
        <p class="nota">${esc(NOTA_TEMA[this.tema])} Toque num estado para ver os detalhes.</p>
        ${this._tabelaUfs()}
      </div>

      <div id="detalheUf">${this._detalhe()}</div>

      ${this._lista()}
    `;
  }

  /** Tabela por estado do tema escolhido, com a linha do Brasil no rodapé */
  _tabelaUfs() {
    const d = this.dados;
    const col = COLUNAS[this.tema];
    const linhaUf = u => `
      <tr data-acao="uf" data-uf="${u.uf}" class="${this.uf === u.uf ? 'selecionada' : ''}" tabindex="0">
        <td><strong>${u.uf}</strong> <span class="ocultar-celular">${esc(NOMES_UF[u.uf] || '')}</span></td>
        ${col.map(c => `<td class="${c.texto ? '' : 'num'} ${c.celular === false ? 'ocultar-celular' : ''}">${c.metrica && !u.metricas ? '<span class="nota">…</span>' : c.v(u, u.metricas || {})}</td>`).join('')}
      </tr>`;
    const total = { ...d.brasil, uf: 'BR', urnasComPonto: d.ufs.reduce((s, u) => s + u.urnasComPonto, 0) };
    return `<div class="tabela-wrap"><table class="tabela-urnas tabela-ufs">
      <thead><tr><th>UF</th>${col.map(c => `<th class="${c.texto ? '' : 'num'} ${c.celular === false ? 'ocultar-celular' : ''}" title="${esc(c.dica || '')}">${esc(c.t)}</th>`).join('')}</tr></thead>
      <tbody>
        ${d.ufs.map(linhaUf).join('')}
        ${d.faltam.map(uf => `<tr><td><strong>${uf}</strong> <span class="ocultar-celular">${esc(NOMES_UF[uf] || '')}</span></td><td colspan="${col.length}"><span class="selo selo-info">em conferência</span></td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td><strong>Brasil</strong>${d.faltam.length ? ' <small class="nota">(parcial)</small>' : ''}</td>${col.map(c => `<td class="${c.texto ? '' : 'num'} ${c.celular === false ? 'ocultar-celular' : ''}">${c.metrica && !total.metricas?.votos ? '—' : c.v(total, total.metricas || {})}</td>`).join('')}</tr></tfoot>
    </table></div>`;
  }

  /** Gráficos, faixas e ocorrências: do estado escolhido ou do país */
  _detalhe() {
    const d = this.dados;
    const fonte = this.uf ? d.ufs.find(u => u.uf === this.uf) : d.brasil;
    if (!fonte) return '';
    const m = fonte.metricas || {};
    const nome = this.uf ? NOMES_UF[this.uf] : 'Brasil';
    const exterior = this.uf === 'ZZ';
    const ocorrencias = Object.entries(m.ocorrencias || {}).slice(0, 25);
    return `
      <h3 class="secao-titulo">${icone('chartBar')}Detalhes · ${esc(nome)}${this.uf ? ` <button type="button" class="chip" data-acao="uf" data-uf="${this.uf}">Ver o Brasil</button>` : ''}</h3>
      <div class="grade-2">
        <div class="glass-panel cartao">
          <h3 class="cartao-titulo">${icone('clock')}Votos por hora${exterior ? ' (horário local de cada país)' : ' (horário de Brasília)'}</h3>
          ${barras(fonte.porHora || {})}
          <p class="nota">Votos depois das 17h: ${br(fonte.depoisDas17h)} (eleitores que estavam na fila).</p>
        </div>
        <div class="glass-panel cartao">
          <h3 class="cartao-titulo">${icone('clock')}Horários das urnas</h3>
          ${exterior ? '<p class="nota">No exterior, cada seção segue o horário local do país.</p>' : `
            ${faixas('Início da votação', fonte.abertura, ORDEM.abertura)}
            ${faixas('Encerramento', fonte.encerramento, ORDEM.encerramento)}`}
          ${faixas('Menor intervalo entre dois votos (por urna)', fonte.menorIntervalo, ORDEM.menorIntervalo)}
        </div>
        ${m.votos ? `
        <div class="glass-panel cartao">
          <h3 class="cartao-titulo">${icone('vote')}Tempo de cada eleitor</h3>
          ${faixas('Na cabine (de "habilitado" a "computado")', m.cabine, ORDEM.cabine)}
          ${faixas('Atendimento completo (do título digitado ao voto)', m.atendimento, ORDEM.atendimento)}
        </div>
        <div class="glass-panel cartao">
          <h3 class="cartao-titulo">${icone('layers')}Urnas e programas</h3>
          ${faixas('Modelo da urna', m.modelos, [])}
          ${faixas('Versão do software', m.versoes, [])}
          <p class="nota">Assinaturas digitais dos programas conferidas pela urna: ${br(m.assinaturasOk)} com sucesso, ${br(m.assinaturasFalha)} sem sucesso.</p>
        </div>` : ''}
      </div>

      ${ocorrencias.length ? `
      <div class="glass-panel cartao">
        <h3 class="cartao-titulo">${icone('alert')}Alertas e erros mais frequentes · ${esc(nome)}</h3>
        <p class="nota">Alertas são avisos de operação; erros são falhas de equipamento ou mídia. "Urnas" é em quantas urnas apareceu ao menos uma vez.</p>
        <div class="tabela-wrap"><table class="tabela-urnas tabela-ocorrencias">
          <thead><tr><th>Nível</th><th>Mensagem no log</th><th class="num">Vezes</th><th class="num">Urnas</th><th class="ocultar-celular">O que significa</th></tr></thead>
          <tbody>${ocorrencias.map(([k, v]) => {
            const [nivel, app, msg] = k.split('|');
            return `<tr><td><span class="selo ${nivel === 'ERRO' ? 'selo-atencao' : 'selo-info'}">${esc(nivel)}</span></td>
              <td><span class="font-mono nota">${esc(app)}</span> ${esc(msg)}</td><td class="num">${br(v.vezes)}</td><td class="num">${br(v.urnas)}</td>
              <td class="ocultar-celular nota">${esc(SIGNIFICADO[msg] || '')}</td></tr>`;
          }).join('')}</tbody></table></div>
      </div>` : ''}`;
  }

  _lista() {
    const d = this.dados;
    const todas = d.destaque.filter(r => !this.uf || r.chave.startsWith(`${this.uf}-`));
    const lista = todas.filter(r => this.filtro === 'troca' ? r.contingencia : (r.atencao.length || r.erro))
      .sort((a, b) => (b.atencao.length - a.atencao.length) || a.chave.localeCompare(b.chave));
    const visiveis = lista.slice(0, this.limite);
    return `
      <div class="glass-panel cartao" id="listaDestaque">
        <h3 class="cartao-titulo">${icone('vote')}Urnas ${this.filtro === 'troca' ? 'trocadas no dia' : 'com ponto para olhar'}${this.uf ? ` · ${esc(NOMES_UF[this.uf])}` : ''}</h3>
        <div class="chips" role="group" aria-label="Lista">
          <button type="button" class="chip ${this.filtro === 'atencao' ? 'ativo' : ''}" data-acao="filtro-atencao">Pontos para olhar</button>
          <button type="button" class="chip ${this.filtro === 'troca' ? 'ativo' : ''}" data-acao="filtro-troca">Urnas trocadas</button>
        </div>
        ${lista.length ? `
          <p class="status-linha">${br(lista.length)} urna(s). Toque numa linha para baixar o log do TSE.</p>
          <div class="tabela-wrap"><table class="tabela-urnas">
            <thead><tr><th>Seção</th><th class="num">Votos no log</th><th class="num">Boletim</th><th class="ocultar-celular">Abertura</th><th class="ocultar-celular">Encerramento</th><th class="num ocultar-celular">Menor intervalo</th><th>Situação</th></tr></thead>
            <tbody>${visiveis.map(linha).join('')}</tbody></table></div>
          ${lista.length > visiveis.length ? '<div class="paginacao"><button type="button" class="botao botao-secundario" data-acao="mais">Mostrar mais</button></div>' : ''}`
        : `<p class="nota">${this.filtro === 'troca' ? 'Nenhuma urna trocada.' : 'Nenhuma urna com ponto para olhar: em todas, o log confere com o boletim e não há voto sem eleitor habilitado, fora do horário ou em rajada.'}</p>`}
      </div>`;
  }
}

const NOTA_TEMA = {
  votos: 'Votos registrados no log de cada urna somados e comparados com o comparecimento dos boletins.',
  eleitores: 'Como os eleitores foram liberados: digital, documento, desistências e erros de digitação do mesário.',
  tempos: 'Tempo de cada eleitor e horários de abertura e encerramento (horário de Brasília).',
  equipamento: 'Urnas trocadas, religadas, na bateria, erros de equipamento e assinatura dos programas.',
  conferencias: 'As conferências que poderiam indicar voto indevido: todas em zero significa que nada fugiu do esperado.'
};

/** Colunas de cada tema: t = título, v(u, m) = valor (u: totais da UF, m: métricas da UF), metrica = depende da análise completa */
const COLUNAS = {
  votos: [
    { t: 'Urnas', v: u => br(u.urnas) },
    { t: 'Aptos', v: (u, m) => br(m.aptos), metrica: true, celular: false },
    { t: 'Votos no log', v: u => br(u.votos) },
    { t: 'Boletins', v: u => br(u.comparecimento), celular: false },
    { t: 'Diferença', v: u => br(u.votos - u.comparecimento) },
    { t: 'Comparecimento', v: (u, m) => pct(u.comparecimento, m.aptos), metrica: true, celular: false, dica: 'comparecimento ÷ aptos' },
    { t: 'Situação', texto: true, v: u => (u.urnasComPonto ? `<span class="selo selo-atencao">${br(u.urnasComPonto)} para olhar</span>` : '<span class="selo selo-ok">confere</span>') }
  ],
  eleitores: [
    { t: 'Atendidos', v: (u, m) => br(m.eleitoresAtendidos), metrica: true, celular: false, dica: 'títulos digitados pelo mesário' },
    { t: 'Votaram', v: (u, m) => br(m.votos), metrica: true },
    { t: 'Pela digital', v: (u, m) => pct(m.liberadosDigital, m.votos), metrica: true },
    { t: 'Digital falhou', v: (u, m) => pct(m.digitalFalhou, m.digitalTentada), metrica: true, dica: 'tentaram a digital e foram liberados por documento' },
    { t: 'Tentativas', v: (u, m) => n1(m.digitalTentada ? m.tentativasDigital / m.digitalTentada : null), metrica: true, celular: false, dica: 'tentativas de digital por eleitor' },
    { t: 'Saíram sem votar', v: (u, m) => br(m.desistencias), metrica: true, celular: false },
    { t: 'Já tinham votado', v: (u, m) => br(m.ocorrencias?.['ALERTA|VOTA|O eleitor identificado já votou']?.vezes ?? 0), metrica: true, celular: false, dica: 'a urna recusou liberar de novo' },
    { t: 'Título inválido', v: (u, m) => br(m.titulosInvalidos), metrica: true, celular: false },
    { t: 'Justificativas', v: (u, m) => br(m.justificativas), metrica: true, celular: false }
  ],
  tempos: [
    { t: 'Na cabine', v: (u, m) => media(m.cabineSoma, m.cabineN), metrica: true, dica: 'média, de "habilitado" a "computado"' },
    { t: 'Atendimento', v: (u, m) => media(m.atendimentoSoma, m.atendimentoN), metrica: true, dica: 'média, do título digitado ao voto' },
    { t: 'Até 1 min', v: (u, m) => pct(m.atendimento?.['até 1 min'] || 0, m.atendimentoN), metrica: true, celular: false, dica: 'atendimentos que levaram até 1 minuto' },
    { t: 'Abriu 8h00–8h05', v: u => pct(u.abertura?.['8h00–8h05'] || 0, u.urnas), celular: false },
    { t: 'Fechou até 17h15', v: u => pct((u.encerramento?.['antes das 17h'] || 0) + (u.encerramento?.['17h00–17h15'] || 0), u.urnas), celular: false },
    { t: 'Votos após 17h', v: u => br(u.depoisDas17h) },
    { t: 'Eleitor parado', v: (u, m) => br(m.eleitorParado), metrica: true, celular: false, dica: 'urna perguntou ao mesário se o eleitor continuava votando' }
  ],
  equipamento: [
    { t: 'Trocadas', v: u => br(u.trocas) },
    { t: 'Religadas', v: (u, m) => br(m.religamentos), metrica: true, dica: 'vezes que a urna foi religada no dia, além da primeira' },
    { t: 'Suspensões', v: (u, m) => br(m.suspensoes), metrica: true, celular: false },
    { t: 'Na bateria', v: (u, m) => br(m.usouBateria), metrica: true, celular: false, dica: 'urnas que passaram a usar a bateria interna' },
    { t: 'Erros', v: u => br(u.erros), celular: false },
    { t: 'Alertas', v: u => br(u.alertas), celular: false },
    { t: 'Assinaturas', v: (u, m) => (m.assinaturasFalha ? `<span class="selo selo-atencao">${br(m.assinaturasFalha)} sem sucesso</span>` : `<span class="selo selo-ok">${br(m.assinaturasOk)} ok</span>`), metrica: true, texto: true },
    { t: 'Sem zerésima', v: (u, m) => br(m.semZeresima), metrica: true, celular: false, dica: 'urnas sem a impressão da zerésima no dia (urnas de troca não imprimem)' }
  ],
  conferencias: [
    { t: 'Sem habilitação', v: u => br(u.semHabilitacao), dica: 'votos sem "Eleitor foi habilitado" antes' },
    { t: 'Fora do horário', v: u => br(u.foraDaJanela) },
    { t: 'Rajadas < 15 s', v: u => br(u.menorIntervalo?.['menos de 15 s'] || 0), dica: 'urnas com dois votos a menos de 15 s' },
    { t: 'Log ≠ boletim', v: u => br((u.pontos?.['bu-comparecimento'] || 0)), dica: 'urnas com votos no log diferentes do boletim' },
    { t: 'Biometria ≠ boletim', v: u => br((u.pontos?.['bu-biometria'] || 0)), celular: false },
    { t: 'Não lidas', v: u => br(u.naoLidas), celular: false },
    { t: 'Situação', texto: true, v: u => (u.urnasComPonto ? `<span class="selo selo-atencao">${br(u.urnasComPonto)} para olhar</span>` : '<span class="selo selo-ok">confere</span>') }
  ]
};

function kpi(rotulo, valor, nota) {
  return `<div class="glass-panel kpi"><span class="kpi-rotulo">${esc(rotulo)}</span><span class="kpi-valor">${valor}</span><span class="kpi-nota">${esc(nota)}</span></div>`;
}

function barras(porHora) {
  const horas = Object.keys(porHora).sort();
  if (!horas.length) return '<p class="nota">Sem votos.</p>';
  const max = Math.max(...Object.values(porHora));
  const mi = n => (n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n));
  return `<div class="barras" role="img" aria-label="Votos por hora">${horas.map(h => {
    const n = porHora[h];
    return `<div class="barra"><div class="barra-coluna ${+h >= 17 ? 'tarde' : ''}" style="height:${Math.max((n / max) * 100, 0.5)}%" data-valor="${mi(n)}" title="${h}h: ${br(n)} votos"></div><span class="barra-rotulo">${h}h</span></div>`;
  }).join('')}</div>`;
}

function faixas(titulo, mapa = {}, ordem) {
  const total = Object.values(mapa).reduce((s, n) => s + n, 0);
  if (!total) return '';
  const chaves = [...ordem.filter(k => mapa[k]), ...Object.keys(mapa).filter(k => !ordem.includes(k)).sort((a, b) => mapa[b] - mapa[a])];
  return `<div class="faixas"><strong>${esc(titulo)}</strong>${chaves.map(k => `
    <div class="faixa"><span>${esc(k)}</span><span class="num">${br(mapa[k])} <small>(${pct(mapa[k], total)})</small></span>
    <div class="boletim-barra"><span style="width:${(mapa[k] / total) * 100}%"></span></div></div>`).join('')}</div>`;
}

function linha(r) {
  const [uf, mun, zona, secao] = r.chave.split('-');
  const tz = uf === 'ZZ' ? null : localDaUrna(uf, mun);
  const situacao = r.erro ? '<span class="selo selo-atencao">não lida</span>'
    : r.atencao.length ? r.atencao.map(a => `<span class="selo selo-atencao">${esc(PONTOS[a] || a)}</span>`).join(' ')
      : `<span class="selo selo-ok">confere</span>${r.contingencia ? ' <span class="selo selo-info">troca de urna</span>' : ''}`;
  return `<tr data-chave="${esc(r.chave)}" tabindex="0">
    <td class="font-mono">${esc(uf)} ${esc(mun)} · Z${esc(semZeros(zona))} · S${esc(semZeros(secao))}</td>
    <td class="num">${br(r.votos)}</td><td class="num">${br(r.comparecimento)}</td>
    <td class="font-mono ocultar-celular">${esc(horaDeBrasilia(r.abertura, tz) ?? '—')}</td>
    <td class="font-mono ocultar-celular">${esc(horaDeBrasilia(r.encerramento, tz) ?? '—')}</td>
    <td class="num ocultar-celular">${duracao(r.menorIntervalo)}</td>
    <td>${situacao}</td></tr>`;
}

/**
 * Explica a diferença entre votos no log e comparecimento nos boletins:
 * votos confirmados no instante em que a urna desligou + urnas trocadas cujo log da urna que falhou não foi publicado.
 */
function notaDiferenca(diferenca, interrompidos, destaque) {
  if (diferenca === 0) return 'nenhum voto a mais ou a menos';
  const lacunas = destaque.filter(r => r.contingencia && r.atencao.includes('bu-comparecimento') && r.comparecimento > r.votos);
  const semLog = lacunas.reduce((s, r) => s + r.comparecimento - r.votos - (r.interrompidos || 0), 0);
  if (-diferenca !== interrompidos + semLog) return 'veja as urnas na lista abaixo';
  const partes = [];
  if (interrompidos) partes.push(`${br(interrompidos)} confirmado(s) quando a urna desligou`);
  if (semLog) partes.push(`${br(semLog)} em ${br(lacunas.length)} urna(s) trocada(s) sem o log da urna que falhou`);
  return `todos estão no boletim: ${partes.join('; ')}`;
}

/** Fecha a conta com o comparecimento oficial do TSE: boletins conferidos + seções sem arquivo de urna */
function contaOficial(b, semUrna, ufs) {
  const soma = b.comparecimento + semUrna.cedula.comparecimento + semUrna.semLog.comparecimento;
  const fecha = soma === semUrna.comparecimentoOficial;
  const linha = x => `${esc(tituloCurto(x.nomeMunicipio))} (${esc(x.uf === 'ZZ' ? 'exterior' : x.uf)}) · zona ${x.zona} · seção ${x.secao}: ${br(x.comparecimento)}`;
  return `<section class="secao">
    <h3 class="secao-titulo">${icone('checkCircle')}A conta com o total oficial do TSE</h3>
    <div class="glass-panel cartao">
      <div class="tabela-wrap"><table class="tabela-urnas">
        <tbody>
          <tr><td>Comparecimento nos boletins das ${br(b.urnas)} urnas conferidas</td><td class="num">${br(b.comparecimento)}</td></tr>
          <tr><td>${br(semUrna.cedula.secoes)} seções no exterior que votaram em <strong>cédula de papel</strong> (apuradas pelo Sistema de Apuração, sem urna eletrônica)</td><td class="num">${br(semUrna.cedula.comparecimento)}</td></tr>
          <tr><td>${br(semUrna.semLog.secoes)} seção(ões) com boletim, mas <strong>sem o log publicado</strong> pelo TSE</td><td class="num">${br(semUrna.semLog.comparecimento)}</td></tr>
        </tbody>
        <tfoot><tr><td>Total · comparecimento oficial do TSE: ${br(semUrna.comparecimentoOficial)}</td><td class="num">${br(soma)} ${fecha ? '<span class="selo selo-ok">fecha</span>' : '<span class="selo selo-atencao">não fecha</span>'}</td></tr></tfoot>
      </table></div>
      ${semUrna.semLog.lista.length ? `<p class="nota">Sem log publicado: ${semUrna.semLog.lista.map(linha).join('; ')}.</p>` : ''}
      <details><summary class="nota">Ver as ${br(semUrna.cedula.secoes)} seções do exterior com votação em cédula</summary><p class="nota">${semUrna.cedula.lista.map(linha).join('; ')}.</p></details>
    </div>
  </section>`;
}

const tituloCurto = s => String(s || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
