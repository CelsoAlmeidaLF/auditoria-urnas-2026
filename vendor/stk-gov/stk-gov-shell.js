/**
 * STK-GOVERNO-BRAZIL — comportamento comum do shell (topo, barra lateral, barra inferior, menus)
 * Fonte canônica: 8. STK-GOVERNO-BRAZIL/_design-system/stk-gov-shell.js
 * Cada projeto recebe uma cópia em vendor/stk-gov/ (node _design-system/sync.mjs): não edite a cópia.
 *
 * Marcação esperada (ver _design-system/README.md):
 *   #btnToggleSidebar      botão de menu do topo
 *   #appSidebar            <aside class="app-sidebar">
 *   #btnCloseSidebar       fechar a gaveta (dentro da barra)
 *   #sidebarBackdrop       fundo escuro da gaveta (com o atributo hidden)
 *   [data-tab="idDaAba"]   itens da barra lateral e da barra inferior
 *   .tab-pane#idDaAba      conteúdo de cada aba
 *   .action-menu           botão com menu suspenso (.action-menu-list)
 */

const GAVETA = '(max-width: 1023px)';

export class StkGovShell {
  /**
   * @param {Object} [opcoes]
   * @param {string} [opcoes.app] Nome curto do app, separa o estado salvo de cada projeto
   * @param {(abaId: string) => void} [opcoes.onTabChange] Chamado depois de trocar de aba
   * @param {boolean} [opcoes.gerenciarAbas=true] false quando o projeto já cuida das abas (só menu, gaveta e menus suspensos)
   * @param {string} [opcoes.chaveRecolhida] Chave do localStorage da barra recolhida (padrão: "<app>.sidebar.recolhida")
   * @param {Document} [opcoes.doc]
   */
  constructor({ app = 'stk', onTabChange = () => {}, gerenciarAbas = true, chaveRecolhida, doc = document } = {}) {
    this.doc = doc;
    this.onTabChange = onTabChange;
    this.gerenciarAbas = gerenciarAbas;
    this.chaveRecolhida = chaveRecolhida || `${app}.sidebar.recolhida`;
    this.sidebar = doc.getElementById('appSidebar');
    this.backdrop = doc.getElementById('sidebarBackdrop');
    this.btnToggle = doc.getElementById('btnToggleSidebar');
    this.btnClose = doc.getElementById('btnCloseSidebar');
    this.gaveta = window.matchMedia(GAVETA);
    this.abaAtual = null;
  }

  iniciar() {
    // Folhas da barra inferior (celular): montadas antes das abas, porque podem copiar itens de aba
    this._montarFolhas();
    // Recolhida no desktop: lembra a escolha de cada pessoa
    if (this.sidebar && this._ler(this.chaveRecolhida) === 'true') this.sidebar.classList.add('sidebar-collapsed');

    this.btnToggle?.addEventListener('click', () => this.alternar());
    this.btnClose?.addEventListener('click', () => this.fecharGaveta());
    this.backdrop?.addEventListener('click', () => this.fecharGaveta());
    this.doc.addEventListener('keydown', e => {
      if (e.key === 'Escape') { this.fecharGaveta(); this.fecharMenus(); this.fecharFolhas(); }
    });
    this.gaveta.addEventListener('change', () => { this.fecharGaveta(false); this._sincronizar(); });

    if (this.gerenciarAbas) this._ligarAbas();

    // Menus suspensos dos botões (ex.: Compartilhar)
    this.doc.querySelectorAll('.action-menu').forEach(menu => {
      const botao = menu.querySelector('[aria-haspopup]');
      botao?.addEventListener('click', e => {
        e.stopPropagation();
        const abrir = !menu.classList.contains('open');
        this.fecharMenus();
        menu.classList.toggle('open', abrir);
        botao.setAttribute('aria-expanded', String(abrir));
      });
      menu.querySelectorAll('.action-menu-item').forEach(item => item.addEventListener('click', () => this.fecharMenus()));
    });
    this.doc.addEventListener('click', () => { this.fecharMenus(); this.fecharFolhas(); });

    this._sincronizar();
  }

