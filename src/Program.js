/**
 * Ponto de entrada: monta o shell comum, o serviço de auditoria e as telas.
 * Endereço compartilhável de uma seção do TSE: #secao=<pleito>/<UF>/<município>/<zona>/<seção>
 */
import { StkGovShell, renderStkIcons } from '../vendor/stk-gov/stk-gov-shell.js?v=20261029-1725';
import { StkGovPwa } from '../vendor/stk-gov/stk-gov-pwa.js?v=20261029-1725';
import { AuditoriaService } from './application/AuditoriaService.js?v=20261029-1725';
import { TseResultadosGateway, PLEITOS } from './infrastructure/TseResultadosGateway.js?v=20261029-1725';
import { ICONES } from './ui/Icones.js?v=20261029-1725';
import { UrnaView } from './ui/UrnaView.js?v=20261029-1725';
import { EventosView } from './ui/EventosView.js?v=20261029-1725';
import { PacoteView } from './ui/PacoteView.js?v=20261029-1725';
import { PanoramaView } from './ui/PanoramaView.js?v=20261029-1725';
import { renderComoLer } from './ui/ComoLerView.js?v=20261029-1725';
import { LocaisView } from './ui/LocaisView.js?v=20261029-1725';
import { SeletorSecao } from './ui/SeletorSecao.js?v=20261029-1725';
import { LocaisGateway } from './infrastructure/LocaisGateway.js?v=20261029-1725';
import { PainelGateway, PAINEL_URL } from './infrastructure/PainelGateway.js?v=20261029-1725';
import { relatorioUrna, relatorioLocais, relatorioPanorama, imprimir } from './ui/Relatorios.js?v=20261029-1725';
import { gerarXlsx, baixarArquivo } from './infrastructure/XlsxWriter.js?v=20261029-1725';
import { esc, nomeDaSecao, semZeros } from './ui/Formato.js?v=20261029-1725';

const $ = id => document.getElementById(id);

/** Seções que outro app pode abrir pelo endereço #aba=<nome> (ex.: o menu do Painel Eleições 2026) */
const ABAS = { panorama: 'tabPanorama', abrir: 'tabAbrir', urna: 'tabUrna', eventos: 'tabEventos', uf: 'tabPacote', locais: 'tabLocais', guia: 'tabComoLer' };

const EXEMPLOS = {
  rr: { pasta: 'exemplos/rr', arquivos: ['o03221rr0300000040011-log.jez', 'o03221rr0300000040011-bu.dat', 'o03221rr0300000040011-imgbu.dat', 'o03221rr0300000040011-rdv.dat'], nome: 'CAROEBE' },
  mg: { pasta: 'exemplos/mg', arquivos: ['o03221mg4188203200185-log.jez', 'o03221mg4188203200185-bu.dat', 'o03221mg4188203200185-rdv.dat'], nome: 'CHAPADA GAÚCHA' }
};

class App {
  constructor() {
    this.servico = new AuditoriaService();
    this.tse = new TseResultadosGateway();
    this.atual = null;
    this.analise = null;

    renderStkIcons(ICONES);
    this.shell = new StkGovShell({ app: 'urnas' });
    this.shell.iniciar();
    const pwa = new StkGovPwa('sw.js');
    pwa.init();
    pwa.ligarBotao($('btnInstallApp'));

    this.urnaView = new UrnaView($('urnaConteudo'), { aoTrocarDia: dia => this.abrirUrna(this.atual, dia, { trocarAba: false }) });
    this.eventosView = new EventosView();
    this.pacoteView = new PacoteView($('pacoteConteudo'), {
      aoAbrirUrna: chave => this.abrirUrna(chave),
      avisar: msg => this.avisar(msg)
    });
    renderComoLer($('comoLerConteudo'));
    this.panoramaView = new PanoramaView($('panoramaConteudo'), { aoAbrirSecao: s => this.abrirSecaoDoPanorama(s) });
    this.panoramaView.carregar();
    this.locais = new LocaisGateway();
    this.painel = new PainelGateway();
    $('linkPainel').href = PAINEL_URL;
    this.locaisView = new LocaisView($('locaisConteudo'), this.locais, {
      detalhar: s => this.servico.detalharSecao(this.tse, '3221', s),
      abrirUrna: chave => this.abrirUrna(chave, undefined, { aba: 'tabEventos' }),
      avisar: msg => this.avisar(msg),
      resultadoPainel: (uf, municipio, zona) => this.painel.resultado(uf, municipio, zona)
    });

    this._ligarFormularioTse();
    this._ligarArquivos();
    this._ligarAcoes();
    this._lerEndereco();
    // Link colado com a página já aberta
    window.addEventListener('hashchange', () => this._lerEndereco());
  }

