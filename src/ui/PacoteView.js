/**
 * Aba "Urnas de uma UF": confere todas as urnas de um pacote do TSE num Worker (a tela não trava)
 * e lista as urnas, com as que pedem um olhar primeiro.
 */
import { icone } from './Icones.js?v=20261029-1725';
import { esc, br, duracao, semZeros } from './Formato.js?v=20261029-1725';
import { horaDeBrasilia, localDaUrna } from '../domain/LogUrna.js?v=20261029-1725';

const TITULOS_ATENCAO = {
  habilitacao: 'voto sem eleitor habilitado', janela: 'voto fora do horário', abertura: 'abertura antes das 8h',
  encerramento: 'sem encerramento', rajadas: 'votos com menos de 15 s', assinaturas: 'assinatura sem sucesso',
  'bu-comparecimento': 'log ≠ boletim (votos)', 'bu-biometria': 'log ≠ boletim (biometria)', 'bu-urna': 'urna ≠ boletim'
};
const PAGINA = 500;

export class PacoteView {
  /** @param {HTMLElement} raiz @param {{ aoAbrirUrna: (chave: string) => void, avisar: (msg: string) => void }} acoes */
  constructor(raiz, acoes) {
    this.raiz = raiz;
    this.acoes = acoes;
    this.pacotes = [];
    this.resumos = new Map();
    this.filtro = 'atencao';
    this.limite = PAGINA;
    this.worker = null;
    raiz.addEventListener('click', e => {
      const alvo = e.target.closest('[data-acao]');
      if (alvo) this._acao(alvo.dataset.acao, alvo.dataset.indice);
      const linha = e.target.closest('tr[data-chave]');
      if (linha) this.acoes.aoAbrirUrna(linha.dataset.chave);
    });
    raiz.addEventListener('keydown', e => {
      const linha = e.target.closest('tr[data-chave]');
      if (linha && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.acoes.aoAbrirUrna(linha.dataset.chave); }
    });
    this.render();
  }

  definirPacotes(pacotes) {
    this.pacotes = pacotes;
    this.render();
  }

  _acao(acao, indice) {
    if (acao === 'conferir') this._conferir(this.pacotes[+indice]);
    else if (acao === 'parar') this.worker?.postMessage({ tipo: 'cancelar' });
    else if (acao === 'mais') { this.limite += PAGINA; this.render(); }
    else if (acao === 'csv') this._baixarCsv();
    else if (acao.startsWith('filtro-')) { this.filtro = acao.slice(7); this.limite = PAGINA; this.render(); }
  }

  _conferir(pacote) {
    this.worker?.terminate();
    this.resumos.clear();
    this.progresso = { feitas: 0, total: pacote.urnas, nome: pacote.nome, rodando: true, inicio: performance.now() };
    this.worker = new Worker(new URL('../infrastructure/VarreduraWorker.js?v=20261029-1725', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', ({ data }) => {
      if (data.tipo === 'progresso') {
        for (const r of data.resumos) this.resumos.set(r.chave, r);
        this.progresso.feitas = data.feitas;
        this.progresso.total = data.total;
        this._agendar();
      } else if (data.tipo === 'fim' || data.tipo === 'erro') {
        this.progresso.rodando = false;
        this.progresso.cancelado = data.cancelado;
        this.progresso.segundos = Math.round((performance.now() - this.progresso.inicio) / 1000);
        if (data.tipo === 'erro') this.acoes.avisar(`Não foi possível ler o pacote: ${data.mensagem}`);
        this.worker.terminate();
        this.worker = null;
        this.render();
      }
    });
    this.worker.addEventListener('error', e => {
      this.progresso.rodando = false;
      this.acoes.avisar(`Falha ao conferir o pacote: ${e.message || 'o navegador não iniciou o Worker'}`);
      this.render();
    });
    this.worker.postMessage({ arquivo: pacote.arquivo });
    this.render();
  }

