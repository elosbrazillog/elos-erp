"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Card, Vazio } from "@/components/ui";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { STATUS_PEDIDO, type StatusPedido } from "@/lib/pedidos";

type Antigo = { pedido_codigo: string; data: string | null; total: number; itens: number; vendedor_nome: string | null; forma_pagamento: string | null };
type Pedido = { id: string; numero: number; tipo: string; status: StatusPedido; data_emissao: string; valor_total: number; qtd_itens: number; vendedor_nome: string | null };

/** Aba do cliente: últimos pedidos e orçamentos */
export function HistoricoCliente({ id }: { id: string }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [semPermissao, setSemPermissao] = useState(false);
  const [antigos, setAntigos] = useState<Antigo[]>([]);

  useEffect(() => {
    supabase.from("vw_pedidos").select("id, numero, tipo, status, data_emissao, valor_total, qtd_itens, vendedor_nome")
      .eq("cliente_id", id).eq("ativo", true).order("data_emissao", { ascending: false }).limit(100)
      .then(({ data, error }) => { if (error) setSemPermissao(true); setPedidos((data ?? []) as Pedido[]); });
    supabase.from("vw_historico_pedidos").select("pedido_codigo, data, total, itens, vendedor_nome, forma_pagamento")
      .eq("cliente_id", id).eq("faturado", true).order("data", { ascending: false }).limit(300)
      .then(({ data }) => setAntigos((data ?? []) as Antigo[]));
  }, [supabase, id]);

  if (semPermissao) return <Card><Vazio titulo="Sem acesso a vendas" /></Card>;
  if (!pedidos) return <div className="py-8 text-center text-sm text-muted">Carregando...</div>;
  const validos = pedidos.filter((p) => p.tipo === "pedido" && p.status !== "cancelado" && p.status !== "rascunho");
  const totalAntigo = antigos.reduce((a, p) => a + Number(p.total), 0);
  const total = validos.reduce((a, p) => a + Number(p.valor_total), 0) + totalAntigo;
  const qtd = validos.length + antigos.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          ["Pedidos", String(qtd)],
          ["Total comprado", formatarMoeda(total)],
          ["Ticket médio", qtd ? formatarMoeda(total / qtd) : "—"],
        ].map(([r, v]) => (
          <Card key={r} className="p-4"><div className="text-xs text-muted">{r}</div><div className="tabular mt-1 text-lg font-semibold">{v}</div></Card>
        ))}
      </div>
      <Card>
        {pedidos.length === 0 ? <Vazio titulo={antigos.length ? "Nenhum pedido no Elos ERP ainda" : "Nenhum pedido deste cliente ainda"} /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Nº</th>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Vendedor</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id} className="border-b border-line/70 hover:bg-surface-2/70">
                  <td className="px-3 py-2"><Link href={`/vendas/pedidos/${p.id}`} className="text-accent hover:underline">{p.numero}</Link>{p.tipo === "orcamento" && <span className="ml-1.5"><Badge tom="acento">Orçamento</Badge></span>}</td>
                  <td className="px-3 py-2">{formatarData(p.data_emissao)}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">{p.vendedor_nome}</td>
                  <td className="tabular px-3 py-2 text-right">{formatarMoeda(p.valor_total)}</td>
                  <td className="px-3 py-2"><Badge tom={STATUS_PEDIDO[p.status].tom}>{STATUS_PEDIDO[p.status].rotulo}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {antigos.length > 0 && (
        <Card>
          <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-medium">Sistema anterior (Atende)</span>
            <span className="tabular text-xs text-muted">{antigos.length} pedidos · {formatarMoeda(totalAntigo)}</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {antigos.map((p) => (
                  <tr key={p.pedido_codigo} className="border-b border-line/70">
                    <td className="px-3 py-1.5 text-muted">{p.pedido_codigo}</td>
                    <td className="px-3 py-1.5">{formatarData(p.data)}</td>
                    <td className="hidden px-3 py-1.5 text-xs sm:table-cell">{p.vendedor_nome}</td>
                    <td className="hidden px-3 py-1.5 text-xs text-muted sm:table-cell">{p.forma_pagamento}</td>
                    <td className="tabular px-3 py-1.5 text-right">{formatarMoeda(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