  /** Abas: barra lateral e barra inferior apontam para a mesma aba com data-tab */
  _ligarAbas() {
    this.doc.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => this.trocarAba(btn.dataset.tab));
    });
    // Setas, Home e End percorrem a lista de abas da barra lateral
    const itens = [...this.doc.querySelectorAll('.sidebar-nav-list [data-tab]')];
    itens.forEach((btn, i) => btn.addEventListener('keydown', e => {
      const destino = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: itens.length - 1 }[e.key];
      if (destino === undefined) return;
      e.preventDefault();
      const proximo = itens[(destino + itens.length) % itens.length];
      proximo.focus();
      this.trocarAba(proximo.dataset.tab);
    }));
    const ativa = this.doc.querySelector('.sidebar-nav-item.active[data-tab]') || itens[0];
    if (ativa) this.trocarAba(ativa.dataset.tab, { avisar: false });
  }

  /** Botão de menu: gaveta no tablet e no celular, recolher/expandir no desktop */
  alternar() {
    if (!this.sidebar) return;
    if (this.gaveta.matches) {
      if (this.sidebar.classList.contains('sidebar-open')) this.fecharGaveta();
      else this.abrirGaveta();
      return;
    }
    const recolhida = this.sidebar.classList.toggle('sidebar-collapsed');
    this._gravar(this.chaveRecolhida, String(recolhida));
    this._sincronizar();
  }

  abrirGaveta() {
    if (!this.sidebar || !this.gaveta.matches) return;
    this.sidebar.classList.add('sidebar-open');
    if (this.backdrop) this.backdrop.hidden = false;
    this.doc.body.classList.add('stk-drawer-open');
    this._sincronizar();
    this.sidebar.querySelector('.sidebar-nav-item.active')?.focus();
  }

  /** @param {boolean} [devolverFoco] Volta o foco ao botão de menu */
  fecharGaveta(devolverFoco = true) {
    if (!this.sidebar || !this.sidebar.classList.contains('sidebar-open')) return;
    this.sidebar.classList.remove('sidebar-open');
    if (this.backdrop) this.backdrop.hidden = true;
    this.doc.body.classList.remove('stk-drawer-open');
    this._sincronizar();
    if (devolverFoco && this.gaveta.matches) this.btnToggle?.focus();
  }

  /**
   * Folha da barra inferior (celular): menu que sobe acima da barra com itens que não cabem nela.
   *   <button class="bottom-nav-item" data-folha="idDaFolha">…</button>
   *   <div class="stk-folha" id="idDaFolha" data-copiar-de="seletor CSS">título e itens</div>
   * data-copiar-de copia itens do menu lateral (links ou botões de aba), sem repetir HTML.
   */
  _montarFolhas() {
    this.doc.querySelectorAll('.stk-folha[data-copiar-de]').forEach(folha => {
      for (const item of this.doc.querySelectorAll(folha.dataset.copiarDe)) {
        const copia = item.cloneNode(true);
        copia.removeAttribute('id');
        copia.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        copia.classList.remove('sidebar-nav-item', 'active');
        copia.classList.add('stk-folha-item');
        copia.removeAttribute('role');
        copia.removeAttribute('aria-selected');
        copia.removeAttribute('aria-controls');
        copia.removeAttribute('tabindex');
        folha.appendChild(copia);
      }
    });
    this.doc.querySelectorAll('[data-folha]').forEach(botao => {
      const folha = this.doc.getElementById(botao.dataset.folha);
      if (!folha) return;
      botao.setAttribute('aria-haspopup', 'menu');
      botao.setAttribute('aria-expanded', 'false');
      botao.setAttribute('aria-controls', folha.id);
      botao.addEventListener('click', e => {
        e.stopPropagation();
        const abrir = !folha.classList.contains('aberta');
        this.fecharFolhas();
        if (abrir) {
          folha.classList.add('aberta');
          botao.setAttribute('aria-expanded', 'true');
          folha.querySelector('a, button')?.focus();
        }
      });
      folha.addEventListener('click', e => {
        if (e.target.closest('a, button')) this.fecharFolhas();
        else e.stopPropagation();
      });
    });
  }

  fecharFolhas() {
    this.doc.querySelectorAll('.stk-folha.aberta').forEach(f => f.classList.remove('aberta'));
    this.doc.querySelectorAll('[data-folha][aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  fecharMenus() {
    this.doc.querySelectorAll('.action-menu.open').forEach(m => {
      m.classList.remove('open');
      m.querySelector('[aria-haspopup]')?.setAttribute('aria-expanded', 'false');
    });
  }

  /**
   * Mostra uma aba e marca o item ativo na barra lateral e na barra inferior
   * @param {string} abaId
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.avisar] Chama onTabChange (padrão: sim)
   */
  trocarAba(abaId, { avisar = true } = {}) {
    if (!this.doc.getElementById(abaId)) return;
    this.abaAtual = abaId;
    this.doc.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === abaId));
    this.doc.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(b => {
      const ativo = b.dataset.tab === abaId;
      b.classList.toggle('active', ativo);
      b.setAttribute('aria-selected', String(ativo));
      b.tabIndex = ativo ? 0 : -1;
    });
    this.doc.querySelectorAll('.bottom-nav-item[data-tab]').forEach(b => {
      const ativo = b.dataset.tab === abaId;
      b.classList.toggle('active', ativo);
      if (ativo) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    this.fecharGaveta(false);
    if (avisar) this.onTabChange(abaId);
  }

  /** Rótulos e estados de acessibilidade conforme a largura e o estado da barra */
  _sincronizar() {
    if (!this.sidebar) return;
    const gaveta = this.gaveta.matches;
    const aberta = this.sidebar.classList.contains('sidebar-open');
    const recolhida = this.sidebar.classList.contains('sidebar-collapsed');
    // Gaveta fechada fica fora do Tab e do leitor de tela
    this.sidebar.inert = gaveta && !aberta;
    if (!this.btnToggle) return;
    const expandida = gaveta ? aberta : !recolhida;
    const rotulo = gaveta
      ? (aberta ? 'Fechar menu' : 'Abrir menu')
      : (recolhida ? 'Expandir menu' : 'Recolher menu');
    this.btnToggle.setAttribute('aria-expanded', String(expandida));
    this.btnToggle.setAttribute('aria-label', rotulo);
    this.btnToggle.title = rotulo;
  }

  _ler(chave) {
    try { return localStorage.getItem(chave); } catch { return null; }
  }

  _gravar(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: vale só nesta visita */ }
  }
}

/** Ícones do shell (padrão Lucide, traço 1.8, currentColor) */
export const SHELL_ICONS = Object.freeze({
  panelLeft: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M9 3v18"></path></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"></line><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"></line></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>',
  fileCsv: '<svg viewBox="0 0 24 24"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 13h2"></path><path d="M8 17h2"></path><path d="M14 13h2"></path><path d="M14 17h2"></path></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
  whatsapp: '<svg viewBox="0 0 24 24"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"></path><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"></path></svg>'
});

/**
 * Injeta ícones em elementos com data-stk-icon="nome"
 * @param {Object<string, string>} catalogo Ícones extras do projeto (somados aos do shell)
 * @param {ParentNode} [raiz]
 */
export function renderStkIcons(catalogo = {}, raiz = document) {
  const todos = { ...SHELL_ICONS, ...catalogo };
  raiz.querySelectorAll('[data-stk-icon]').forEach(el => {
    const svg = todos[el.getAttribute('data-stk-icon')];
    if (!svg) return;
    el.classList.add('stk-icon');
    el.innerHTML = svg;
  });
}
