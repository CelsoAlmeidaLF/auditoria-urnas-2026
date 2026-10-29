/**
 * Seletores encadeados turno → estado → município → zona → seção, com a lista oficial de seções do TSE.
 * Usado na aba Abrir urna e na aba Eventos.
 */
import { esc, semZeros, titulo } from './Formato.js?v=20261029-1725';
import { PLEITOS, UFS } from '../infrastructure/TseResultadosGateway.js?v=20261029-1725';

export class SeletorSecao {
  /**
   * @param {{ pleito: HTMLSelectElement, uf: HTMLSelectElement, municipio: HTMLSelectElement, zona: HTMLSelectElement, secao: HTMLSelectElement, botao: HTMLButtonElement, status: HTMLElement, form: HTMLFormElement }} el
   * @param {import('../infrastructure/TseResultadosGateway.js?v=20261029-1725').TseResultadosGateway} tse
   * @param {(pleito: string, secao: {uf: string, municipio: string, zona: string, secao: string, nomeMunicipio: string}) => Promise<void>} aoEscolher
   */
  constructor(el, tse, aoEscolher) {
    this.el = el;
    this.tse = tse;
    this.municipios = [];
    el.pleito.innerHTML = PLEITOS.map(p => `<option value="${p.codigo}">${esc(p.nome)}</option>`).join('');
    el.uf.innerHTML = `<option value="">Escolha</option>${UFS.map(u => `<option value="${u}">${u}</option>`).join('')}<option value="ZZ">Exterior</option>`;
    el.pleito.addEventListener('change', () => this._carregarMunicipios());
    el.uf.addEventListener('change', () => this._carregarMunicipios());
    el.municipio.addEventListener('change', () => this._preencherZonas());
    el.zona.addEventListener('change', () => this._preencherSecoes());
    el.secao.addEventListener('change', () => this._botao());
    el.form.addEventListener('submit', async e => {
      e.preventDefault();
      el.botao.disabled = true;
      try {
        await aoEscolher(el.pleito.value, this.valor());
      } finally {
        this._botao();
      }
    });
  }

  valor() {
    const { uf, municipio, zona, secao } = this.el;
    return { uf: uf.value, municipio: municipio.value, zona: zona.value, secao: secao.value, nomeMunicipio: this.municipios.find(m => m.codigo === municipio.value)?.nome };
  }

  status(texto, tipo = '') {
    this.el.status.textContent = texto;
    this.el.status.className = `status-linha ${tipo}`;
  }

  /** Posiciona os seletores numa seção (ex.: a urna aberta em outra aba) */
  async posicionar(pleito, { uf, municipio, zona, secao }) {
    this.el.pleito.value = pleito;
    this.el.uf.value = uf;
    await this._carregarMunicipios();
    this.el.municipio.value = municipio;
    this._preencherZonas();
    this.el.zona.value = zona;
    this._preencherSecoes();
    this.el.secao.value = secao;
    this._botao();
  }

  _limpar(sel, texto) { sel.innerHTML = `<option value="">${texto}</option>`; sel.disabled = true; }
  _botao() { this.el.botao.disabled = !this.el.secao.value; }

  async _carregarMunicipios() {
    const { uf, pleito, municipio, zona, secao } = this.el;
    this._limpar(municipio, uf.value ? 'Carregando…' : 'Escolha o estado');
    this._limpar(zona, '—');
    this._limpar(secao, '—');
    this._botao();
    if (!uf.value) return;
    this.status('Baixando a lista de seções do TSE…');
    try {
      this.municipios = await this.tse.municipios(pleito.value, uf.value);
      municipio.innerHTML = `<option value="">Escolha (${this.municipios.length})</option>${this.municipios.map(m => `<option value="${esc(m.codigo)}">${esc(titulo(m.nome))}</option>`).join('')}`;
      municipio.disabled = false;
      this.status('');
    } catch (e) {
      this._limpar(municipio, 'Indisponível');
      this.status(`Não foi possível falar com o TSE: ${e.message}`, 'erro');
    }
  }

  _preencherZonas() {
    const m = this.municipios.find(x => x.codigo === this.el.municipio.value);
    this._limpar(this.el.secao, '—');
    if (!m) { this._limpar(this.el.zona, '—'); this._botao(); return; }
    this.el.zona.innerHTML = m.zonas.map(z => `<option value="${esc(z.codigo)}">${esc(semZeros(z.codigo))}</option>`).join('');
    this.el.zona.disabled = false;
    this._preencherSecoes();
  }

  _preencherSecoes() {
    const z = this.municipios.find(x => x.codigo === this.el.municipio.value)?.zonas.find(x => x.codigo === this.el.zona.value);
    this.el.secao.innerHTML = z ? z.secoes.map(s => `<option value="${esc(s)}">${esc(semZeros(s))}</option>`).join('') : '';
    this.el.secao.disabled = !z;
    this._botao();
  }
}
