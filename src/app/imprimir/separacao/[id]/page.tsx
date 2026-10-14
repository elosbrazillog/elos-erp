import { notFound, redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";
import { formatarData, formatarNumero } from "@/lib/utils";
import { BotaoImprimir } from "@/app/imprimir/BotaoImprimir";

export const metadata = { title: "Lista de separação" };

type Linha = { deposito_nome: string; produto_codigo: string; produto_nome: string; unidade: string | null; lote_numero: string | null; validade: string | null; quantidade: number };
type Ped = { ordem_entrega: number; pedido_numero: number; cliente_nome: string; cliente_fantasia: string | null; pedido_id: string };
type Item = { pedido_id: string; produto_codigo: string; produto_nome: string; unidade: string | null; quantidade: number };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sessao = await obterSessao();
  if (!sessao || !pode(sessao, "expedicao")) redirect("/sem-acesso");
  const supabase = await criarClienteServidor();
  const [{ data: carga }, { data: linhas }, { data: peds }, { data: itens }] = await Promise.all([
    supabase.from("vw_expedicoes").select("*").eq("id", id).maybeSingle(),
    supabase.from("vw_separacao").select("*").eq("expedicao_id", id).order("deposito_nome").order("produto_nome").order("validade"),
    supabase.from("vw_expedicao_pedidos").select("ordem_entrega, pedido_numero, cliente_nome, cliente_fantasia, pedido_id").eq("expedicao_id", id).order("ordem_entrega"),
    supabase.from("vw_expedicao_itens").select("pedido_id, produto_codigo, produto_nome, unidade, quantidade").eq("expedicao_id", id).order("ordem"),
  ]);
  if (!carga) notFound();
  const ls = (linhas ?? []) as Linha[];
  const total = ls.reduce((a, l) => a + Number(l.quantidade), 0);

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[13px] text-black print:p-0">
      <div className="mb-4 flex justify-end print:hidden"><BotaoImprimir /></div>
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-xl font-bold">Lista de separação</div>
          <div>Carga nº {carga.numero} · saída {formatarData(carga.data)}{carga.rota_nome ? ` · rota ${carga.rota_nome}` : ""}</div>
          <div>Motorista: {carga.motorista_nome ?? "—"}{carga.veiculo_placa ? ` · veículo ${carga.veiculo_placa}` : ""}</div>
        </div>
        <div className="text-right">
          <div>{carga.qtd_pedidos} pedidos</div>
          <div>{formatarNumero(total)} unidades · {formatarNumero(carga.peso_total_kg)} kg</div>
        </div>
      </header>

      <h2 className="mt-4 mb-1 text-[11px] font-semibold uppercase">Separar por lote (vencimento mais próximo primeiro)</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left text-[11px] uppercase">
            <th className="w-6 py-1" />
            <th className="py-1 pr-2">Depósito</th>
            <th className="py-1 pr-2">Código</th>
            <th className="py-1 pr-2">Produto</th>
            <th className="py-1 pr-2">Lote</th>
            <th className="py-1 pr-2">Validade</th>
            <th className="py-1 text-right">Qtd</th>
          </tr>
        </thead>
        <tbody>
          {ls.map((l, k) => (
            <tr key={k} className="border-b border-black/15">
              <td className="py-1.5"><span className="inline-block size-3.5 border border-black" /></td>
              <td className="py-1.5 pr-2">{l.deposito_nome}</td>
              <td className="py-1.5 pr-2">{l.produto_codigo}</td>
              <td className="py-1.5 pr-2">{l.produto_nome}</td>
              <td className="py-1.5 pr-2 font-semibold">{l.lote_numero ?? "—"}</td>
              <td className="py-1.5 pr-2">{formatarData(l.validade)}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{formatarNumero(l.quantidade)} {l.unidade}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 mb-1 text-[11px] font-semibold uppercase">Conferência por pedido (ordem de entrega)</h2>
      <div className="grid grid-cols-2 gap-3">
        {((peds ?? []) as Ped[]).map((p) => (
          <div key={p.pedido_id} className="break-inside-avoid border border-black/30 p-2">
            <div className="font-semibold">{p.ordem_entrega}. {p.cliente_fantasia || p.cliente_nome} <span className="font-normal">· pedido {p.pedido_numero}</span></div>
            <ul>
              {((itens ?? []) as Item[]).filter((i) => i.pedido_id === p.pedido_id).map((i, k) => (
                <li key={k} className="flex justify-between gap-2"><span>{i.produto_codigo} {i.produto_nome}</span><span className="tabular-nums">{formatarNumero(i.quantidade)} {i.unidade}</span></li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <section className="mt-10 grid grid-cols-2 gap-10 text-center text-[11px]">
        <div className="border-t border-black pt-1">Separado por</div>
        <div className="border-t border-black pt-1">Conferido por</div>
      </section>
    </div>
  );
}
