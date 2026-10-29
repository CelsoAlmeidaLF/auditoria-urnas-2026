/**
 * Aba "Eventos do log": as linhas do logd.dat com busca, filtros e exportação em CSV.
 * Mostra 300 linhas por vez (um dia de votação tem milhares).
 */
import { esc } from './Formato.js?v=20261029-1755';
import { MARCOS, horaDeBrasilia, diasDoLog } from '../domain/LogUrna.js?v=20261029-1755';

const PAGINA = 300;

export class EventosView {
  constructor(doc = document) {
    this.doc = doc;
    this.el = id => doc.getElementById(id);
    this.dados = null;
    this.nivel = '';
    this.limite = PAGINA;
    this.filtrados = [];

    let espera;
    this.el('filtroTexto').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => this._aplicar(true), 150); });
    for (const id of ['filtroDia', 'filtroApp', 'filtroOrigem']) this.el(id).addEventListener('change', () => this._aplicar(true));
    doc.querySelectorAll('[data-nivel]').forEach(b => b.addEventListener('click', () => {
      this.nivel = b.dataset.nivel;
      doc.querySelectorAll('[data-nivel]').forEach(x => x.classList.toggle('ativo', x === b));
      this._aplicar(true);
    }));
    this.el('btnMaisEventos').addEventListener('click', () => { this.limite += PAGINA; this._desenhar(); });
  }

  /** @param {{eventos: object[], internos: {nome: string, eventos: object[]}[], dias: object[], analise: {dia: string, uf: string}}} r */
  carregar(r) {
    this.dados = r;
    this.uf = r.analise.uf;
    this.el('eventosVazio').hidden = true;
    this.el('eventosConteudo').hidden = false;

    const origem = this.el('filtroOrigem');
    origem.innerHTML = `<option value="urna">Desta urna (logd.dat)</option>${r.internos.map((i, k) => `<option value="${k}">Log interno: ${esc(i.nome)}</option>`).join('')}`;
    origem.disabled = !r.internos.length;
    this._preencherDias(r.analise.dia);
    this._aplicar(true);
  }

  _eventosDaOrigem() {
    const v = this.el('filtroOrigem').value;
    return v === 'urna' || !this.dados.internos[v] ? this.dados.eventos : this.dados.internos[v].eventos;
  }

  _preencherDias(preferido) {
    const eventos = this._eventosDaOrigem();
    const infos = diasDoLog(eventos);
    const dias = infos.map(d => d.dia);
    const sel = this.el('filtroDia');
    const atual = preferido || sel.value;
    // O mesmo log guarda a preparação, o 1º e o 2º turno: cada dia mostra o turno e se houve votação
    const rotulo = d => `${d.turno && (d.votos || d.votacao) ? `${d.turno}º turno · ` : ''}${d.dia}${d.votos ? ` · ${d.votos.toLocaleString('pt-BR')} votos` : d.votacao ? '' : ' · preparação'}`;
    sel.innerHTML = `<option value="">Todos os dias</option>${infos.map(d => `<option value="${esc(d.dia)}">${esc(rotulo(d))}</option>`).join('')}`;
    sel.value = dias.includes(atual) ? atual : '';
    const apps = [...new Set(eventos.map(e => e.app))].sort();
    const selApp = this.el('filtroApp');
    const appAtual = selApp.value;
    selApp.innerHTML = `<option value="">Todas</option>${apps.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}`;
    selApp.value = apps.includes(appAtual) ? appAtual : '';
  }

  _aplicar(voltarAoInicio) {
    if (!this.dados) return;
    if (this._origemAnterior !== this.el('filtroOrigem').value) {
      this._origemAnterior = this.el('filtroOrigem').value;
      this._preencherDias(this.el('filtroDia').value);
    }
    const dia = this.el('filtroDia').value;
    const app = this.el('filtroApp').value;
    const texto = this.el('filtroTexto').value.trim().toLowerCase();
    const nivel = this.nivel;
    this.filtrados = this._eventosDaOrigem().filter(e =>
      (!dia || e.dia === dia) &&
      (!app || e.app === app) &&
      (!texto || e.msg.toLowerCase().includes(texto)) &&
      (!nivel ||
        (nivel === 'VOTO' ? e.msg.startsWith('O voto do eleitor foi computado') :
          nivel === 'MARCO' ? MARCOS.some(([re]) => re.test(e.msg)) : e.nivel === nivel)));
    if (voltarAoInicio) this.limite = PAGINA;
    this._desenhar();
  }

  _desenhar() {
    const texto = this.el('filtroTexto').value.trim();
    const marcar = s => {
      const seguro = esc(s);
      if (!texto) return seguro;
      const alvo = esc(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return seguro.replace(new RegExp(alvo, 'gi'), m => `<mark>${m}</mark>`);
    };
    const visiveis = this.filtrados.slice(0, this.limite);
    const outroFuso = this.uf && horaDeBrasilia('12:00:00', this.uf) !== '12:00:00';
    this.el('corpoEventos').innerHTML = visiveis.map(e => `
      <tr class="nivel-${esc(e.nivel)} ${e.msg.startsWith('O voto do eleitor foi computado') ? 'voto' : ''}">
        <td>${e.n}</td><td title="${esc(e.dia)}">${esc(e.hora)}</td><td>${esc(e.nivel)}</td><td>${esc(e.app)}</td><td>${marcar(e.msg)}</td>
      </tr>`).join('');
    this.el('contagemEventos').textContent =
      `${this.filtrados.length.toLocaleString('pt-BR')} linha(s)${this.filtrados.length > visiveis.length ? `, mostrando ${visiveis.length.toLocaleString('pt-BR')}` : ''}. ` +
      `Horário do relógio da urna${outroFuso ? ` (some ${horaDeBrasilia('12:00:00', this.uf).slice(0, 2) - 12} h para o horário de Brasília)` : ''}.`;
    this.el('btnMaisEventos').hidden = this.filtrados.length <= visiveis.length;
  }

  /** CSV das linhas filtradas (todas, não só as visíveis) */
  csv() {
    const aspas = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [['linha', 'data', 'hora', 'nivel', 'urna', 'aplicacao', 'mensagem', 'verificador'].join(';')];
    for (const e of this.filtrados) linhas.push([e.n, e.dia, e.hora, e.nivel, e.urna, e.app, e.msg, e.verificador].map(aspas).join(';'));
    return `﻿${linhas.join('\r\n')}`;
  }
}
