// Roteirização simples e local: vizinho mais próximo a partir do ponto de saída,
// melhorada com 2-opt. Distância em linha reta (haversine) — boa para ordenar
// paradas dentro da cidade; o motorista segue o GPS para o caminho exato.

export type Ponto = { id: string; lat: number; lng: number };

export function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Comprimento do percurso saindo da origem e passando pelos pontos na ordem dada (sem voltar) */
export function percursoKm(origem: { lat: number; lng: number }, pontos: Ponto[]) {
  let total = 0, atual = origem;
  for (const p of pontos) { total += distanciaKm(atual, p); atual = p; }
  return total;
}

export function roteirizar(origem: { lat: number; lng: number }, pontos: Ponto[]): Ponto[] {
  if (pontos.length < 2) return [...pontos];
  // vizinho mais próximo
  const resto = [...pontos];
  const rota: Ponto[] = [];
  let atual: { lat: number; lng: number } = origem;
  while (resto.length) {
    let melhor = 0, menor = Infinity;
    resto.forEach((p, i) => { const d = distanciaKm(atual, p); if (d < menor) { menor = d; melhor = i; } });
    const [p] = resto.splice(melhor, 1);
    rota.push(p);
    atual = p;
  }
  // 2-opt: inverte trechos enquanto encurtar o percurso
  const todos = [{ id: "__origem", ...origem }, ...rota];
  const d = (i: number, j: number) => distanciaKm(todos[i], todos[j]);
  let melhorou = true, voltas = 0;
  while (melhorou && voltas++ < 200) {
    melhorou = false;
    for (let i = 1; i < todos.length - 1; i++) {
      for (let k = i + 1; k < todos.length; k++) {
        const antes = d(i - 1, i) + (k + 1 < todos.length ? d(k, k + 1) : 0);
        const depois = d(i - 1, k) + (k + 1 < todos.length ? d(i, k + 1) : 0);
        if (depois + 1e-9 < antes) {
          const trecho = todos.slice(i, k + 1).reverse();
          todos.splice(i, trecho.length, ...trecho);
          melhorou = true;
        }
      }
    }
  }
  return todos.slice(1) as Ponto[];
}

/** Coordenada aproximada pelo endereço (OpenStreetMap / Nominatim). Use no máximo 1 por segundo. */
export async function geocodificar(e: { logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null }) {
  const rua = [e.numero, e.logradouro].filter(Boolean).join(" ").trim();
  if (!e.cidade && !e.cep) return null;
  const tentativas: Record<string, string>[] = [];
  if (rua) tentativas.push({ street: rua, city: e.cidade ?? "", state: e.uf ?? "", country: "Brasil" });
  if (e.cep) tentativas.push({ postalcode: e.cep.replace(/\D/g, ""), country: "Brasil" });
  if (e.bairro && e.cidade) tentativas.push({ q: `${e.bairro}, ${e.cidade}, ${e.uf ?? ""}, Brasil` });
  for (let i = 0; i < tentativas.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1100));
    const qs = new URLSearchParams({ format: "json", limit: "1", countrycodes: "br", "accept-language": "pt-BR", ...tentativas[i] });
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`);
      if (!r.ok) continue;
      const j = (await r.json()) as { lat: string; lon: string }[];
      if (j[0]) return { lat: Number(j[0].lat), lng: Number(j[0].lon), aproximado: i > 0 };
    } catch { /* sem rede: tenta a próxima */ }
  }
  return null;
}

export const CENTRO_CAMPO_GRANDE = { lat: -20.4697, lng: -54.6201 };
