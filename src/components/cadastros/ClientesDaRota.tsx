"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Card, Select, Vazio } from "@/components/ui";

type Cliente = { id: string; razao_social: string; nome_fantasia: string | null; ordem_visita: number | null; rota_id: string | null };

// Clientes ligados à rota, na ordem de visita. Reordenar grava ordem_visita.
export function ClientesDaRota({ id }: { id: string }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [semRota, setSemRota] = useState<Cliente[]>([]);
  const [escolhido, setEscolhido] = useState("");

  const carregar = useCallback(async () => {
    const [{ data: daRota }, { data: livres }] = await Promise.all([
      supabase.from("pessoas").select("id, razao_social, nome_fantasia, ordem_visita, rota_id").eq("rota_id", id).eq("ativo", true)
        .order("ordem_visita", { nullsFirst: false }).order("razao_social"),
      supabase.from("pessoas").select("id, razao_social, nome_fantasia, ordem_visita, rota_id").eq("eh_cliente", true).eq("ativo", true)
        .is("rota_id", null).order("razao_social").limit(1000),
    ]);
    setClientes((daRota ?? []) as Cliente[]);
    setSemRota((livres ?? []) as Cliente[]);
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function gravarOrdem(lista: Cliente[]) {
    setClientes(lista);
    const r = await Promise.all(lista.map((c, i) => supabase.from("pessoas").update({ ordem_visita: i + 1 }).eq("id", c.id)));
    if (r.some((x) => x.error)) toast.error("Não foi possível salvar a ordem");
  }

  function mover(i: number, d: -1 | 1) {
    const l = [...clientes];
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    gravarOrdem(l);
  }

  async function adicionar() {
    if (!escolhido) return;
    const { error } = await supabase.from("pessoas").update({ rota_id: id, ordem_visita: clientes.length + 1 }).eq("id", escolhido);
    if (error) return toast.error(error.message);
    setEscolhido("");
    carregar();
  }

  async function retirar(c: Cliente) {
    const { error } = await supabase.from("pessoas").update({ rota_id: null, ordem_visita: null }).eq("id", c.id);
    if (error) return toast.error(error.message);
    carregar();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="mr-auto text-sm font-medium">Ordem de visita <span className="text-muted">({clientes.length} clientes)</span></div>
        <Select value={escolhido} onChange={(e) => setEscolhido(e.target.value)} className="h-8 w-72 max-w-full" aria-label="Cliente sem rota">
          <option value="">Adicionar cliente sem rota...</option>
          {semRota.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>)}
        </Select>
        <Button tamanho="p" variante="primario" onClick={adicionar} disabled={!escolhido}><Plus size={14} /> Adicionar</Button>
      </div>
      {clientes.length === 0 ? (
        <Vazio titulo="Nenhum cliente nesta rota" texto="Adicione clientes acima ou defina a rota no cadastro de cada cliente." />
      ) : (
        <ol className="divide-y divide-line/70">
          {clientes.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="tabular w-7 text-right text-muted">{i + 1}</span>
              <Link href={`/cadastros/pessoas/${c.id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                {c.nome_fantasia || c.razao_social}
                {c.nome_fantasia && <span className="ml-2 text-xs text-muted">{c.razao_social}</span>}
              </Link>
              <Button tamanho="p" variante="fantasma" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir"><ArrowUp size={14} /></Button>
              <Button tamanho="p" variante="fantasma" onClick={() => mover(i, 1)} disabled={i === clientes.length - 1} aria-label="Descer"><ArrowDown size={14} /></Button>
              <Button tamanho="p" variante="fantasma" onClick={() => retirar(c)} aria-label="Tirar da rota"><X size={14} /></Button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
