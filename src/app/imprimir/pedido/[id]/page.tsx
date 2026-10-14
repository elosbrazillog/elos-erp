import { notFound, redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";
import { formatarData, formatarDocumento, formatarMoeda, formatarNumero, formatarTelefone } from "@/lib/utils";
import { STATUS_PEDIDO, type StatusPedido } from "@/lib/pedidos";
import { BotaoImprimir } from "./BotaoImprimir";

export const metadata = { title: "Imprimir pedido" };

type Item = { quantidade: number; preco_unitario: number; desconto: number; valor_total: number; produtos: { codigo: string; nome: string; unidades: { sigla: string } | null } | null };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sessao = await obterSessao();
  if (!sessao || !pode(sessao, "vendas")) redirect("/sem-acesso");
  const supabase = await criarClienteServidor();

  const { data: p } = await supabase
    .from("pedidos")
    .select("*, condicoes_pagamento(nome), formas_pagamento(nome), vendedor:vendedor_id(razao_social), rotas(nome)")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();

  const [{ data: itens }, { data: cliente }, { data: empresa }] = await Promise.all([
    supabase.from("pedidos_itens").select("quantidade, preco_unitario, desconto, valor_total, produtos(codigo, nome, unidades(sigla))").eq("pedido_id", id).eq("ativo", true).order("ordem").order("criado_em"),
    supabase.from("pessoas").select("codigo, razao_social, nome_fantasia, documento, inscricao_estadual, telefone, whatsapp, pessoas_enderecos(tipo, logradouro, numero, complemento, bairro, cidade, uf, cep)").eq("id", p.cliente_id).maybeSingle(),
    supabase.from("empresas").select("razao_social, nome_fantasia, cnpj, inscricao_estadual, telefone, email, logradouro, numero, bairro, cidade, uf, cep").eq("id", sessao.empresaId).maybeSingle(),
  ]);

  type End = { tipo: string; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null };
  const ends = ((cliente?.pessoas_enderecos ?? []) as End[]);
  const end = ends.find((e) => e.tipo === "entrega") ?? ends.find((e) => e.tipo === "principal") ?? ends[0];
  const nome = p.tipo === "orcamento" ? "Orçamento" : "Pedido";
  const rel = <T,>(v: unknown) => v as T | null;
  const lista = (itens ?? []) as unknown as Item[];

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[13px] text-black print:p-0">
      <div className="mb-4 flex justify-end print:hidden"><BotaoImprimir /></div>

      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-lg font-bold">{empresa?.nome_fantasia || empresa?.razao_social}</div>
          <div>{empresa?.razao_social}</div>
          <div>CNPJ {formatarDocumento(empresa?.cnpj)}{empresa?.inscricao_estadual ? ` · IE ${empresa.inscricao_estadual}` : ""}</div>
          <div>{[[empresa?.logradouro, empresa?.numero, empresa?.bairro].filter(Boolean).join(", "), empresa?.cidade && `${empresa.cidade}/${empresa.uf}`].filter(Boolean).join(" · ")}</div>
          <div>{[empresa?.telefone ? formatarTelefone(empresa.telefone) : null, empresa?.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">{nome} nº {p.numero}</div>
          <div>Emissão: {formatarData(p.data_emissao)}</div>
          {p.data_entrega && <div>Entrega: {formatarData(p.data_entrega)}</div>}
          {p.tipo === "orcamento" && p.validade && <div>Válido até: {formatarData(p.validade)}</div>}
          <div>Situação: {STATUS_PEDIDO[p.status as StatusPedido].rotulo}</div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 border-b border-black/30 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase">Cliente</div>
          <div className="font-semibold">{cliente?.codigo} · {cliente?.razao_social}</div>
          {cliente?.nome_fantasia && <div>{cliente.nome_fantasia}</div>}
          <div>{formatarDocumento(cliente?.documento)}{cliente?.inscricao_estadual ? ` · IE ${cliente.inscricao_estadual}` : ""}</div>
          <div>{[cliente?.telefone, cliente?.whatsapp].filter(Boolean).map(formatarTelefone).join(" · ")}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase">Endereço de entrega</div>
          {end ? (
            <>
              <div>{[end.logradouro, end.numero, end.complemento].filter(Boolean).join(", ")}</div>
              <div>{end.bairro} · {end.cidade}/{end.uf}{end.cep ? ` · CEP ${end.cep}` : ""}</div>
            </>
          ) : <div>—</div>}
        </div>
      </section>

      <section className="grid grid-cols-4 gap-2 border-b border-black/30 py-2">
        <div><div className="text-[11px] font-semibold uppercase">Vendedor</div>{rel<{ razao_social: string }>(p.vendedor)?.razao_social ?? "—"}</div>
        <div><div className="text-[11px] font-semibold uppercase">Rota</div>{rel<{ nome: string }>(p.rotas)?.nome ?? "—"}</div>
        <div><div className="text-[11px] font-semibold uppercase">Condição</div>{rel<{ nome: string }>(p.condicoes_pagamento)?.nome ?? "—"}</div>
        <div><div className="text-[11px] font-semibold uppercase">Forma</div>{rel<{ nome: string }>(p.formas_pagamento)?.nome ?? "—"}</div>
      </section>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left text-[11px] uppercase">
            <th className="py-1 pr-2">Código</th>
            <th className="py-1 pr-2">Produto</th>
            <th className="py-1 pr-2 text-right">Qtd</th>
            <th className="py-1 pr-2">Un</th>
            <th className="py-1 pr-2 text-right">Preço</th>
            <th className="py-1 pr-2 text-right">Desc.</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((i, k) => (
            <tr key={k} className="border-b border-black/15">
              <td className="py-1 pr-2">{i.produtos?.codigo}</td>
              <td className="py-1 pr-2">{i.produtos?.nome}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatarNumero(i.quantidade)}</td>
              <td className="py-1 pr-2">{i.produtos?.unidades?.sigla}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatarMoeda(i.preco_unitario)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{Number(i.desconto) ? formatarMoeda(i.desconto) : ""}</td>
              <td className="py-1 text-right tabular-nums">{formatarMoeda(i.valor_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-3 flex justify-between gap-6">
        <div className="max-w-[60%]">
          {p.observacao && <><div className="text-[11px] font-semibold uppercase">Observação</div><p className="whitespace-pre-wrap">{p.observacao}</p></>}
          {p.pedido_cliente && <div className="mt-1">Pedido do cliente: {p.pedido_cliente}</div>}
          <div className="mt-1">Peso bruto: {formatarNumero(p.peso_total_kg)} kg · {lista.length} {lista.length === 1 ? "item" : "itens"}</div>
        </div>
        <table className="tabular-nums">
          <tbody>
            <tr><td className="pr-4">Produtos</td><td className="text-right">{formatarMoeda(p.valor_produtos)}</td></tr>
            {Number(p.valor_desconto) > 0 && <tr><td className="pr-4">Desconto</td><td className="text-right">− {formatarMoeda(p.valor_desconto)}</td></tr>}
            {Number(p.valor_frete) > 0 && <tr><td className="pr-4">Frete</td><td className="text-right">{formatarMoeda(p.valor_frete)}</td></tr>}
            <tr className="border-t border-black text-base font-bold"><td className="pr-4">Total</td><td className="text-right">{formatarMoeda(p.valor_total)}</td></tr>
          </tbody>
        </table>
      </section>

      {p.tipo === "pedido" && (
        <section className="mt-12 grid grid-cols-2 gap-10 text-center text-[11px]">
          <div className="border-t border-black pt-1">Recebido por (nome e documento)</div>
          <div className="border-t border-black pt-1">Data e assinatura</div>
        </section>
      )}
    </div>
  );
}
