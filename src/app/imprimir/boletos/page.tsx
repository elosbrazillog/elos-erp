import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { EXEMPLO, FichaBoleto, type Boleto } from "@/components/fiscal/FichaBoleto";
import { BotaoImprimir } from "@/app/imprimir/BotaoImprimir";

export const metadata = { title: "Boletos" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function Page({ searchParams }: { searchParams: Promise<{ pedidos?: string; exemplo?: string }> }) {
  const sp = await searchParams;
  const sessao = await obterSessao();
  if (!sessao || !(pode(sessao, "financeiro") || pode(sessao, "fiscal") || pode(sessao, "vendas"))) redirect("/sem-acesso");
  const supabase = await criarClienteServidor();

  if (sp.exemplo) {
    const { data: em } = await supabase.from("empresas").select("razao_social, cnpj").eq("id", sessao.empresaId).maybeSingle();
    const b = { ...EXEMPLO, beneficiario_nome: em?.razao_social ?? "", beneficiario_cnpj: em?.cnpj ?? "" };
    return (
      <div className="mx-auto max-w-[190mm] bg-white p-6 text-black print:p-0">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <p className="text-sm">Modelo de impressão. Os números são fictícios: este documento não pode ser pago.</p>
          <BotaoImprimir automatico={false} />
        </div>
        <FichaBoleto b={b} exemplo />
      </div>
    );
  }

  const ids = (sp.pedidos ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 150);
  const { data } = ids.length
    ? await supabase.from("vw_boletos").select("*").in("pedido_id", ids).neq("status", "cancelado").order("pedido_numero").order("parcela")
    : { data: [] };
  const todos = (data ?? []) as Boleto[];
  const abertos = todos.filter((b) => !b.data_quitacao);
  const prontos = abertos.filter((b) => b.status === "registrado" && b.linha_digitavel && b.codigo_barras);
  const pendentes = abertos.filter((b) => !prontos.includes(b));
  const pagos = todos.length - abertos.length;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-6 text-black print:p-0">
      <style>{`@media print { @page { size: A4; margin: 10mm; } .boleto { page-break-inside: avoid; } .boleto:nth-of-type(2n) { page-break-after: always; } }`}</style>
      <div className="mb-4 space-y-2 print:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <b>{prontos.length}</b> {prontos.length === 1 ? "boleto pronto" : "boletos prontos"} para imprimir
            {pagos > 0 && <> · {pagos} já {pagos === 1 ? "pago" : "pagos"}</>}
          </div>
          {prontos.length > 0 && <BotaoImprimir automatico />}
        </div>
        {pendentes.length > 0 && (
          <div className="rounded border border-amber-500 bg-amber-50 p-3 text-sm">
            <b>{pendentes.length} {pendentes.length === 1 ? "boleto ainda não foi registrado" : "boletos ainda não foram registrados"} no Sicredi</b> e não {pendentes.length === 1 ? "é impresso" : "são impressos"}:
            boleto sem registro é recusado pelo banco na hora do pagamento. O registro automático entra quando a API de Cobrança do Sicredi for liberada para a Elos.
            <ul className="mt-1.5 list-disc pl-5 text-xs">
              {pendentes.slice(0, 30).map((b) => (
                <li key={b.id}>
                  Pedido {b.pedido_numero} · {b.pagador_nome} · {formatarMoeda(b.valor)} · vence {formatarData(b.data_vencimento)}
                  {b.total_parcelas > 1 ? ` · parcela ${b.parcela}/${b.total_parcelas}` : ""}
                  {!b.conta_nome ? " · sem conta Sicredi marcada para emitir boleto" : ""}
                  {b.erro ? ` · ${b.erro}` : ""}
                </li>
              ))}
              {pendentes.length > 30 && <li>e mais {pendentes.length - 30}</li>}
            </ul>
            <a href="/imprimir/boletos?exemplo=1" className="mt-2 inline-block text-xs underline">Ver o modelo de impressão</a>
          </div>
        )}
        {todos.length === 0 && <p className="text-sm">Nenhum boleto para os pedidos selecionados.</p>}
      </div>
      {prontos.map((b) => <FichaBoleto key={b.id} b={b} />)}
    </div>
  );
}
