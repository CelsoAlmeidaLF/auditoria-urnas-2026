/**
 * Carimba a mesma versão (?v=...) em todos os arquivos que o navegador baixa:
 * CSS e script de entrada no index.html, cada import relativo em src/ e o endereço do Worker (new URL(...)).
 * Sem isso, o navegador pode misturar módulos novos com módulos antigos do cache.
 *
 * Uso: node scripts/versionar.mjs [versao]   (padrão: data e hora, ex.: 20261028-1912)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const agora = new Date();
const dois = n => String(n).padStart(2, '0');
const versao = process.argv[2] || `${agora.getFullYear()}${dois(agora.getMonth() + 1)}${dois(agora.getDate())}-${dois(agora.getHours())}${dois(agora.getMinutes())}`;

const comVersao = caminho => `${caminho.replace(/\?v=[^'"]*$/, '')}?v=${versao}`;

// index.html: folhas de estilo locais e o script de entrada
const indexPath = join(raiz, 'index.html');
const index = readFileSync(indexPath, 'utf8')
  .replace(/(href="((?:css|vendor)\/[^"]+\.css)(?:\?v=[^"]*)?")/g, (_, __, p) => `href="${comVersao(p)}"`)
  .replace(/(src="(src\/[^"]+\.js)(?:\?v=[^"]*)?")/g, (_, __, p) => `src="${comVersao(p)}"`);
writeFileSync(indexPath, index);

// src/**: imports e exports relativos
const arquivos = [];
const varrer = dir => {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) varrer(p);
    else if (p.endsWith('.js')) arquivos.push(p);
  }
};
varrer(join(raiz, 'src'));
let total = 0;
for (const p of arquivos) {
  const antes = readFileSync(p, 'utf8');
  const depois = antes.replace(/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bnew URL\(\s*)(['"])(\.{1,2}\/[^'"]+?\.js)(?:\?v=[^'"]*)?\2/g,
    (_, kw, q, caminho) => { total++; return `${kw}${q}${caminho}?v=${versao}${q}`; });
  if (depois !== antes) writeFileSync(p, depois);
}
// sw.js: versão do cache e lista do app shell (com as mesmas URLs versionadas que a página pede)
const shell = ['./', 'index.html', 'manifest.webmanifest'];
for (const [, caminho] of index.matchAll(/(?:href|src)="((?:css|vendor|src|icons)\/[^"#]+)"/g)) shell.push(caminho);
for (const p of arquivos) {
  const rel = p.slice(raiz.length).replace(/\\/g, '/').replace(/^\//, '');
  shell.push(`${rel}?v=${versao}`);
}
const fontes = join(raiz, 'vendor', 'fonts');
for (const nome of readdirSync(fontes)) if (nome.endsWith('.woff2')) shell.push(`vendor/fonts/${nome}`);
shell.push(`vendor/stk-gov/stk-gov-shell.js?v=${versao}`, `vendor/stk-gov/stk-gov-pwa.js?v=${versao}`, 'icons/app-icon-512.png');
const unicos = [...new Set(shell)];
const swPath = join(raiz, 'sw.js');
const sw = readFileSync(swPath, 'utf8').replace(/\/\/ <versionar>[\s\S]*?\/\/ <\/versionar>/,
  `// <versionar>\nconst CACHE_VERSION = 'urnas-${versao}';\nconst APP_SHELL = ${JSON.stringify(unicos, null, 2)};\n// </versionar>`);
writeFileSync(swPath, sw);

console.log(`Versão ${versao}: index.html, ${total} imports em ${arquivos.length} arquivos e ${unicos.length} itens no sw.js.`);
