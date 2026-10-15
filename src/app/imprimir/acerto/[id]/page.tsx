import { notFound, redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { BotaoImprimir } from "@/app/imprimir/BotaoImprimir";
import type { Resumo } from "@/components/expedicao/AcertoMotorista";

export const metadata = { title: "Acerto do motorista" };

const SIT: Record<string, string> = { entregue: "Entregue", devolvido_total: "Devolvido", devolvido_parcial: "Dev. parcial", ausente: "Ausente", pendente: "Pendente" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sessao = await obterSessao();
  if (!sessao || !(pode(sessao, "expedicao") || pode(sessao, "financeiro"))) redirect("/sem-acesso");
  const supabase = await criarClienteServidor();
  const [{ data }, { data: empresa }] = await Promise.all([
    supabase.rpc("acerto_resumo", { p_expedicao: id }),
    supabase.from("empresas").select("razao_social, nome_fantasia").eq("id", sessao.empresaId).maybeSingle(),
  ]);
  const r = data as Resumo | null;
  if (!r) notFound();
  const a = r.acerto;
  const linha = (rot: string, v: number, forte = false) => (
    <tr className={forte ? "font-bold" : ""}><td className="py-0.5 pr-4">{rot}</td><td className="py-0.5 text-right tabular-nums">{formatarMoeda(v)}</td></tr>
  );
  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[12px] text-black print:p-0">
      <div className="mb-4 flex justify-end print:hidden"><BotaoImprimir /></div>
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-xl font-bold">Acerto do motorista · carga nº {r.carga.numero}</div>
          <div>{empresa?.nome_fantasia || empresa?.razao_social}</div>
        </div>
        <div className="text-right">
          <div>Motorista: <b>{r.carga.motorista ?? "—"}</b></div>
          <div>Saída {formatarData(r.carga.data)}</div>
          {a && <div>Acerto em {formatarData(a.criado_em)}</div>}
        </div>
      </header>
      <table className="mt-3 w-full border-collapse">
        <thead><tr className="border-b border-black text-left text-[10px] uppercase">
          <th className="py-1 pr-2">#</th><th className="py-1 pr-2">Pedido / cliente</th><th className="py-1 pr-2">Forma</th>
          <th className="py-1 pr-2 text-right">Valor</th><th className="py-1 pr-2 text-right">Dinheiro</th><th className="py-1 pr-2 text-right">PIX</th>
          <th className="py-1 pr-2 text-right">Cartão</th><th className="py-1">Situação</th>
        </tr></thead>
        <tbody>
          {r.pedidos.map((p) => (
            <tr key={p.numero} className="border-b border-black/15">
              <td className="py-1 pr-2">{p.ordem}</td><td className="py-1 pr-2">{p.numero} · {p.cliente}</td><td className="py-1 pr-2">{p.forma ?? "—"}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatarMoeda(p.valor)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{Number(p.dinheiro) ? formatarMoeda(p.dinheiro) : ""}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{Number(p.pix) ? formatarMoeda(p.pix) : ""}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{Number(p.cartao) ? formatarMoeda(p.cartao) : ""}</td>
              <td className="py-1">{SIT[p.status] ?? p.status}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t-2 border-black font-semibold">
          <td colSpan={4} className="py-1">Recebido</td>
          <td className="py-1 pr-2 text-right tabular-nums">{formatarMoeda(r.recebido_dinheiro)}</td>
          <td className="py-1 pr-2 text-right tabular-nums">{formatarMoeda(r.recebido_pix)}</td>
          <td className="py-1 pr-2 text-right tabular-nums">{formatarMoeda(r.recebido_cartao)}</td><td />
        </tr></tfoot>
      </table>
      <section className="mt-4 grid grid-cols-2 gap-6">
        <table className="self-start"><tbody>
          {linha("Dinheiro recebido nas entregas", r.recebido_dinheiro)}
          {a ? <>
            {a.despesas.map((d, i) => <tr key={i}><td className="py-0.5 pr-4">(−) {d.descricao}</td><td className="py-0.5 text-right tabular-nums">{formatarMoeda(d.valor)}</td></tr>)}
            {linha("Dinheiro entregue", a.dinheiro_entregue, true)}
            <tr className="border-t border-black font-bold"><td className="py-1 pr-4">{Math.abs(Number(a.diferenca)) < 0.01 ? "Acerto fechado" : Number(a.diferenca) < 0 ? "Faltou" : "Sobrou"}</td>
              <td className="py-1 text-right tabular-nums">{formatarMoeda(Math.abs(Number(a.diferenca)))}</td></tr>
          </> : <tr><td colSpan={2} className="pt-2">Acerto ainda não registrado.</td></tr>}
        </tbody></table>
        <table className="self-start"><tbody>
          {linha("PIX (conferido no extrato)", r.recebido_pix)}
          {linha("Cartão", r.recebido_cartao)}
          {linha("A prazo / boleto", r.a_prazo)}
          {linha("Voltou sem entregar", r.valor_devolvido)}
        </tbody></table>
      </section>
      {a?.observacao && <p className="mt-3">Observação: {a.observacao}</p>}
      <section className="mt-14 grid grid-cols-2 gap-10 text-center text-[11px]">
        <div className="border-t border-black pt-1">Motorista</div>
        <div className="border-t border-black pt-1">Conferido por (escritório)</div>
      </section>
    </div>
  );
}
