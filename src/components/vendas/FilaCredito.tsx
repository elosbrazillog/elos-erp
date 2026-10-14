"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Cabecalho, Card, Label, Textarea, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";

type Pedido = {
  id: string; numero: number; data_emissao: string; cliente_id: string; cliente_codigo: number; cliente_nome: string; cliente_fantasia: string | null;
  vendedor_nome: string | null; valor_total: number; motivo_trava: string | null; qtd_itens: number;
};
type Credito = { pessoa_id: string; limite_credito: number; em_aberto: number; em_atraso: number };

/** Pedidos travados por limite, atraso ou bloqueio, para o financeiro decidir */
export function FilaCredito({ podeLiberar }: { podeLiberar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [credito, setCredito] = useState<Map<string, Credito>>(new Map());
  const [recusando, setRecusando] = useState<Pedido | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("vw_pedidos").select("*").eq("status", "aguardando_credito").eq("ativo", true).order("data_emissao");
    if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
    const ps = (data ?? []) as Pedido[];
    setPedidos(ps);
    const ids = [...new Set(ps.map((p) => p.cliente_id))];
    if (ids.length) {
      const c = await supabase.from("vw_credito_clientes").select("pessoa_id, limite_credito, em_aberto, em_atraso").in("pessoa_id", ids);
      if (!c.error) setCredito(new Map(((c.data ?? []) as Credito[]).map((x) => [x.pessoa_id, x])));
    }
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  async function liberar(p: Pedido) {
    setOcupado(p.id);
    const { error } = await supabase.rpc("pedido_liberar_credito", { p_pedido: p.id });
    setOcupado(null);
    if (error) return toast.error("Não foi possível liberar", { description: mensagemErro(error) });
    toast.success(`Pedido ${p.numero} liberado`);
    carregar();
  }

  async function recusar() {
    if (!recusando) return;
    if (!motivo.trim()) return toast.error("Informe o motivo");
    setOcupado(recusando.id);
    const { error } = await supabase.rpc("pedido_recusar_credito", { p_pedido: recusando.id, p_motivo: motivo });
    setOcupado(null);
    if (error) return toast.error("Não foi possível recusar", { description: mensagemErro(error) });
    toast.success(`Pedido ${recusando.numero} recusado e cancelado`);
    setRecusando(null);
    setMotivo("");
    carregar();
  }

  const total = (pedidos ?? []).reduce((a, p) => a + Number(p.valor_total), 0);

  return (
    <>
      <Cabecalho trilha="Vendas" titulo="Aprovação de crédito" />
      {pedidos && pedidos.length > 0 && (
        <p className="mb-3 text-sm text-muted">
          {pedidos.length} {pedidos.length === 1 ? "pedido aguardando" : "pedidos aguardando"} · {formatarMoeda(total)}. O estoque desses pedidos já está reservado.
          {!podeLiberar && " Só o financeiro pode liberar ou recusar."}
        </p>
      )}
      {pedidos === null && <div className="py-10 text-center text-sm text-muted">Carregando...</div>}
      {pedidos?.length === 0 && <Card><Vazio titulo="Nenhum pedido travado" texto="Pedidos de clientes bloqueados, com título vencido ou acima do limite aparecem aqui." /></Card>}

      <div className="space-y-3">
        {pedidos?.map((p) => {
          const c = credito.get(p.cliente_id);
          const limite = c ? Number(c.limite_credito) : 0;
          return (
            <Card key={p.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/vendas/pedidos/${p.id}`} className="font-medium hover:text-accent">
                    Pedido {p.numero} · {p.cliente_fantasia || p.cliente_nome}
                  </Link>
                  <div className="text-xs text-muted">
                    Código {p.cliente_codigo} · {formatarData(p.data_emissao)} · {p.qtd_itens} {Number(p.qtd_itens) === 1 ? "item" : "itens"}
                    {p.vendedor_nome && ` · ${p.vendedor_nome}`}
                  </div>
                  <div className="mt-2 text-sm text-warn">{p.motivo_trava}</div>
                </div>
                <div className="text-right">
                  <div className="tabular text-lg font-semibold">{formatarMoeda(p.valor_total)}</div>
                  {podeLiberar && (
                    <div className="mt-2 flex gap-2">
                      <Button tamanho="p" variante="perigo" disabled={ocupado === p.id} onClick={() => { setMotivo(""); setRecusando(p); }}><XCircle size={15} /> Recusar</Button>
                      <Button tamanho="p" variante="primario" disabled={ocupado === p.id} onClick={() => liberar(p)}><CheckCircle2 size={15} /> Liberar</Button>
                    </div>
                  )}
                </div>
              </div>
              {c && (
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs sm:grid-cols-4">
                  {[
                    ["Limite", limite > 0 ? formatarMoeda(limite) : "Sem limite", false],
                    ["Em aberto", formatarMoeda(c.em_aberto), false],
                    ["Em atraso", formatarMoeda(c.em_atraso), Number(c.em_atraso) > 0],
                    ["Disponível", limite > 0 ? formatarMoeda(limite - Number(c.em_aberto)) : "—", limite > 0 && limite - Number(c.em_aberto) < Number(p.valor_total)],
                  ].map(([r, v, alerta]) => (
                    <div key={String(r)}>
                      <div className="text-muted">{r}</div>
                      <div className={cn("tabular text-sm font-medium", alerta && "text-bad")}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Dialogo
        aberto={!!recusando}
        titulo={`Recusar pedido ${recusando?.numero ?? ""}`}
        descricao="O pedido será cancelado e o estoque reservado volta a ficar disponível."
        aoFechar={() => setRecusando(null)}
        rodape={<><Button onClick={() => setRecusando(null)}>Voltar</Button><Button variante="perigo" disabled={!!ocupado} onClick={recusar}>Recusar</Button></>}
      >
        <Label obrigatorio htmlFor="motivo-recusa">Motivo</Label>
        <Textarea id="motivo-recusa" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Dialogo>
    </>
  );
}