  /** Redesenha no máximo a cada 300 ms durante a conferência */
  _agendar() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.render(); }, 300);
  }

  _lista() {
    const todas = [...this.resumos.values()];
    const filtradas = todas.filter(r =>
      this.filtro === 'todas' ? true :
        this.filtro === 'troca' ? r.contingencia :
          this.filtro === 'erro' ? r.erro : (r.atencao?.length || r.erro));
    return filtradas.sort((a, b) => (b.atencao?.length || 0) - (a.atencao?.length || 0) || a.chave.localeCompare(b.chave));
  }

  render() {
    if (!this.pacotes.length) {
      this.raiz.innerHTML = `<div class="vazio">${icone('layers')}<p>Nenhum pacote aberto. Abra o <span class="font-mono">.zip</span> de uma UF na aba Abrir urna.</p><button type="button" class="botao botao-primario" data-ir="tabAbrir">Abrir urna</button></div>`;
      return;
    }
    const p = this.progresso;
    const todas = [...this.resumos.values()];
    const soma = campo => todas.reduce((s, r) => s + (r[campo] || 0), 0);
    const comAtencao = todas.filter(r => r.atencao?.length).length;
    const lista = this._lista();
    const visiveis = lista.slice(0, this.limite);

    this.raiz.innerHTML = `
      <div class="glass-panel cartao">
        <h3 class="cartao-titulo">${icone('layers')}Pacotes abertos</h3>
        <ul class="lista-urnas">
          ${this.pacotes.map((pk, i) => `<li><button type="button" data-acao="conferir" data-indice="${i}" ${p?.rodando ? 'disabled' : ''}>
            <span><strong>${esc(pk.nome)}</strong><br><small>${br(pk.urnas)} urnas · ${(pk.tamanho / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MB</small></span>
            <span class="botao botao-primario">${icone('play')}Conferir todas</span></button></li>`).join('')}
        </ul>
        ${p ? `
          <div class="progresso" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.feitas}"><span style="width:${p.total ? (p.feitas / p.total) * 100 : 0}%"></span></div>
          <p class="status-linha">${p.rodando ? `Conferindo ${esc(p.nome)}: ${br(p.feitas)} de ${br(p.total)} urnas…` : `${p.cancelado ? 'Interrompido' : 'Concluído'}: ${br(p.feitas)} urnas em ${br(p.segundos)} s.`}
          ${p.rodando ? `<button type="button" class="botao botao-secundario" data-acao="parar">${icone('stop')}Parar</button>` : ''}</p>` : ''}
      </div>

      ${todas.length ? `
      <div class="grade-kpi tres">
        ${kpi('Urnas conferidas', br(todas.length))}
        ${kpi('Votos no log', br(soma('votos')))}
        ${kpi('Comparecimento nos boletins', br(soma('comparecimento')))}
        ${kpi('Diferença log − boletim', br(soma('votos') - soma('comparecimento')))}
        ${kpi('Urnas com ponto para olhar', br(comAtencao))}
        ${kpi('Urnas com troca', br(todas.filter(r => r.contingencia).length))}
      </div>

      <div class="glass-panel cartao">
        <div class="chips" role="group" aria-label="Filtro">
          ${[['atencao', 'Pontos para olhar'], ['troca', 'Com troca de urna'], ['erro', 'Não lidas'], ['todas', 'Todas']].map(([k, t]) => `<button type="button" class="chip ${this.filtro === k ? 'ativo' : ''}" data-acao="filtro-${k}">${t}</button>`).join('')}
          <button type="button" class="chip" data-acao="csv">Baixar CSV</button>
        </div>
        <p class="status-linha">${br(lista.length)} urna(s) neste filtro. Toque numa linha para abrir a urna.</p>
        ${lista.length ? `<div class="tabela-wrap"><table class="tabela-urnas">
          <thead><tr><th>Seção</th><th class="num">Votos no log</th><th class="num">Boletim</th><th class="ocultar-celular">Abertura</th><th class="ocultar-celular">Encerramento</th><th class="num ocultar-celular">Menor intervalo</th><th>Situação</th></tr></thead>
          <tbody>${visiveis.map(r => linha(r)).join('')}</tbody></table></div>` : `<p class="nota">${this.filtro === 'atencao' ? 'Nenhuma urna com ponto para olhar: em todas, o log confere com o boletim.' : 'Nenhuma urna neste filtro.'}</p>`}
        ${lista.length > visiveis.length ? `<div class="paginacao"><button type="button" class="botao botao-secundario" data-acao="mais">Mostrar mais</button></div>` : ''}
      </div>` : ''}
    `;
  }

  _baixarCsv() {
    const cab = ['uf', 'municipio', 'zona', 'secao', 'dia', 'votos_log', 'comparecimento_boletim', 'abertura', 'encerramento', 'menor_intervalo_s', 'votos_sem_habilitacao', 'votos_fora_do_horario', 'votos_depois_17h', 'alertas', 'erros', 'troca_de_urna', 'pontos_para_olhar', 'erro_de_leitura'];
    const linhas = [cab.join(';')];
    for (const r of [...this.resumos.values()].sort((a, b) => a.chave.localeCompare(b.chave))) {
      const [uf, mun, zona, secao] = r.chave.split('-');
      linhas.push([uf, mun, zona, secao, r.dia, r.votos, r.comparecimento, r.abertura, r.encerramento, r.menorIntervalo, r.semHabilitacao, r.foraDaJanela, r.depoisDas17h, r.alertas, r.erros, r.contingencia ? 'sim' : 'nao', (r.atencao || []).join(' '), r.erro || ''].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${linhas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `urnas-${this.progresso?.nome?.replace(/\.zip$/i, '') || 'pacote'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

function kpi(rotulo, valor) {
  return `<div class="glass-panel kpi"><span class="kpi-rotulo">${esc(rotulo)}</span><span class="kpi-valor">${valor}</span></div>`;
}

function linha(r) {
  const [uf, mun, zona, secao] = r.chave.split('-');
  const situacao = r.erro ? `<span class="selo selo-atencao">não lida: ${esc(r.erro)}</span>`
    : r.atencao.length ? r.atencao.map(a => `<span class="selo selo-atencao">${esc(TITULOS_ATENCAO[a] || a)}</span>`).join(' ')
      : `<span class="selo selo-ok">confere</span>${r.contingencia ? ' <span class="selo selo-info">troca de urna</span>' : ''}`;
  return `<tr data-chave="${esc(r.chave)}" tabindex="0">
    <td class="font-mono">${esc(uf)} ${esc(mun)} · Z${esc(semZeros(zona))} · S${esc(semZeros(secao))}</td>
    <td class="num">${br(r.votos)}</td><td class="num">${br(r.comparecimento)}</td>
    <td class="font-mono ocultar-celular">${esc(horaDeBrasilia(r.abertura, localDaUrna(uf, mun)) ?? '—')}</td>
    <td class="font-mono ocultar-celular">${esc(horaDeBrasilia(r.encerramento, localDaUrna(uf, mun)) ?? '—')}</td>
    <td class="num ocultar-celular">${duracao(r.menorIntervalo)}</td>
    <td>${situacao}</td></tr>`;
}
