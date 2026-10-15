import { notFound, redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";
import { BotaoImprimir } from "@/app/imprimir/BotaoImprimir";
import { DocumentoPedido, carregarPedidos } from "@/app/imprimir/DocumentoPedido";

export const metadata = { title: "Imprimir pedido" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sessao = await obterSessao();
  if (!sessao || !pode(sessao, "vendas")) redirect("/sem-acesso");
  const supabase = await criarClienteServidor();
  const { lista, empresa } = await carregarPedidos(supabase, [id], sessao.empresaId);
  if (!lista.length) notFound();
  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[13px] text-black print:p-0">
      <div className="mb-4 flex justify-end print:hidden"><BotaoImprimir /></div>
      <DocumentoPedido dados={lista[0]} empresa={empresa} />
    </div>
  );
}
