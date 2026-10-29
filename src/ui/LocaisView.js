/**
 * Aba "Locais e zonas": endereço de cada local de votação (rua, número, bairro, CEP, mapa) e o que tinha no log
 * de cada urna do local ou da zona inteira (baixado do TSE na hora, analisado no aparelho).
 */
import { icone } from './Icones.js?v=20261029-1725';
import { esc, br, duracao, titulo } from './Formato.js?v=20261029-1725';
import { horaDeBrasilia } from '../domain/LogUrna.js?v=20261029-1725';
import { linkDoMapa } from '../domain/Endereco.js?v=20261029-1725';
import { UFS } from '../infrastructure/TseResultadosGateway.js?v=20261029-1725';
import { resumoTurno } from '../infrastructure/PainelGateway.js?v=20261029-1725';

const PAGINA = 100;
const SIMULTANEOS = 4;
const LIMITE_LOTE = 800;

export class LocaisView {
  /**
   * @param {HTMLElement} raiz
   * @param {import('../infrastructure/LocaisGateway.js?v=20261029-1725').LocaisGateway} locais
   * @param {{ detalhar: (s: object) => Promise<object>, abrirUrna: (chave: string) => void, avisar: (m: string) => void, pleito: string }} acoes
   */
  constructor(raiz, locais, acoes) {
    this.raiz = raiz;
    this.gw = locais;
    this.acoes = acoes;
    this.uf = '';
    this.municipio = '';
    this.zona = '';
    this.busca = '';
    this.limite = PAGINA;
    this.dados = null;
    this.abertos = new Set();
    this.detalhes = new Map();
    this.lote = null;
    this._montar();
  }

  _montar() {
    this.raiz.innerHTML = `
      <div class="intro">
        <h2>Locais de votação e os logs das urnas</h2>
        <p>Endereço de cada local de votação do 2º turno (cadastro oficial do TSE), com rua, número, bairro e CEP. Escolha a zona e veja o que ficou registrado no log de cada urna: votos, horários, digital, alertas e erros, com o texto do log.</p>
      </div>
      <div class="glass-panel cartao">
        <div class="campos">
          <label class="campo">Estado<select id="locUf"><option value="">Escolha</option>${UFS.concat('ZZ').map(u => `<option value="${u}">${u === 'ZZ' ? 'Exterior' : u}</option>`).join('')}</select></label>
          <label class="campo">Município<select id="locMun" disabled><option value="">—</option></select></label>
          <label class="campo">Zona<select id="locZona" disabled><option value="">Todas</option></select></label>
          <label class="campo campo-largo">Buscar local, rua, bairro ou CEP<input type="search" id="locBusca" placeholder="ex.: escola, avenida brasil, centro, 69378-000" disabled></label>
        </div>
        <p class="status-linha" id="locStatus" role="status" aria-live="polite"></p>
      </div>
      <div id="locConteudo"></div>`;
    const $ = id => this.raiz.querySelector(`#${id}`);
    $('locUf').addEventListener('change', e => this._escolherUf(e.target.value));
    $('locMun').addEventListener('change', e => { this.municipio = e.target.value; this.zona = ''; this.limite = PAGINA; this._preencherZonas(); this.render(); });
    $('locZona').addEventListener('change', e => { this.zona = e.target.value; this.limite = PAGINA; this.render(); });
    let espera;
    $('locBusca').addEventListener('input', e => { clearTimeout(espera); espera = setTimeout(() => { this.busca = e.target.value.trim(); this.limite = PAGINA; this.render(); }, 200); });
    this.raiz.addEventListener('click', e => this._clique(e));
  }

  /** Abre a aba já num estado e município (ex.: vindo do resumo de uma urna) */
  async irPara(uf, municipio, zona) {
    const sel = this.raiz.querySelector('#locUf');
    sel.value = uf;
    await this._escolherUf(uf);
    if (municipio) { this.municipio = municipio; this.raiz.querySelector('#locMun').value = municipio; this._preencherZonas(); }
    if (zona) { this.zona = String(+zona); this.raiz.querySelector('#locZona').value = this.zona; }
    this.render();
  }

