import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";
import { formatarMoeda } from "@/lib/utils";
import { BotaoImprimir } from "@/app/imprimir/BotaoImprimir";
import { DocumentoPedido, carregarPedidos } from "@/app/imprimir/DocumentoPedido";

export const metadata = { title: "Imprimir pedidos" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function Page({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const sp = await searchParams;
  const sessao = await obterSessao();
  if (!sessao || !pode(sessao, "vendas")) redirect("/sem-acesso");
  const ids = [...new Set((sp.ids ?? "").split(",").filter((x) => UUID.test(x)))].slice(0, 150);
  const supabase = await criarClienteServidor();
  const { lista, empresa } = ids.length ? await carregarPedidos(supabase, ids, sessao.empresaId) : { lista: [], empresa: null };
  const total = lista.reduce((a, d) => a + Number(d.p.valor_total), 0);
  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[13px] text-black print:p-0">
      <style>{`@media print { @page { size: A4; margin: 10mm; } .documento-pedido + .documento-pedido { break-before: page; } } .documento-pedido + .documento-pedido { margin-top: 2.5rem; padding-top: 2.5rem; border-top: 2px dashed #999; } @media print { .documento-pedido + .documento-pedido { margin-top: 0; padding-top: 0; border-top: 0; } }`}</style>
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <span>{lista.length} {lista.length === 1 ? "pedido" : "pedidos"} · {formatarMoeda(total)} · um por página</span>
        {lista.length > 0 && <BotaoImprimir />}
      </div>
      {lista.length === 0 && <p>Nenhum pedido para imprimir.</p>}
      {lista.map((d) => <DocumentoPedido key={d.p.id} dados={d} empresa={empresa} />)}
    </div>
  );
}
