/**
 * Tabelas em cartões no celular: copia o nome de cada coluna (texto do <th>) para as células (data-label).
 * No CSS (até 639 px), cada linha vira um cartão e cada célula mostra "coluna: valor" (td::before com attr()).
 * Vale para todas as .tabela-urnas, inclusive as montadas depois (observa o documento).
 */
const TAMANHO_MAXIMO = 40;
// Caracteres invisíveis e de direção de texto não entram no rótulo (evitam rótulo enganoso)
const INVISIVEIS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Rotula as tabelas dentro de raiz */
export function rotularTabelas(raiz = document) {
  for (const tabela of raiz.querySelectorAll('table.tabela-urnas')) {
    const cabecalho = tabela.tHead?.rows[tabela.tHead.rows.length - 1];
    if (!cabecalho) continue;
    // Posição de cada coluna, levando em conta colspan no cabeçalho
    const nomes = [];
    for (const th of cabecalho.cells) {
      const nome = th.textContent.replace(INVISIVEIS, '').replace(/\s+/g, ' ').trim().slice(0, TAMANHO_MAXIMO);
      for (let k = 0; k < (th.colSpan || 1); k++) nomes.push(nome);
    }
    for (const corpo of [...tabela.tBodies, tabela.tFoot].filter(Boolean)) {
      for (const linha of corpo.rows) {
        let col = 0;
        for (const td of linha.cells) {
          // Célula que ocupa várias colunas (ex.: "em conferência") fica sem rótulo
          if ((td.colSpan || 1) === 1 && nomes[col]) {
            td.dataset.label = nomes[col];
            embrulhar(td);
          } else delete td.dataset.label;
          col += td.colSpan || 1;
        }
      }
    }
  }
}

/**
 * Junta o conteúdo da célula num só bloco (span.valor-celula): no cartão, o valor fica inteiro à direita,
 * mesmo quando a célula tem texto e selos misturados. Não mexe de novo numa célula já embrulhada.
 */
function embrulhar(td) {
  if (td.childNodes.length === 1 && td.firstChild.nodeType === 1 && td.firstChild.classList.contains('valor-celula')) return;
  if (!td.childNodes.length) return;
  const valor = td.ownerDocument.createElement('span');
  valor.className = 'valor-celula';
  valor.append(...td.childNodes);
  td.append(valor);
}

/** Rotula agora e sempre que o conteúdo mudar (as views redesenham as tabelas) */
export function observarTabelas(raiz = document.body) {
  rotularTabelas(raiz);
  let agendado = false;
  new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; rotularTabelas(raiz); });
  }).observe(raiz, { childList: true, subtree: true });
}