  async _escolherUf(uf) {
    this.uf = uf; this.municipio = ''; this.zona = ''; this.busca = ''; this.limite = PAGINA; this.abertos.clear();
    const $ = id => this.raiz.querySelector(`#${id}`);
    $('locBusca').value = '';
    if (!uf) { this.dados = null; this.render(); return; }
    $('locStatus').textContent = 'Carregando os locais de votação…';
    try {
      this.dados = await this.gw.carregar(uf);
      $('locStatus').textContent = '';
    } catch (e) {
      this.dados = null;
      $('locStatus').textContent = e.message;
    }
    const muns = new Map();
    for (const l of this.dados?.locais || []) muns.set(l.municipio, l.nomeMunicipio);
    $('locMun').innerHTML = `<option value="">Todos (${br(muns.size)})</option>${[...muns].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')).map(([c, n]) => `<option value="${esc(c)}">${esc(titulo(n))}</option>`).join('')}`;
    $('locMun').disabled = !this.dados;
    $('locBusca').disabled = !this.dados;
    this._preencherZonas();
    this.render();
  }

  _preencherZonas() {
    const sel = this.raiz.querySelector('#locZona');
    const zonas = [...new Set((this.dados?.locais || []).filter(l => !this.municipio || l.municipio === this.municipio).map(l => l.zona))].sort((a, b) => a - b);
    sel.innerHTML = `<option value="">Todas (${br(zonas.length)})</option>${zonas.map(z => `<option value="${esc(z)}">${esc(z)}</option>`).join('')}`;
    sel.disabled = !this.dados;
  }

  /** Dados do filtro atual para o relatório (PDF/Excel) */
  estadoParaRelatorio() {
    return this.dados ? { uf: this.uf, municipio: this.municipio, zona: this.zona, lista: this._filtrados(), detalhes: this.detalhes } : null;
  }

  _filtrados() {
    const q = this.busca.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return (this.dados?.locais || []).filter(l =>
      (!this.municipio || l.municipio === this.municipio) &&
      (!this.zona || l.zona === +this.zona) &&
      (!q || norm(`${l.nome} ${l.rua} ${l.numero} ${l.bairro} ${l.cep} ${l.complemento} ${l.nomeMunicipio}`).includes(q)));
  }

  _secao(l, s) {
    return { uf: this.uf, municipio: l.municipio, zona: String(l.zona).padStart(4, '0'), secao: String(s).padStart(4, '0'), nomeMunicipio: l.nomeMunicipio };
  }

