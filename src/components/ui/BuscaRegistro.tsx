"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Resultado = { id: string; rotulo: string; detalhe?: string; aviso?: string };

/**
 * Campo de busca com lista de resultados (cliente, produto...).
 * Navega com setas, Enter escolhe, Esc fecha.
 */
export function BuscaRegistro({
  buscar, aoEscolher, placeholder, selecionado, aoLimpar, autoFocus, desabilitado, id,
}: {
  buscar: (termo: string) => Promise<Resultado[]>;
  aoEscolher: (r: Resultado) => void;
  placeholder?: string;
  selecionado?: Resultado | null;
  aoLimpar?: () => void;
  autoFocus?: boolean;
  desabilitado?: boolean;
  id?: string;
}) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Resultado[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const seq = useRef(0);
  const listaId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const n = ++seq.current;
    setBuscando(true);
    const t = setTimeout(async () => {
      const r = await buscar(termo.trim());
      if (n !== seq.current) return;
      setLista(r);
      setAtivo(0);
      setBuscando(false);
    }, 200);
    return () => clearTimeout(t);
  }, [termo, aberto, buscar]);

  function escolher(r: Resultado) {
    aoEscolher(r);
    setTermo("");
    setAberto(false);
  }

  if (selecionado) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface-2/50 px-2.5 text-sm">
        <span className="min-w-0 flex-1 truncate">
          {selecionado.rotulo}
          {selecionado.detalhe && <span className="ml-2 text-xs text-muted">{selecionado.detalhe}</span>}
        </span>
        {aoLimpar && !desabilitado && (
          <button type="button" onClick={aoLimpar} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Trocar">
            <X size={16} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={aberto}
        aria-controls={listaId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        disabled={desabilitado}
        value={termo}
        placeholder={placeholder}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((a) => Math.min(a + 1, lista.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && lista[ativo]) { e.preventDefault(); escolher(lista[ativo]); }
          else if (e.key === "Escape") setAberto(false);
        }}
        className="h-9 w-full min-w-0 rounded-md border border-line bg-surface pr-2.5 pl-8 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:bg-surface-2"
      />
      {aberto && (
        <ul id={listaId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {lista.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => { e.preventDefault(); escolher(r); }}
              onMouseEnter={() => setAtivo(i)}
              className={cn("cursor-pointer px-3 py-2 text-sm", i === ativo && "bg-accent-soft")}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{r.rotulo}</span>
                {r.aviso && <span className="shrink-0 text-xs text-warn">{r.aviso}</span>}
              </div>
              {r.detalhe && <div className="truncate text-xs text-muted">{r.detalhe}</div>}
            </li>
          ))}
          {!buscando && lista.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nada encontrado</li>}
          {buscando && lista.length === 0 && <li className="px-3 py-2 text-sm text-muted">Buscando...</li>}
        </ul>
      )}
    </div>
  );
}
