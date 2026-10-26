// Service worker: guarda os arquivos do app no primeiro acesso para ele abrir sem internet.
// Ao publicar qualquer mudança de código, aumente VERSAO: o celular baixa tudo de novo na próxima abertura.
// Mudanças só no config.js não precisam disso (ele é importado abaixo e o navegador percebe sozinho).

var VERSAO = '3';
var CACHE = 'leads-' + VERSAO;

importScripts('config.js');

var ARQUIVOS = [
  './',
  'index.html',
  'config.js',
  'manifest.json',
  'css/style.css',
  'js/core.js',
  'js/scanner.js',
  'js/storage.js',
  'js/sync.js',
  'js/app.js',
  'vendor/html5-qrcode.min.js',
  'fonts/rajdhani-300.woff2',
  'fonts/rajdhani-700.woff2',
  'fonts/montserrat.woff2',
  'img/logo-ceia.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

// Imagens dos QRs vêm do config.js. Uma imagem faltando não impede o resto de funcionar offline.
var IMAGENS_QR = Object.keys(self.APP_CONFIG.proximosPassos).map(function (chave) {
  return self.APP_CONFIG.proximosPassos[chave].imagem;
});

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // cache: 'reload' ignora o cache HTTP do GitHub Pages (10 min) e pega a versão publicada agora.
      var essenciais = cache.addAll(ARQUIVOS.map(function (arquivo) {
        return new Request(arquivo, { cache: 'reload' });
      }));
      var qrs = Promise.all(IMAGENS_QR.map(function (imagem) {
        return cache.add(new Request(imagem, { cache: 'reload' })).catch(function () {});
      }));
      return Promise.all([essenciais, qrs]);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Apaga os caches de versões anteriores.
self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (nome) {
        return nome.indexOf('leads-') === 0 && nome !== CACHE;
      }).map(function (nome) {
        return caches.delete(nome);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Arquivos do app: do cache primeiro (abre na hora, com ou sem sinal).
// Envios para a planilha (POST, outro domínio) passam direto, sem o service worker.
self.addEventListener('fetch', function (evento) {
  var pedido = evento.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;
  evento.respondWith(
    caches.open(CACHE).then(function (cache) {
      // Abrir o app com "?algo" no endereço ainda cai na página guardada.
      return cache.match(pedido, { ignoreSearch: pedido.mode === 'navigate' }).then(function (guardado) {
        return guardado || fetch(pedido);
      });
    })
  );
});