  async _clique(e) {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo) return;
    const a = alvo.dataset.acao;
    const lista = this._filtrados();
    if (a === 'mais') { this.limite += PAGINA; this.render(); }
    else if (a === 'csv-locais') this._baixarCsvLocais(lista);
    else if (a === 'csv-logs') this._baixarCsvLogs(lista);
    else if (a === 'abrir-log') this.acoes.abrirUrna(alvo.dataset.chave);
    else if (a === 'parar') { if (this.lote) this.lote.parar = true; }
    else if (a === 'logs-local') {
      const l = lista.find(x => `${x.municipio}-${x.zona}-${x.local}` === alvo.dataset.local);
      if (!l) return;
      const chave = alvo.dataset.local;
      if (this.abertos.has(chave)) { this.abertos.delete(chave); this.render(); return; }
      this.abertos.add(chave);
      this.render();
      await this._detalharLote(l.secoes.map(s => this._secao(l, s)));
    } else if (a === 'logs-todos') {
      const secoes = lista.flatMap(l => l.secoes.map(s => this._secao(l, s)));
      if (secoes.length > LIMITE_LOTE) { this.acoes.avisar(`São ${br(secoes.length)} urnas: escolha uma zona (até ${br(LIMITE_LOTE)} urnas por vez).`); return; }
      for (const l of lista) this.abertos.add(`${l.municipio}-${l.zona}-${l.local}`);
      this.render();
      await this._detalharLote(secoes);
    }
  }

  /** Baixa e analisa várias seções, 4 de cada vez, redesenhando aos poucos */
  async _detalharLote(secoes) {
    const faltam = secoes.filter(s => !this.detalhes.has(`${s.uf}-${s.municipio}-${s.zona}-${s.secao}`));
    if (!faltam.length) return;
    const lote = this.lote = { total: faltam.length, feitas: 0, parar: false };
    let i = 0;
    const trabalhador = async () => {
      while (i < faltam.length && !lote.parar) {
        const s = faltam[i++];
        const chave = `${s.uf}-${s.municipio}-${s.zona}-${s.secao}`;
        try { this.detalhes.set(chave, await this.acoes.detalhar(s)); }
        catch (e) { this.detalhes.set(chave, { chave, erro: e.message }); }
        lote.feitas++;
        this._agendar();
      }
    };
    await Promise.all(Array.from({ length: SIMULTANEOS }, trabalhador));
    this.lote = null;
    this.render();
  }

  _agendar() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.render(); }, 400);
  }

  render() {
    const alvo = this.raiz.querySelector('#locConteudo');
    if (!this.dados) { alvo.innerHTML = this.uf ? '' : `<div class="vazio">${icone('globe')}<p>Escolha um estado para ver os locais de votação.</p></div>`; return; }
    const lista = this._filtrados();
    const visiveis = lista.slice(0, this.limite);
    const secoes = lista.reduce((s, l) => s + l.secoes.length, 0);
    const eleitores = lista.reduce((s, l) => s + l.eleitores, 0);
    const conferidas = lista.flatMap(l => l.secoes.map(s => this.detalhes.get(`${this.uf}-${l.municipio}-${String(l.zona).padStart(4, '0')}-${String(s).padStart(4, '0')}`))).filter(Boolean);
    const scrollY = window.scrollY;
    this._buscarPainel();

    alvo.innerHTML = `
      <div class="grade-kpi">
        ${kpi('Locais de votação', br(lista.length), this.zona ? `zona ${this.zona}` : this.municipio ? 'no município' : `em ${this.uf === 'ZZ' ? 'outros países' : this.uf}`)}
        ${kpi('Seções (urnas)', br(secoes), 'uma urna por seção')}
        ${kpi('Eleitores aptos', br(eleitores), 'no cadastro do TSE')}
        ${kpi('Com acessibilidade', br(lista.filter(l => l.acessivel).length), 'locais com seção acessível')}
      </div>

      <div class="glass-panel cartao">
        <div class="cabecalho-tabela">
          <h3 class="cartao-titulo">${icone('vote')}Logs das urnas ${this.zona ? `da zona ${this.zona}` : 'deste filtro'}</h3>
          <div class="acoes-linha">
            ${this.lote ? `<button type="button" class="botao botao-secundario" data-acao="parar">${icone('stop')}Parar</button>`
              : `<button type="button" class="botao botao-primario" data-acao="logs-todos" ${secoes > LIMITE_LOTE ? 'disabled' : ''}>${icone('download')}Conferir os logs das ${br(secoes)} urnas</button>`}
            <button type="button" class="botao botao-secundario" data-acao="csv-locais">${icone('fileCsv')}Endereços (CSV)</button>
            <button type="button" class="botao botao-secundario" data-acao="csv-logs" ${conferidas.length ? '' : 'disabled'}>${icone('fileCsv')}Logs (CSV)</button>
          </div>
        </div>
        ${secoes > LIMITE_LOTE ? `<p class="nota">Para conferir os logs de todas as urnas de uma vez, escolha uma zona (até ${br(LIMITE_LOTE)} urnas). Ou toque em "Ver os logs" num local.</p>` : ''}
        ${this.lote ? `<div class="progresso"><span style="width:${(this.lote.feitas / this.lote.total) * 100}%"></span></div><p class="status-linha">Baixando do TSE e conferindo: ${br(this.lote.feitas)} de ${br(this.lote.total)} urnas…</p>` : ''}
        ${conferidas.length ? resumoDoLote(conferidas) : '<p class="nota">Os logs são baixados do site de resultados do TSE e analisados no seu aparelho.</p>'}
      </div>

      ${this._painelHtml()}

      <div class="lista-locais">
        ${visiveis.map(l => this._local(l)).join('')}
      </div>
      ${!lista.length ? '<p class="nota">Nenhum local com esse filtro.</p>' : ''}
      ${lista.length > visiveis.length ? `<div class="paginacao"><button type="button" class="botao botao-secundario" data-acao="mais">Mostrar mais locais (${br(lista.length - visiveis.length)} restantes)</button></div>` : ''}
    `;
    if (this.lote) window.scrollTo({ top: scrollY });
  }

  /** Resultado do município/zona no Painel 2026 (projeto 8.1), quando há município escolhido */
  _buscarPainel() {
    const chave = this.municipio ? `${this.uf}-${this.municipio}-${this.zona}` : '';
    if (!chave || !this.acoes.resultadoPainel || this._painelChave === chave) return;
    this._painelChave = chave;
    this.painel = null;
    this.acoes.resultadoPainel(this.uf, this.municipio, this.zona).then(p => {
      if (this._painelChave !== chave) return;
      this.painel = p;
      const alvo = this.raiz.querySelector('#painelLocais');
      if (alvo) alvo.outerHTML = this._painelHtml();
    }).catch(() => {});
  }

  _painelHtml() {
    const p = this.municipio && this.painel;
    if (!p) return '<div id="painelLocais" hidden></div>';
    const pct = v => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
    const t = (r, rot) => (r ? `<span>${rot}: <strong>Lula ${pct(r.lula)}</strong> × <strong>Flávio ${pct(r.flavio)}</strong> · comparecimento ${pct(r.comparecimento)}</span>` : '');
    const z = p.zona;
    return `<div class="glass-panel cartao" id="painelLocais">
      <div class="cabecalho-tabela">
        <h3 class="cartao-titulo">${icone('chartBar')}${esc(titulo(p.nome))} no Painel Eleições 2026</h3>
        <a class="botao botao-secundario" href="${esc(p.link)}">${icone('globe')}Abrir no painel</a>
      </div>
      <div class="linhas-painel">
        ${t(resumoTurno(p.t2), 'Município · 2º turno')}${t(resumoTurno(p.t1), 'Município · 1º turno')}
        ${z ? `${t(resumoTurno(z.t2), `Zona ${z.numero} · 2º turno`)}${t(resumoTurno(z.t1), `Zona ${z.numero} · 1º turno`)}` : ''}
      </div>
      <p class="nota">Percentuais dos votos válidos, do resultado oficial do TSE processado pelo Painel Eleições 2026.</p>
    </div>`;
  }

  _local(l) {
    const chave = `${l.municipio}-${l.zona}-${l.local}`;
    const aberto = this.abertos.has(chave);
    return `
      <article class="glass-panel local ${aberto ? 'aberto' : ''}">
        <div class="local-cabecalho">
          <div class="min-w-0">
            <h3>${esc(titulo(l.nome))}</h3>
            <p class="nota">${esc(titulo(l.nomeMunicipio))} · Zona ${l.zona} · Local ${l.local}${l.acessivel ? ' · <span class="selo selo-ok">acessível</span>' : ''}${l.tipo && l.tipo !== 'Convencional' ? ` · <span class="selo selo-info">${esc(l.tipo)}</span>` : ''}</p>
          </div>
          <div class="acoes-linha">
            <a class="botao botao-secundario" href="${esc(linkDoMapa({ ...l, municipio: l.nomeMunicipio }))}" target="_blank" rel="noopener noreferrer">${icone('globe')}Mapa</a>
            <button type="button" class="botao ${aberto ? 'botao-secundario' : 'botao-primario'}" data-acao="logs-local" data-local="${chave}">${icone('list')}${aberto ? 'Fechar logs' : `Ver os logs (${l.secoes.length})`}</button>
          </div>
        </div>
        <dl class="endereco">
          <div><dt>Rua</dt><dd>${esc(l.rua || '—')}</dd></div>
          <div><dt>Número</dt><dd>${esc(l.numero || 'não informado')}</dd></div>
          <div><dt>Bairro</dt><dd>${esc(l.bairro || '—')}</dd></div>
          <div><dt>CEP</dt><dd class="font-mono">${esc(l.cep || '—')}</dd></div>
          ${l.complemento ? `<div class="largo"><dt>Complemento</dt><dd>${esc(l.complemento)}</dd></div>` : ''}
          <div class="largo"><dt>Seções</dt><dd class="font-mono">${l.secoes.join(', ')} <span class="nota">· ${br(l.eleitores)} eleitores</span></dd></div>
        </dl>
        <p class="nota endereco-tse">Endereço no cadastro do TSE: ${esc(l.enderecoTse)}</p>
        ${aberto ? this._logsDoLocal(l) : ''}
      </article>`;
  }

  _logsDoLocal(l) {
    const itens = l.secoes.map(s => {
      const chave = `${this.uf}-${l.municipio}-${String(l.zona).padStart(4, '0')}-${String(s).padStart(4, '0')}`;
      return { s, d: this.detalhes.get(chave), chave };
    });
    return `<div class="logs-local">${itens.map(({ s, d, chave }) => {
      if (!d) return `<div class="secao-log carregando"><strong>Seção ${s}</strong><span class="nota">baixando o log do TSE…</span></div>`;
      if (d.erro) return `<div class="secao-log"><strong>Seção ${s}</strong><span class="selo selo-atencao">não foi possível ler: ${esc(d.erro)}</span></div>`;
      const h = x => (x ? horaDeBrasilia(x, d.uf) : '—');
      const atencao = d.verificacoes.filter(v => v.status === 'atencao');
      return `
      <div class="secao-log">
        <div class="secao-log-cabecalho">
          <strong>Seção ${s}</strong>
          <span class="nota">urna ${esc(d.urnas.join(' → '))}${d.modelo ? ` · ${esc(d.modelo)}` : ''}</span>
          ${atencao.length ? atencao.map(v => `<span class="selo selo-atencao">${esc(v.titulo)}</span>`).join('') : '<span class="selo selo-ok">log confere com o boletim</span>'}
          ${d.contingencia ? '<span class="selo selo-info">troca de urna</span>' : ''}
          <button type="button" class="botao botao-secundario botao-pequeno" data-acao="abrir-log" data-chave="${esc(chave)}">${icone('list')}Log completo</button>
        </div>
        <dl class="numeros-log">
          <div><dt>Votos no log</dt><dd>${br(d.votos)}</dd></div>
          <div><dt>Boletim</dt><dd>${br(d.comparecimento)} <small>de ${br(d.aptos)} aptos</small></dd></div>
          <div><dt>Abertura</dt><dd>${esc(h(d.abertura))}</dd></div>
          <div><dt>Encerramento</dt><dd>${esc(h(d.encerramento))}</dd></div>
          <div><dt>Na cabine (média)</dt><dd>${duracao(d.cabineMedia)}</dd></div>
          <div><dt>Menor intervalo</dt><dd>${duracao(d.menorIntervalo)}</dd></div>
          <div><dt>Pela digital</dt><dd>${br(d.liberadosDigital)} <small>${d.votos ? `(${Math.round(d.liberadosDigital / d.votos * 100)}%)` : ''}</small></dd></div>
          <div><dt>Digital falhou</dt><dd>${br(d.digitalFalhou)}</dd></div>
          <div><dt>Já tinha votado</dt><dd>${br(d.jaVotou)}</dd></div>
          <div><dt>Saíram sem votar</dt><dd>${br(d.desistencias)}</dd></div>
          <div><dt>Religada</dt><dd>${br(d.religamentos)}×</dd></div>
          <div><dt>Alertas / erros</dt><dd>${br(d.alertas)} / ${br(d.erros)}</dd></div>
        </dl>
        <details>
          <summary>O que tinha no log: ${d.ocorrencias.length} tipo(s) de alerta ou erro e ${d.marcos.length} marcos do dia</summary>
          <div class="grade-2 detalhe-log">
            <div>
              <h4>Alertas e erros (texto do log)</h4>
              ${d.ocorrencias.length ? `<ul class="ocorrencias">${d.ocorrencias.map(o => `<li><span class="selo ${o.nivel === 'ERRO' ? 'selo-atencao' : 'selo-info'}">${o.nivel}</span> ${esc(o.msg)} <span class="nota">· ${o.vezes}× · primeira às ${esc(h(o.primeira))}</span></li>`).join('')}</ul>` : '<p class="nota">Nenhum.</p>'}
              ${d.verificacoes.filter(v => v.status === 'info' && v.id !== 'alertas').map(v => `<p class="nota"><strong>${esc(v.titulo)}:</strong> ${esc(v.resultado)}</p>`).join('')}
            </div>
            <div>
              <h4>Linha do tempo</h4>
              <ol class="linha-tempo">${compactar(d.marcos).map(m => `<li><span class="hora">${esc(h(m.hora))}</span><span class="ponto"></span><span>${esc(m.titulo)}${m.vezes > 1 ? ` <small>(${m.vezes}×)</small>` : ''}${m.anterior ? ' <small>· urna anterior</small>' : ''}</span></li>`).join('')}</ol>
            </div>
          </div>
        </details>
      </div>`;
    }).join('')}</div>`;
  }

  _baixarCsvLocais(lista) {
    const cab = ['UF', 'Município', 'Zona', 'Nº do local', 'Local de votação', 'Rua', 'Número', 'Complemento', 'Bairro', 'CEP', 'Latitude', 'Longitude', 'Seções', 'Eleitores', 'Acessibilidade', 'Endereço no cadastro do TSE'];
    baixar(`locais-${this.uf}${this.municipio ? `-${this.municipio}` : ''}${this.zona ? `-zona${this.zona}` : ''}.csv`, [cab, ...lista.map(l =>
      [this.uf, titulo(l.nomeMunicipio), l.zona, l.local, l.nome, l.rua, l.numero, l.complemento, l.bairro, l.cep, l.lat ?? '', l.lon ?? '', l.secoes.join(' '), l.eleitores, l.acessivel ? 'sim' : 'não', l.enderecoTse])]);
  }

  _baixarCsvLogs(lista) {
    const cab = ['UF', 'Município', 'Zona', 'Seção', 'Local de votação', 'Rua', 'Número', 'Bairro', 'CEP', 'Urna(s)', 'Votos no log', 'Comparecimento no boletim', 'Aptos', 'Abertura (Brasília)', 'Encerramento (Brasília)', 'Na cabine (média, s)', 'Menor intervalo (s)', 'Pela digital', 'Digital falhou', 'Já tinha votado', 'Saíram sem votar', 'Religamentos', 'Troca de urna', 'Alertas', 'Erros', 'Pontos para olhar', 'Alertas e erros (texto do log)'];
    const linhas = [cab];
    for (const l of lista) for (const s of l.secoes) {
      const d = this.detalhes.get(`${this.uf}-${l.municipio}-${String(l.zona).padStart(4, '0')}-${String(s).padStart(4, '0')}`);
      if (!d || d.erro) continue;
      linhas.push([this.uf, titulo(l.nomeMunicipio), l.zona, s, l.nome, l.rua, l.numero, l.bairro, l.cep, d.urnas.join(' '), d.votos, d.comparecimento, d.aptos,
        horaDeBrasilia(d.abertura, d.uf), horaDeBrasilia(d.encerramento, d.uf), d.cabineMedia, d.menorIntervalo, d.liberadosDigital, d.digitalFalhou, d.jaVotou, d.desistencias,
        d.religamentos, d.contingencia ? 'sim' : 'não', d.alertas, d.erros, d.verificacoes.filter(v => v.status === 'atencao').map(v => v.titulo).join(' / '),
        d.ocorrencias.map(o => `${o.nivel}: ${o.msg} (${o.vezes}x)`).join(' | ')]);
    }
    baixar(`logs-${this.uf}${this.municipio ? `-${this.municipio}` : ''}${this.zona ? `-zona${this.zona}` : ''}.csv`, linhas);
  }
}

