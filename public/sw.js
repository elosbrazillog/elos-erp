// Service worker do Elos: guarda o app do vendedor e a tela de entregas para abrir sem sinal.
// Telas: tenta a rede (até 4 s) e, sem resposta, usa a última cópia. Arquivos do Next: cache primeiro.
const VERSAO = "elos-v1";
const TELAS = ["/app", "/expedicao/entregas"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSAO) await caches.delete(k);
    await self.clients.claim();
  })());
});

function comTempo(promessa, ms) {
  return new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error("tempo")), ms);
    promessa.then((r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); falha(e); });
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const estatico = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icones/") || url.pathname.endsWith(".webmanifest") || url.pathname === "/icone.svg";
  if (estatico) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSAO);
      const salvo = await cache.match(req);
      if (salvo) return salvo;
      const resp = await fetch(req);
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    })());
    return;
  }

  const tela = req.mode === "navigate" && TELAS.some((t) => url.pathname === t || url.pathname.startsWith(t + "/"));
  if (tela) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSAO);
      const chave = url.pathname;
      try {
        const resp = await comTempo(fetch(req), 4000);
        if (resp.ok && !resp.redirected) cache.put(chave, resp.clone());
        return resp;
      } catch {
        const salvo = await cache.match(chave);
        if (salvo) return salvo;
        return new Response("<meta charset=utf-8><body style='font-family:sans-serif;padding:24px'>Sem sinal e esta tela ainda não foi aberta neste aparelho. Abra uma vez com internet.</body>", { headers: { "content-type": "text/html; charset=utf-8" } });
      }
    })());
  }
});