  // ───────── Buscar no TSE (aba Abrir urna e aba Eventos) ─────────
  _ligarFormularioTse() {
    this.seletorAbrir = new SeletorSecao(
      { form: $('formTse'), pleito: $('selPleito'), uf: $('selUf'), municipio: $('selMunicipio'), zona: $('selZona'), secao: $('selSecao'), botao: $('btnBuscarTse'), status: $('statusTse') },
      this.tse, (pleito, secao) => this.buscarNoTse(pleito, secao, { seletor: this.seletorAbrir }));
    this.seletorEventos = new SeletorSecao(
      { form: $('formEventos'), pleito: $('evPleito'), uf: $('evUf'), municipio: $('evMunicipio'), zona: $('evZona'), secao: $('evSecao'), botao: $('evBuscar'), status: $('evStatus') },
      this.tse, (pleito, secao) => this.buscarNoTse(pleito, secao, { seletor: this.seletorEventos, aba: 'tabEventos', dia: pleito === '3220' ? '04/10/2026' : '25/10/2026' }));
  }

  /**
   * Baixa log e boletim de uma seção do TSE e abre a urna.
   * @param {{ seletor?: SeletorSecao, aba?: string, dia?: string }} [opcoes] onde mostrar o andamento e qual aba abrir
   */
  async buscarNoTse(pleito, secao, { seletor = this.seletorAbrir, aba = 'tabUrna', dia } = {}) {
    seletor.status(`Baixando log e boletim da seção ${semZeros(secao.secao)} do TSE…`);
    try {
      const r = await this.servico.abrirDoTse(this.tse, pleito, secao);
      const u = this.servico.urnas.get(r.chave);
      u.nomeMunicipio = secao.nomeMunicipio || u.nomeMunicipio;
      u.tse = { pleito, ...secao };
      seletor.status(`Pronto: log${r.temBoletim ? ' e boletim' : ''} baixados do TSE.`, 'ok');
      await this.abrirUrna(r.chave, dia, { aba });
    } catch (e) {
      seletor.status(`Não foi possível baixar: ${e.message}`, 'erro');
    }
  }

  /** Urna escolhida no Panorama: baixa do TSE com o nome do município (mesmo caminho do link #secao=) */
  async abrirSecaoDoPanorama({ pleito, uf, municipio, zona, secao }) {
    this.avisar(`Baixando do TSE o log da seção ${semZeros(secao)}…`);
    const nomeMunicipio = await this.tse.municipios(pleito, uf).then(l => l.find(m => m.codigo === municipio)?.nome).catch(() => null);
    await this.buscarNoTse(pleito, { uf, municipio, zona, secao, nomeMunicipio });
  }

