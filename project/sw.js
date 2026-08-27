const SHELL_CACHE = "tickread-shell-v1";
const BANK_CACHE = "tickread-bank-v1";
const APP_SHELL = [
  "./tickread-mobile/",
  "./tickread-mobile/index.html",
  "./tickread-mobile/style.css",
  "./tickread-mobile/manifest.webmanifest",
  "./tickread-mobile/icons/tickread.svg",
  "./tickread-mobile/dist/app.js",
  "./tickread-mobile/dist/m2.js"
];
const BANK_MANIFEST = "./tickread/code/data/manifest.json";

function bankUrl(file) {
  return new URL(`./tickread/code/data/${file}`, self.location).toString();
}

async function refreshBank() {
  const cache = await caches.open(BANK_CACHE);
  const manifestResponse = await fetch(BANK_MANIFEST, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("Question bank is unavailable");
  const manifest = await manifestResponse.clone().json();
  if (!Array.isArray(manifest.shards)) throw new Error("Question bank manifest is invalid");
  await cache.put(BANK_MANIFEST, manifestResponse);
  await Promise.all(manifest.shards.map(async ({ file }) => {
    if (typeof file !== "string") throw new Error("Question bank shard is invalid");
    const response = await fetch(bankUrl(file), { cache: "no-store" });
    if (!response.ok) throw new Error("Question bank shard is unavailable");
    await cache.put(bankUrl(file), response);
  }));
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => client.postMessage("tickread-bank-updated"));
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)),
    refreshBank()
  ]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CHECK_BANK") event.waitUntil(refreshBank().catch(() => undefined));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  const isBank = url.pathname.includes("/tickread/code/data/");
  const cacheName = isBank ? BANK_CACHE : SHELL_CACHE;
  event.respondWith(caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(event.request);
    const network = fetch(event.request).then(async (response) => {
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => undefined));
      return cached;
    }
    return network;
  }));
});
