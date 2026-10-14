import { notFound, redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";
import { formatarData, formatarMoeda, formatarNumero, formatarTelefone } from "@/lib/utils";
import { enderecoTexto } from "@/lib/pedidos";
import { BotaoImprimir } from "@/app/imprimir/BotaoImprimir";

export const metadata = { title: "Romaneio" };

type Ped = {
  ordem_entrega: number; pedido_numero: number; cliente_codigo: number; cliente_nome: string; cliente_fantasia: string | null;
  telefone: string | null; valor_total: number; peso_total_kg: number; qtd_itens: number; forma_nome: string | null; condicao_nome: string | null;
  logradouro: string | null; endereco_numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null;
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sessao = await obterSessao();
  if (!sessao || !pode(sessao, "expedicao")) redirect("/sem-acesso");
  const supabase = await criarClienteServidor();
  const [{ data: carga }, { data: peds }, { data: empresa }] = await Promise.all([
    supabase.from("vw_expedicoes").select("*").eq("id", id).maybeSingle(),
    supabase.from("vw_expedicao_pedidos").select("*").eq("expedicao_id", id).order("ordem_entrega"),
    supabase.from("empresas").select("razao_social, nome_fantasia").eq("id", sessao.empresaId).maybeSingle(),
  ]);
  if (!carga) notFound();
  const ps = (peds ?? []) as Ped[];

  return (
    <div className="mx-auto max-w-[900px] bg-white p-8 text-[12px] text-black print:p-0">
      <div className="mb-4 flex justify-end print:hidden"><BotaoImprimir /></div>
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-xl font-bold">Romaneio de carga nº {carga.numero}</div>
          <div>{empresa?.nome_fantasia || empresa?.razao_social}</div>
          <div>Saída {formatarData(carga.data)}{carga.rota_nome ? ` · rota ${carga.rota_nome}` : ""}</div>
        </div>
        <div className="text-right">
          <div>Motorista: <b>{carga.motorista_nome ?? "—"}</b></div>
          <div>Veículo: {carga.veiculo_placa ?? "—"}{carga.veiculo_descricao ? ` (${carga.veiculo_descricao})` : ""}</div>
          <div>{carga.qtd_pedidos} entregas · {formatarNumero(carga.peso_total_kg)} kg · <b>{formatarMoeda(carga.valor_total)}</b></div>
        </div>
      </header>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left text-[10px] uppercase">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Pedido</th>
            <th className="py-1 pr-2">Cliente / endereço</th>
            <th className="py-1 pr-2">Pagamento</th>
            <th className="py-1 pr-2 text-right">Peso</th>
            <th className="py-1 pr-2 text-right">Valor</th>
            <th className="w-32 py-1">Recebido (assinatura)</th>
          </tr>
        </thead>
        <tbody>
          {ps.map((p) => (
            <tr key={p.pedido_numero} className="border-b border-black/20 align-top">
              <td className="py-2 pr-2 font-semibold">{p.ordem_entrega}</td>
              <td className="py-2 pr-2">{p.pedido_numero}</td>
              <td className="py-2 pr-2">
                <div className="font-semibold">{p.cliente_codigo} · {p.cliente_fantasia || p.cliente_nome}</div>
                <div>{enderecoTexto(p)}</div>
                {p.telefone && <div>{formatarTelefone(p.telefone)}</div>}
              </td>
              <td className="py-2 pr-2">{[p.forma_nome, p.condicao_nome].filter(Boolean).join(" ") || "—"}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{formatarNumero(p.peso_total_kg)} kg</td>
              <td className="py-2 pr-2 text-right tabular-nums">{formatarMoeda(p.valor_total)}</td>
              <td className="py-2"><div className="h-8 border-b border-black/50" /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-semibold">
            <td colSpan={4} className="py-2">Total</td>
            <td className="py-2 pr-2 text-right tabular-nums">{formatarNumero(carga.peso_total_kg)} kg</td>
            <td className="py-2 pr-2 text-right tabular-nums">{formatarMoeda(carga.valor_total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <section className="mt-12 grid grid-cols-3 gap-8 text-center text-[11px]">
        <div className="border-t border-black pt-1">Expedição</div>
        <div className="border-t border-black pt-1">Motorista</div>
        <div className="border-t border-black pt-1">Conferência no retorno</div>
      </section>
    </div>
  );
}
