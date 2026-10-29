/**
 * Service Worker da Auditoria das Urnas (PWA) — mesma estratégia do 8.1. ELEICOES
 * - Pré-carrega o "app shell" para abrir offline.
 * - Páginas (navegação): rede primeiro; sem rede, abre o index.html do cache.
 * - Demais arquivos do próprio site: responde do cache e atualiza em segundo plano (stale-while-revalidate).
 * - Arquivos do site de resultados do TSE (outro domínio) não passam pelo cache: são sempre os publicados.
 * Zero telemetria. CACHE_VERSION e APP_SHELL são gerados por scripts/versionar.mjs: não edite à mão.
 */
// <versionar>
const CACHE_VERSION = 'urnas-20261029-1825';
const APP_SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/app-icon-32.png",
  "icons/app-icon-192.png",
  "icons/apple-touch-icon.png",
  "css/fonts.css?v=20261029-1825",
  "vendor/stk-gov/stk-gov.css?v=20261029-1825",
  "css/style.css?v=20261029-1825",
  "icons/app-icon-64.png",
  "src/Program.js?v=20261029-1825",
  "src/application/AuditoriaService.js?v=20261029-1825",
  "src/domain/BoletimUrna.js?v=20261029-1825",
  "src/domain/BuDat.js?v=20261029-1825",
  "src/domain/Endereco.js?v=20261029-1825",
  "src/domain/LogUrna.js?v=20261029-1825",
  "src/domain/Metricas.js?v=20261029-1825",
  "src/domain/Rdv.js?v=20261029-1825",
  "src/domain/Verificacoes.js?v=20261029-1825",
  "src/infrastructure/LocaisGateway.js?v=20261029-1825",
  "src/infrastructure/PainelGateway.js?v=20261029-1825",
  "src/infrastructure/TseResultadosGateway.js?v=20261029-1825",
  "src/infrastructure/VarreduraWorker.js?v=20261029-1825",
  "src/infrastructure/XlsxWriter.js?v=20261029-1825",
  "src/infrastructure/ZipLeitor.js?v=20261029-1825",
  "src/ui/ComoLerView.js?v=20261029-1825",
  "src/ui/EventosView.js?v=20261029-1825",
  "src/ui/Formato.js?v=20261029-1825",
  "src/ui/Icones.js?v=20261029-1825",
  "src/ui/LocaisView.js?v=20261029-1825",
  "src/ui/PacoteView.js?v=20261029-1825",
  "src/ui/PanoramaView.js?v=20261029-1825",
  "src/ui/Relatorios.js?v=20261029-1825",
  "src/ui/SeletorSecao.js?v=20261029-1825",
  "src/ui/TabelasResponsivas.js?v=20261029-1825",
  "src/ui/UrnaView.js?v=20261029-1825",
  "vendor/fonts/ibm-plex-mono-latin-400-normal.woff2",
  "vendor/fonts/ibm-plex-mono-latin-500-normal.woff2",
  "vendor/fonts/ibm-plex-mono-latin-600-normal.woff2",
  "vendor/fonts/inter-latin-400-normal.woff2",
  "vendor/fonts/inter-latin-500-normal.woff2",
  "vendor/fonts/inter-latin-600-normal.woff2",
  "vendor/fonts/inter-latin-700-normal.woff2",
  "vendor/fonts/space-grotesk-latin-ext.woff2",
  "vendor/fonts/space-grotesk-latin.woff2",
  "vendor/stk-gov/stk-gov-shell.js?v=20261029-1825",
  "vendor/stk-gov/stk-gov-pwa.js?v=20261029-1825",
  "icons/app-icon-512.png"
];
// </versionar>

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('urnas-') && k !== CACHE_VERSION).map(k => caches.delete(k)))) // só os caches deste app: o site tem dois apps
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegação: rede primeiro (HTML sempre atual); sem rede, abre o index.html do shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('index.html', { cacheName: CACHE_VERSION }))
    );
    return;
  }

  // Panorama: rede primeiro (a conferência das UFs é atualizada), cache só sem rede
  if (url.pathname.includes('/data/panorama/')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(cache => fetch(request)
        .then(response => { if (response.ok) cache.put(request, response.clone()); return response; })
        .catch(() => cache.match(request)))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then(async cache => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
