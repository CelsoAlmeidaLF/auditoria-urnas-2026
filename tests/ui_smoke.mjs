/**
 * Teste de fumaça da tela, num Chrome de verdade (headless), sem dependências npm.
 * Abre os exemplos, confere verificações e eventos, busca uma seção no site do TSE (se houver internet),
 * confere um pacote de UF inteiro (se o caminho for passado) e o layout de celular.
 *
 * Uso: node --experimental-websocket tests/ui_smoke.mjs [pacote_UF.zip] [pasta_para_capturas]
 * Sem Chrome instalado, o teste é pulado (sai com código 0 e avisa).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const pacote = process.argv[2] ? resolve(process.argv[2]) : null;
const capturas = process.argv[3] ? resolve(process.argv[3]) : null;
const chromeBin = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .find(b => spawnSync('which', [b]).status === 0);
if (!chromeBin || typeof WebSocket === 'undefined') {
  console.log(`[PULADO] ${!chromeBin ? 'Chrome não encontrado' : 'WebSocket indisponível (use --experimental-websocket no Node 20)'}`);
  process.exit(0);
}

let passou = 0;
let falhou = 0;
const assert = (cond, msg) => {
  if (cond) { passou++; console.log(`  [PASS] ${msg}`); } else { falhou++; console.error(`  [FAIL] ${msg}`); }
};

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const servidor = createServer(async (req, res) => {
  const caminho = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const corpo = await readFile(join(raiz, caminho === '/' ? 'index.html' : caminho));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(caminho)] || 'application/octet-stream' });
    res.end(corpo);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}/index.html`;

const perfil = await mkdtemp(join(tmpdir(), 'urnas-ui-'));
const porta = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' });
const esperar = ms => new Promise(r => setTimeout(r, ms));

let ws;
for (let i = 0; i < 30 && !ws; i++) {
  try {
    const abas = await (await fetch(`http://127.0.0.1:${porta}/json`)).json();
    ws = new WebSocket(abas.find(t => t.type === 'page').webSocketDebuggerUrl);
  } catch { await esperar(200); }
}
await new Promise(r => ws.addEventListener('open', r));
let seq = 0;
const pendentes = {};
const erros = [];
ws.addEventListener('message', m => {
  const d = JSON.parse(m.data);
  if (d.method === 'Runtime.exceptionThrown') erros.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (pendentes[d.id]) { pendentes[d.id](d); delete pendentes[d.id]; }
});
const cdp = (method, params = {}) => new Promise(r => { pendentes[++seq] = r; ws.send(JSON.stringify({ id: seq, method, params })); });
const avaliar = async expr => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result.exceptionDetails ? `ERRO ${r.result.exceptionDetails.exception?.description}` : r.result.result.value;
};
const tela = (largura, celular = false, altura = 900) => cdp('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile: celular });
const abrir = async (url = base) => { await cdp('Page.navigate', { url }); await esperar(1500); };
const ate = async (expr, ms = 20000) => {
  for (let t = 0; t < ms; t += 250) { if (await avaliar(expr) === true) return true; await esperar(250); }
  return false;
};
const capturar = async nome => {
  if (!capturas) return;
  const altura = await avaliar('document.documentElement.scrollHeight');
  const largura = await avaliar('innerWidth');
  await cdp('Emulation.setDeviceMetricsOverride', { width: largura, height: Math.min(altura, 6000), deviceScaleFactor: 1, mobile: largura < 640 });
  await esperar(300);
  const { result } = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(capturas, `${nome}.png`), Buffer.from(result.data, 'base64'));
};
const textoDe = sel => avaliar(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);

try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');

  console.log('\n1. Abertura e exemplo de Roraima (desktop)');
  await tela(1400);
  await abrir();
  assert(await avaliar('appFatalError.hidden') === true && await avaliar('document.querySelector(".tab-pane.active").id') === 'tabPanorama', 'Página abre na aba Panorama, sem aviso de falha');
  assert(await ate('document.querySelectorAll("#panoramaConteudo .tabela-ufs tbody tr").length >= 28'), 'Panorama mostra as 27 UFs e o exterior (conferidas ou em conferência)');
  const kpiBr = JSON.parse(await avaliar('JSON.stringify([...document.querySelectorAll("#panoramaConteudo .kpi-valor")].map(k => k.textContent))'));
  const notaDiferenca = await avaliar('document.querySelectorAll("#panoramaConteudo .kpi-nota")[3].textContent');
  assert(kpiBr[3] === '0' || /urna desligou|log da urna que falhou/.test(notaDiferenca), `Panorama: ${kpiBr[0]} urnas, log ${kpiBr[1]} × boletins ${kpiBr[2]} (${notaDiferenca})`);
  await capturar('0-panorama');
  await tela(1400);
  await avaliar('document.querySelector(".sidebar-nav-item[data-tab=tabAbrir]").click()'); await esperar(200);
  assert(await avaliar("selUf.options.length") === 29 && await avaliar('selPleito.options.length') === 2, 'Formulário do TSE com 27 UFs, o exterior e os dois turnos');
  await capturar('1-abrir');
  await avaliar('document.querySelector("[data-exemplo=rr]").click()');
  assert(await ate('document.querySelector(".tab-pane.active").id === "tabUrna" && !!document.querySelector(".verificacao")'), 'Exemplo abre a aba Resumo da urna com verificações');
  const kpis = JSON.parse(await avaliar('JSON.stringify([...document.querySelectorAll("#urnaConteudo .kpi-valor")].map(k => k.textContent))'));
  assert(kpis[0] === '212' && kpis[1] === '212', `Votos no log e comparecimento no boletim: ${kpis[0]} e ${kpis[1]}`);
  assert(kpis[2] === '08:00:01', `Abertura em horário de Brasília (urna de RR marca 07:00:01): ${kpis[2]}`);
  const status = JSON.parse(await avaliar('JSON.stringify([...document.querySelectorAll(".verificacao")].map(v => v.dataset.status))'));
  assert(!status.includes('atencao') && status.filter(s => s === 'ok').length >= 8, `Verificações: ${status.filter(s => s === 'ok').length} conferem, nenhuma pede atenção`);
  assert((await textoDe('h2')).length > 0 && /Caroebe/.test(await textoDe('#urnaConteudo h2')), `Título da seção: ${await textoDe('#urnaConteudo h2')}`);
  assert(await avaliar('document.querySelectorAll(".barra").length') >= 9, 'Gráfico de votos por hora desenhado');
  assert(/LULA[\s\S]*42/.test(await textoDe('.boletim-cargo')), 'Boletim mostra o resultado de Presidente');
  assert(await avaliar('[...document.querySelectorAll(".verificacao")].some(v => /Registro Digital do Voto/.test(v.textContent) && v.dataset.status === "ok")'), 'Verificação: RDV voto a voto igual ao boletim');
  await avaliar('votoNumero.value = "22"; votoNumero.dispatchEvent(new Event("input", { bubbles: true }))'); await esperar(200);
  assert(/166 voto/.test(await textoDe('#votoResultado .voto-achado')), `Confira o seu voto: ${await textoDe('#votoResultado .voto-achado')}`);
  await avaliar('votoNumero.value = "47"; votoNumero.dispatchEvent(new Event("input", { bubbles: true }))'); await esperar(200);
  assert(await avaliar('!!document.querySelector("#votoResultado .voto-ausente")'), 'Número sem votos aparece como "nenhum voto"');
  await avaliar('votoNumero.value = "22"; votoNumero.dispatchEvent(new Event("input", { bubbles: true })); votoHora.value = "10:30"; votoHora.dispatchEvent(new Event("input", { bubbles: true }))'); await esperar(200);
  assert(/Votos computados entre/.test(await textoDe('#votoResultado')), 'Horário informado lista os votos computados perto da hora');
  assert(await ate('/VIDAL DA PENHA/i.test(document.querySelector("#urnaConteudo")?.textContent || "") && /69378-000/.test(document.querySelector("#urnaConteudo").textContent)'), 'Resumo mostra o local de votação com rua, número, bairro e CEP');
  await capturar('2-urna-rr');

  console.log('\n2. Eventos do log');
  await tela(1400);
  await avaliar('document.querySelector(".sidebar-nav-item[data-tab=tabEventos]").click()'); await esperar(300);
  assert(await avaliar('corpoEventos.children.length') === 300, 'Tabela mostra as primeiras 300 linhas do dia');
  await avaliar('document.querySelector("[data-nivel=VOTO]").click()'); await esperar(300);
  assert(/^212 linha/.test(await textoDe('#contagemEventos')), `Filtro "Só votos": ${await textoDe('#contagemEventos')}`);
  await avaliar('document.querySelector("[data-nivel=\'\']").click(); filtroTexto.value = "zerésima"; filtroTexto.dispatchEvent(new Event("input"))'); await esperar(500);
  assert(await avaliar('corpoEventos.querySelectorAll("mark").length') > 0, 'Busca por texto destaca o termo');
  await avaliar('filtroTexto.value = "<img src=x onerror=alert(1)>"; filtroTexto.dispatchEvent(new Event("input"))'); await esperar(400);
  assert(await avaliar('!document.querySelector("#corpoEventos img")'), 'Texto da busca não vira HTML');
  await avaliar('filtroTexto.value = ""; filtroTexto.dispatchEvent(new Event("input"))'); await esperar(300);
  await capturar('3-eventos');

  console.log('\n3. Troca de urna (Chapada Gaúcha, MG)');
  await avaliar('document.querySelector(".sidebar-nav-item[data-tab=tabAbrir]").click(); document.querySelector("[data-exemplo=mg]").click()');
  assert(await ate('/Chapada/.test(document.querySelector("#urnaConteudo h2")?.textContent || "")'), 'Exemplo de MG abre');
  const mg = JSON.parse(await avaliar('JSON.stringify({kpis: [...document.querySelectorAll("#urnaConteudo .kpi-valor")].map(k => k.textContent), ids: [...document.querySelectorAll(".verificacao")].map(v => v.dataset.status + ":" + v.querySelector("strong").textContent.trim())})'));
  assert(mg.kpis[0] === '96' && mg.kpis[1] === '96', `Votos da urna anterior somados: ${mg.kpis[0]} no log, ${mg.kpis[1]} no boletim`);
  assert(mg.ids.some(t => t.startsWith('info:Troca de urna')) && !mg.ids.some(t => t.startsWith('atencao')), 'Troca de urna aparece como informação e tudo confere');
  await avaliar('document.querySelector(".sidebar-nav-item[data-tab=tabEventos]").click()'); await esperar(200);
  assert(await avaliar('filtroOrigem.options.length') === 2 && !await avaliar('filtroOrigem.disabled'), 'Eventos permitem abrir o log interno da urna anterior');
  await avaliar('document.querySelector(".sidebar-nav-item[data-tab=tabUrna]").click()'); await esperar(200);
  await capturar('4-urna-mg');

  console.log('\n4. Busca no site do TSE (precisa de internet)');
  let online = false;
  try { online = (await fetch('https://resultados.tse.jus.br/oficial/comum/config/ele-c.json', { signal: AbortSignal.timeout(5000) })).ok; } catch { online = false; }
  if (online) {
    await abrir(`${base}#secao=3220/SP/71072/0001/0001`);
    assert(await ate('/São Paulo/.test(document.querySelector("#urnaConteudo h2")?.textContent || "")', 30000), `Endereço #secao= baixa a seção do TSE: ${await textoDe('#urnaConteudo h2')}`);
    const sp = JSON.parse(await avaliar('JSON.stringify([...document.querySelectorAll("#urnaConteudo .kpi-valor")].map(k => k.textContent))'));
    assert(sp[0] === sp[1] && /^\d+$/.test(sp[0]), `1º turno em SP: log ${sp[0]} × boletim ${sp[1]}`);
    assert(await avaliar('document.querySelectorAll(".boletim-cargo").length') >= 5, 'Boletim do 1º turno traz todos os cargos');
    await avaliar('selUf.value = "RR"; selUf.dispatchEvent(new Event("change"))');
    assert(await ate('selMunicipio.options.length > 10'), 'Lista de municípios de RR vem do TSE');

    // Eventos: escolher turno, estado, município, zona e seção na própria aba
    await avaliar('document.querySelector(".sidebar-nav-item[data-tab=tabEventos]").click()'); await esperar(200);
    await avaliar('evPleito.value = "3220"; evUf.value = "RR"; evUf.dispatchEvent(new Event("change"))');
    assert(await ate('evMunicipio.options.length > 10'), 'Eventos: lista de municípios do TSE');
    await avaliar('evMunicipio.value = "03000"; evMunicipio.dispatchEvent(new Event("change")); evZona.value = "0004"; evZona.dispatchEvent(new Event("change")); evSecao.value = "0011"; evSecao.dispatchEvent(new Event("change")); formEventos.requestSubmit()');
    assert(await ate('document.querySelector(".tab-pane.active").id === "tabEventos" && corpoEventos.children.length > 0 && (filtroDia.selectedOptions[0]?.textContent || "").includes("1º turno · 04/10/2026")', 30000),
      `Eventos carrega a seção escolhida no 1º turno: ${await avaliar('filtroDia.selectedOptions[0]?.textContent')}`);
    assert(await avaliar('[...filtroDia.options].some(o => o.textContent.includes("preparação"))'), 'Seletor de dia mostra também os dias de preparação da urna');

    // Locais e zonas: endereço e logs das urnas de um local
    await avaliar('document.querySelector(".sidebar-nav-item[data-tab=tabLocais]").click()'); await esperar(200);
    await avaliar('locUf.value = "RR"; locUf.dispatchEvent(new Event("change"))');
    assert(await ate('locMun.options.length > 10'), 'Locais: municípios de RR');
    await avaliar('locMun.value = "03000"; locMun.dispatchEvent(new Event("change")); locZona.value = "4"; locZona.dispatchEvent(new Event("change"))');
    assert(await ate('document.querySelectorAll(".lista-locais .local").length > 0'), `Locais da zona 4 de Caroebe: ${await avaliar('document.querySelectorAll(".lista-locais .local").length')}`);
    const end = JSON.parse(await avaliar('JSON.stringify([...document.querySelector(".lista-locais .local .endereco").querySelectorAll("dt")].map(d => d.textContent))'));
    assert(['Rua', 'Número', 'Bairro', 'CEP'].every(c => end.includes(c)), `Endereço separado: ${end.join(', ')}`);
    await avaliar('document.querySelector("[data-acao=logs-local]").click()');
    assert(await ate('document.querySelectorAll(".secao-log dl.numeros-log").length > 0 && !document.querySelector(".secao-log.carregando")', 60000), 'Logs das urnas do local baixados e resumidos');
    assert(await avaliar('document.querySelector(".secao-log details summary").textContent.includes("O que tinha no log")'), 'Cada urna mostra o que tinha no log (alertas, erros, linha do tempo)');
  } else {
    console.log('  [PULADO] sem acesso a resultados.tse.jus.br');
  }

  if (pacote) {
    console.log('\n5. Pacote de uma UF inteira');
    await abrir();
    const { root } = (await cdp('DOM.getDocument')).result;
    const { nodeId } = (await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '#inputArquivos' })).result;
    await cdp('DOM.setFileInputFiles', { nodeId, files: [pacote] });
    assert(await ate('document.querySelector(".tab-pane.active").id === "tabPacote" && !!document.querySelector("[data-acao=conferir]")', 30000), 'Pacote abre a aba Urnas de uma UF');
    const inicio = Date.now();
    await avaliar('document.querySelector("[data-acao=conferir]").click()');
    assert(await ate('/Concluído/.test(document.querySelector("#pacoteConteudo .status-linha")?.textContent || "")', 600000), `Conferência terminou em ${Math.round((Date.now() - inicio) / 1000)} s`);
    const res = JSON.parse(await avaliar('JSON.stringify([...document.querySelectorAll("#pacoteConteudo .kpi-valor")].map(k => k.textContent))'));
    console.log(`     urnas ${res[0]} · votos no log ${res[1]} · boletins ${res[2]} · diferença ${res[3]} · pontos para olhar ${res[4]} · trocas ${res[5]}`);
    assert(res[3] === '0' && res[4] === '0', 'Em todas as urnas o log confere com o boletim');
    await avaliar('document.querySelector("[data-acao=filtro-troca]").click()'); await esperar(300);
    await avaliar('document.querySelector("#pacoteConteudo tr[data-chave]")?.click()');
    assert(await ate('document.querySelector(".tab-pane.active").id === "tabUrna"'), 'Linha da lista abre a urna');
    await avaliar('document.querySelector(".sidebar-nav-item[data-tab=tabPacote]").click()'); await esperar(300);
    await capturar('5-pacote');
  }

  console.log('\n6. Celular (390 px)');
  await abrir();
  await tela(390, true, 844);
  await abrir();
  await avaliar('document.querySelector("[data-exemplo=rr]").click()');
  await ate('!!document.querySelector(".verificacao")');
  const cel = JSON.parse(await avaliar('JSON.stringify({barra: getComputedStyle(appBottomNav).display, rolagem: document.documentElement.scrollWidth > innerWidth})'));
  assert(cel.barra !== 'none' && !cel.rolagem, 'Barra inferior visível e sem rolagem lateral');
  await capturar('6-celular-urna');
  await tela(390, true, 844);
  await avaliar('document.querySelector(".bottom-nav-item[data-tab=tabEventos]").click()'); await esperar(300);
  assert(await avaliar('document.documentElement.scrollWidth > innerWidth') === false, 'Eventos sem rolagem lateral no celular');
  await capturar('7-celular-eventos');

  assert(erros.length === 0, `Sem erros de JavaScript${erros.length ? `: ${erros.join(' | ')}` : ''}`);
} catch (e) {
  falhou++;
  console.error(`  [FAIL] o teste parou: ${e.stack || e}`);
} finally {
  console.log(`\n${passou} passaram, ${falhou} falharam`);
  chrome.kill();
  servidor.close();
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
  process.exit(falhou ? 1 : 0);
}
