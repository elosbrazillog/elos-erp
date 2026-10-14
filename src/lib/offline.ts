// Armazenamento no aparelho (IndexedDB) e fila de envios para trabalhar sem sinal.
// Cada envio vai para a fila; a fila é processada quando há conexão. Os envios
// são idempotentes no servidor (id_local), então repetir não duplica.
import type { SupabaseClient } from "@supabase/supabase-js";

const NOME = "elos";
const VERSAO = 1;

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(NOME, VERSAO);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("fila")) db.createObjectStore("fila", { keyPath: "id" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}

async function operar<T>(loja: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const tx = db.transaction(loja, modo);
    const req = fn(tx.objectStore(loja));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

export const kvGet = <T,>(chave: string) => operar<T | undefined>("kv", "readonly", (s) => s.get(chave) as IDBRequest<T | undefined>).catch(() => undefined);
export const kvSet = (chave: string, valor: unknown) => operar("kv", "readwrite", (s) => s.put(valor, chave)).catch(() => undefined);

export type ItemFila = {
  id: string;
  tipo: "pedido" | "visita" | "entrega" | "posicao";
  rpc: string;
  args: Record<string, unknown>;
  criadoEm: string;
  resumo: Record<string, unknown>;
  erro?: string;
  tentativas: number;
};

export const filaTodos = () => operar<ItemFila[]>("fila", "readonly", (s) => s.getAll() as IDBRequest<ItemFila[]>)
  .then((l) => l.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))).catch(() => [] as ItemFila[]);
export const filaPor = (item: ItemFila) => operar("fila", "readwrite", (s) => s.put(item));
export const filaTirar = (id: string) => operar("fila", "readwrite", (s) => s.delete(id));

export function novoId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const ehFalhaDeRede = (m: string) => /Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test(m);
// Erros que significam "já foi feito" e podem sair da fila
const jaFeito = (m: string) => /já foi registrada|já está quitado/i.test(m);

let rodando = false;
/** Envia o que está na fila, em ordem. Para no primeiro problema de conexão. */
export async function sincronizar(supabase: SupabaseClient, aoEnviar?: (item: ItemFila, resposta: unknown) => void) {
  if (rodando) return { enviados: 0, erros: 0, semRede: false };
  rodando = true;
  let enviados = 0, erros = 0, semRede = false;
  try {
    for (const item of await filaTodos()) {
      if (item.erro) continue; // aguardando decisão do usuário
      if (typeof navigator !== "undefined" && !navigator.onLine) { semRede = true; break; }
      const { data, error } = await supabase.rpc(item.rpc, item.args);
      if (!error || jaFeito(error.message)) {
        await filaTirar(item.id);
        enviados++;
        aoEnviar?.(item, data);
        continue;
      }
      if (ehFalhaDeRede(error.message)) { semRede = true; break; }
      await filaPor({ ...item, erro: error.message, tentativas: item.tentativas + 1 });
      erros++;
    }
  } finally {
    rodando = false;
  }
  return { enviados, erros, semRede };
}

/** Posição atual, sem travar a tela: devolve null se não vier em poucos segundos */
export function posicaoAtual(ms = 4000): Promise<{ lat: number; lng: number; precisao: number } | null> {
  return new Promise((ok) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return ok(null);
    const t = setTimeout(() => ok(null), ms);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); ok({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy }); },
      () => { clearTimeout(t); ok(null); },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: ms },
    );
  });
}

export function registrarServiceWorker() {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
}
