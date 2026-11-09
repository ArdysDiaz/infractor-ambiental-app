const CACHE_NAME = "infractor-cache-v2"; // cambia el número en cada despliegue
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png"
];

// Instalar y cachear
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // activa el nuevo SW sin esperar
});

// Activar y limpiar caches antiguas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME) // elimina las que no son la actual
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // controla todas las pestañas activas
});

// Estrategia: cache primero, luego red
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