  // ───────── Arquivos do computador e exemplos ─────────
  _ligarArquivos() {
    const zona = $('zonaSoltar');
    $('inputArquivos').addEventListener('change', e => { this.abrirArquivos([...e.target.files]); e.target.value = ''; });
    zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('arrastando'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
    zona.addEventListener('drop', e => {
      e.preventDefault();
      zona.classList.remove('arrastando');
      this.abrirArquivos([...e.dataTransfer.files]);
    });
    document.querySelectorAll('[data-exemplo]').forEach(b => b.addEventListener('click', () => this.abrirExemplo(b.dataset.exemplo)));
  }

  async abrirArquivos(arquivos) {
    if (!arquivos.length) return;
    this.status('statusArquivos', 'Lendo os arquivos…');
    try {
      const r = await this.servico.abrir(arquivos);
      const partes = [];
      if (r.urnas.length) partes.push(`${r.urnas.length} urna(s)`);
      if (r.pacotes.length) partes.push(`${r.pacotes.length} pacote(s) de UF`);
      if (r.ignorados.length) partes.push(`${r.ignorados.length} arquivo(s) não reconhecido(s): ${r.ignorados.join(', ')}`);
      this.status('statusArquivos', partes.join(' · ') || 'Nenhum arquivo reconhecido.', r.urnas.length || r.pacotes.length ? 'ok' : 'erro');
      this._atualizarAbertas();
      if (r.pacotes.length) {
        this.pacoteView.definirPacotes(this.servico.pacotes);
        this.shell.trocarAba('tabPacote');
      } else if (r.urnas.length) {
        await this.abrirUrna(r.urnas[0]);
      }
    } catch (e) {
      this.status('statusArquivos', `Não foi possível ler: ${e.message}`, 'erro');
    }
  }

  async abrirExemplo(qual) {
    const ex = EXEMPLOS[qual];
    this.status('statusArquivos', 'Carregando o exemplo…');
    try {
      const arquivos = await Promise.all(ex.arquivos.map(async nome => {
        const r = await fetch(`${ex.pasta}/${nome}`);
        if (!r.ok) throw new Error(`${nome}: ${r.status}`);
        return new File([await r.arrayBuffer()], nome);
      }));
      const r = await this.servico.abrir(arquivos);
      const u = this.servico.urnas.get(r.urnas[0]);
      u.nomeMunicipio = ex.nome;
      u.origem = 'exemplo com arquivos do TSE (2º turno de 2026)';
      this.status('statusArquivos', '');
      this._atualizarAbertas();
      await this.abrirUrna(r.urnas[0]);
    } catch (e) {
      this.status('statusArquivos', `Não foi possível abrir o exemplo: ${e.message}`, 'erro');
    }
  }

  _atualizarAbertas() {
    const urnas = this.servico.listar().filter(u => u.log);
    $('cartaoAbertas').hidden = urnas.length < 2 || urnas.length > 200;
    $('listaAbertas').innerHTML = urnas.slice(0, 200).map(u => `
      <li><button type="button" data-chave="${esc(u.chave)}" ${u.chave === this.atual ? 'aria-current="true"' : ''}>
        <span>${esc(nomeDaSecao(u))}</span><small>${u.imgbu || u.bu ? 'log e boletim' : 'só log'}</small>
      </button></li>`).join('');
    $('listaAbertas').querySelectorAll('[data-chave]').forEach(b => b.addEventListener('click', () => this.abrirUrna(b.dataset.chave)));
  }

  // ───────── Urna ─────────
  /** @param {{ trocarAba?: boolean, aba?: string }} [opcoes] */
  async abrirUrna(chave, dia, { trocarAba = true, aba = 'tabUrna' } = {}) {
    try {
      const r = await this.servico.analisar(chave, dia);
      r.local = await this._localDaUrna(r);
      const municipio = r.urna.municipio || r.analise.identificacao.municipio;
      r.painel = await this.painel.resultado(r.urna.uf || r.boletim?.uf, municipio, r.urna.zona || r.analise.identificacao.zona).catch(() => null);
      this.atual = chave;
      this.analise = r;
      $('urnaVazia').hidden = true;
      $('urnaConteudo').hidden = false;
      this.urnaView.render(r);
      this.eventosView.carregar(r);
      document.querySelector('[data-action="export-csv"]').disabled = false;
      this._atualizarAbertas();
      this._gravarEndereco(r.urna);
      if (r.urna.tse && this.seletorEventos.valor().secao !== r.urna.tse.secao) this.seletorEventos.posicionar(r.urna.tse.pleito, r.urna.tse).catch(() => {});
      if (trocarAba) this.shell.trocarAba(aba);
      window.scrollTo({ top: 0 });
    } catch (e) {
      this.avisar(`Não foi possível analisar a urna: ${e.message}`);
    }
  }

  /** Local de votação da urna (rua, número, bairro, CEP), pelo cadastro do TSE */
  async _localDaUrna(r) {
    const uf = r.urna.uf || r.boletim?.uf;
    const municipio = r.urna.municipio || r.analise.identificacao.municipio;
    const zona = r.urna.zona || r.analise.identificacao.zona;
    const secao = r.urna.secao || r.analise.identificacao.secao;
    if (!uf || !municipio || !zona || !secao) return null;
    return this.locais.daSecao(uf, municipio, zona, secao).catch(() => null);
  }

  // ───────── Endereço compartilhável ─────────
  _gravarEndereco(u) {
    const hash = u.tse ? `#secao=${u.tse.pleito}/${u.tse.uf}/${u.tse.municipio}/${u.tse.zona}/${u.tse.secao}` : '';
    if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
  }

  _lerEndereco() {
    // Vindo do menu do Painel 8.1: #aba=<seção> abre direto aquela seção deste app
    const aba = /^#aba=([a-z]+)$/.exec(location.hash);
    if (aba && ABAS[aba[1]]) {
      this.shell.trocarAba(ABAS[aba[1]]);
      return;
    }
    // Vindo do Painel 8.1: #locais=UF/município(TSE)[/zona] abre os locais e as urnas daquele município ou zona
    const l = /^#locais=([A-Z]{2})\/(\d{1,5})(?:\/(\d{1,4}))?$/i.exec(location.hash);
    if (l) {
      this.shell.trocarAba('tabLocais');
      this.locaisView.irPara(l[1].toUpperCase(), l[2].padStart(5, '0'), l[3]);
      return;
    }
    const m = /^#secao=(\d{4})\/([A-Z]{2})\/(\d{5})\/(\d{4})\/(\d{4})$/i.exec(location.hash);
    if (!m) return;
    const [, pleito, uf, municipio, zona, secao] = m;
    if (!PLEITOS.some(p => p.codigo === pleito)) return;
    this.shell.trocarAba('tabAbrir');
    this.tse.municipios(pleito, uf.toUpperCase())
      .then(lista => lista.find(x => x.codigo === municipio)?.nome)
      .catch(() => null)
      .then(nomeMunicipio => this.buscarNoTse(pleito, { uf: uf.toUpperCase(), municipio, zona, secao, nomeMunicipio }));
  }

  // ───────── Ações do topo ─────────
  _ligarAcoes() {
    document.addEventListener('click', e => {
      const ir = e.target.closest('[data-ir]');
      if (ir) this.shell.trocarAba(ir.dataset.ir);
      const zona = e.target.closest('[data-ver-zona]');
      if (zona) {
        const [uf, municipio, z] = zona.dataset.verZona.split('|');
        this.shell.trocarAba('tabLocais');
        this.locaisView.irPara(uf, municipio, z);
      }
      const acao = e.target.closest('[data-action]')?.dataset.action;
      if (!acao) return;
      if (acao === 'export-csv') this._baixarCsv();
      if (acao === 'relatorio-pdf' || acao === 'relatorio-xlsx') this._relatorio(acao === 'relatorio-pdf' ? 'pdf' : 'xlsx');
      if (acao === 'copy-link') this._copiarLink();
      if (acao === 'copy-report') this._copiar(this._resumo(), 'Resumo copiado.');
      if (acao === 'share-whatsapp') {
        const texto = this._resumo();
        if (texto) window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
      }
    });
  }

  /** Relatório do que está na tela: Panorama, Locais e zonas, ou a urna aberta (Resumo e Eventos) */
  _relatorio(formato) {
    const aba = this.shell.abaAtual;
    let rel = null;
    if (aba === 'tabPanorama' && this.panoramaView.dados) rel = relatorioPanorama(this.panoramaView.dados);
    else if (aba === 'tabLocais') {
      const e = this.locaisView.estadoParaRelatorio();
      if (e) rel = relatorioLocais(e);
    } else if (this.analise) rel = relatorioUrna(this.analise);
    if (!rel) {
      this.avisar(aba === 'tabLocais' ? 'Escolha um estado na aba Locais e zonas.' : 'Abra uma urna ou vá ao Panorama para gerar o relatório.');
      return;
    }
    if (formato === 'pdf') imprimir(rel);
    else {
      baixarArquivo(gerarXlsx(rel.abas), `${rel.arquivo}.xlsx`);
      this.avisar(`Planilha "${rel.arquivo}.xlsx" com ${rel.abas.length} aba(s) baixada.`);
    }
  }

  _baixarCsv() {
    if (!this.analise) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.eventosView.csv()], { type: 'text/csv;charset=utf-8' }));
    a.download = `log-${this.atual}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  _copiarLink() {
    if (!this.analise?.urna.tse) {
      this.avisar('O link fica disponível para seções buscadas no site do TSE (aba Abrir urna).');
      return;
    }
    this._copiar(location.href, 'Link copiado: quem abrir verá esta mesma seção, baixada do TSE.');
  }

  _resumo() {
    if (!this.analise) { this.avisar('Abra uma urna primeiro.'); return ''; }
    const r = this.analise;
    const linhas = [`Auditoria da urna — ${nomeDaSecao(r.urna, r.boletim)} — ${r.analise.dia}`];
    for (const v of r.verificacoes) linhas.push(`${v.status === 'ok' ? '[confere]' : v.status === 'atencao' ? '[olhar no log]' : '[info]'} ${v.titulo}: ${v.resultado}`);
    if (r.urna.tse) linhas.push(location.href);
    linhas.push('Arquivos públicos do TSE, conferidos no aparelho.');
    return linhas.join('\n');
  }

  async _copiar(texto, msg) {
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      this.avisar(msg);
    } catch {
      this.avisar('Não foi possível copiar automaticamente.');
    }
  }

  status(id, texto, tipo = '') {
    const el = $(id);
    el.textContent = texto;
    el.className = `status-linha ${tipo}`;
  }

  avisar(msg) {
    $('toastMessage').textContent = msg;
    const t = $('toastNotification');
    t.classList.add('show');
    clearTimeout(this._toast);
    this._toast = setTimeout(() => t.classList.remove('show'), 3500);
  }
}

try {
  new App();
} catch (e) {
  $('appFatalErrorDetail').textContent = `Erro ao iniciar: ${e.message}`;
  $('appFatalError').hidden = false;
  throw e;
}