function kpi(rotulo, valor, nota) {
  return `<div class="glass-panel kpi"><span class="kpi-rotulo">${esc(rotulo)}</span><span class="kpi-valor">${valor}</span><span class="kpi-nota">${esc(nota)}</span></div>`;
}

/** Totais das urnas já conferidas do filtro + alertas e erros mais frequentes */
function resumoDoLote(ds) {
  const ok = ds.filter(d => !d.erro);
  const soma = c => ok.reduce((s, d) => s + (d[c] || 0), 0);
  const comPonto = ok.filter(d => d.verificacoes.some(v => v.status === 'atencao'));
  const oc = new Map();
  for (const d of ok) for (const o of d.ocorrencias) {
    const k = `${o.nivel}|${o.msg}`;
    const x = oc.get(k) || { ...o, vezes: 0, urnas: 0 };
    x.vezes += o.vezes; x.urnas++;
    oc.set(k, x);
  }
  const top = [...oc.values()].sort((a, b) => b.vezes - a.vezes).slice(0, 12);
  return `
    <div class="grade-kpi">
      ${kpi('Urnas conferidas', `${br(ok.length)}`, ds.length > ok.length ? `${br(ds.length - ok.length)} não lidas` : 'todas lidas')}
      ${kpi('Votos no log × boletim', `${br(soma('votos'))}`, `boletins: ${br(soma('comparecimento'))}`)}
      ${kpi('Urnas com ponto para olhar', br(comPonto.length), comPonto.length ? comPonto.map(d => `seção ${+d.chave.split('-')[3]}`).join(', ') : 'em todas, o log confere')}
      ${kpi('Trocas e religamentos', `${br(ok.filter(d => d.contingencia).length)} / ${br(soma('religamentos'))}`, 'urnas trocadas / vezes religadas')}
    </div>
    ${top.length ? `<div class="tabela-wrap"><table class="tabela-urnas">
      <thead><tr><th>Nível</th><th>Alerta ou erro (texto do log)</th><th class="num">Vezes</th><th class="num">Urnas</th></tr></thead>
      <tbody>${top.map(o => `<tr><td><span class="selo ${o.nivel === 'ERRO' ? 'selo-atencao' : 'selo-info'}">${o.nivel}</span></td><td>${esc(o.msg)}</td><td class="num">${br(o.vezes)}</td><td class="num">${br(o.urnas)}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}`;
}

function compactar(marcos) {
  const out = [];
  for (const m of marcos) {
    const u = out.at(-1);
    if (u && u.titulo === m.titulo && u.anterior === m.anterior) { u.vezes++; continue; }
    out.push({ ...m, vezes: 1 });
  }
  return out;
}

function baixar(nome, linhas) {
  const csv = linhas.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
