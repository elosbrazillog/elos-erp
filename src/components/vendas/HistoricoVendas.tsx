"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, Upload } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Abas, Button, Cabecalho, Card, Input, Label, Select, Vazio } from "@/components/ui";
import { cn, dataLocal, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";

type Resumo = {
  total: number; pedidos: number; clientes: number; itens: number; primeira: string | null; ultima: string | null;
  meses: { mes: string; total: number; pedidos: number }[];
  clientes_top: { nome: string; documento: string; cliente_id: string | null; cidade: string | null; total: number; pedidos: number; ultima: string }[];
  produtos_top: { codigo: string; nome: string; unidade: string | null; quantidade: number; total: number; pedidos: number; clientes: number }[];
  vendedores: { nome: string; total: number; pedidos: number }[];
  nao_faturados: number; sem_cliente: number; sem_produto: number;
};
type Pedido = { pedido_codigo: string; data: string | null; faturado: boolean; status: string | null; nfe: string | null; cliente_nome: string | null;
  cliente_id: string | null; vendedor_nome: string | null; forma_pagamento: string | null; total: number; itens: number };
type Item = { linha: number; produto_codigo: string | null; produto_nome: string | null; quantidade: number; preco: number; total: number; unidade: string | null };

const ABAS = ["Pedidos", "Clientes", "Produtos", "Vendedores"] as const;

// ---------------------------------------------------------------------
// Leitura da planilha do Atende (Relatório de vendas por item)
// ---------------------------------------------------------------------
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COLUNAS: Record<string, string[]> = {
  pedido: ["codigovenda", "codigodavenda", "pedido", "numeropedido"],
  status: ["status", "situacao"],
  nfe: ["codnfensfse", "codnfe", "nfe", "notafiscal"],
  data_nfe: ["datanfe"],
  data: ["datafaturamentopedido", "datafaturamento", "data", "dataemissao"],
  quantidade: ["quantidade", "qtd"],
  preco: ["precovendar", "precovenda", "precounitario", "precounitarior"],
  total: ["precovendatotalr", "precovendatotal", "total", "valortotal", "valortotalr"],
  documento: ["cnpjcpf", "cpfcnpj", "documento"],
  cliente: ["cliente", "razaosocial"],
  cidade: ["cidade"],
  uf: ["estado", "uf"],
  vendedor: ["vendedor"],
  forma: ["formapagamento", "formadepagamento"],
  produto_codigo: ["codprod", "codigoprod", "codigoproduto"],
  produto_nome: ["nomeproduto", "produto"],
  unidade: ["unidadecomercial", "unidade"],
  ncm: ["ncm"],
};

function iso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
function numero(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0;
}

async function lerPlanilha(arquivo: File) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());
  const ws = wb.worksheets[0];
  const idx: Record<string, number> = {};
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => {
    const h = norm(String(c.text ?? ""));
    for (const [campo, nomes] of Object.entries(COLUNAS)) if (idx[campo] === undefined && nomes.includes(h)) idx[campo] = i;
  });
  if (!idx.pedido || !idx.total || !idx.cliente) throw new Error("A planilha precisa das colunas Código Venda, Cliente e Preço Venda Total.");
  const contador: Record<string, number> = {};
  const linhas: Record<string, unknown>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const cel = (campo: string) => (idx[campo] ? row.getCell(idx[campo]).value : null);
    const txt = (campo: string) => { const v = cel(campo); return v == null ? "" : String((v as { text?: string }).text ?? v).trim(); };
    const pedido = txt("pedido");
    if (!pedido) return;
    contador[pedido] = (contador[pedido] ?? 0) + 1;
    linhas.push({
      pedido, linha: contador[pedido], status: txt("status"), nfe: txt("nfe"), data_nfe: iso(cel("data_nfe")), data: iso(cel("data")),
      quantidade: numero(cel("quantidade")), preco: numero(cel("preco")), total: numero(cel("total")),
      documento: txt("documento"), cliente: txt("cliente"), cidade: txt("cidade"), uf: txt("uf"), vendedor: txt("vendedor"), forma: txt("forma"),
      produto_codigo: txt("produto_codigo"), produto_nome: txt("produto_nome"), unidade: txt("unidade"), ncm: txt("ncm"),
    });
  });
  return linhas;
}

// Lotes que nunca partem um pedido ao meio (cada lote substitui os pedidos que traz)
function emLotes(linhas: Record<string, unknown>[], max = 2500) {
  const porPedido = new Map<string, Record<string, unknown>[]>();
  for (const l of linhas) { const k = String(l.pedido); if (!porPedido.has(k)) porPedido.set(k, []); porPedido.get(k)!.push(l); }
  const lotes: Record<string, unknown>[][] = [];
  let atual: Record<string, unknown>[] = [];
  for (const grupo of porPedido.values()) {
    if (atual.length + grupo.length > max && atual.length) { lotes.push(atual); atual = []; }
    atual.push(...grupo);
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

export function HistoricoVendas({ podeImportar }: { podeImportar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [de, setDe] = useState(`${new Date().getFullYear()}-01-01`);
  const [ate, setAte] = useState(dataLocal());
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [vendedores, setVendedores] = useState<{ id: string; razao_social: string }[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [aba, setAba] = useState<(typeof ABAS)[number]>("Pedidos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [itens, setItens] = useState<Record<string, Item[]>>({});
  const [importando, setImportando] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setResumo(null); setPedidos(null);
    const b = buscaAplicada.trim();
    let q = supabase.from("vw_historico_pedidos").select("pedido_codigo, data, faturado, status, nfe, cliente_nome, cliente_id, vendedor_nome, forma_pagamento, total, itens")
      .eq("faturado", true).gte("data", de).lte("data", ate).order("data", { ascending: false }).order("pedido_codigo", { ascending: false }).limit(500);
    if (vendedor) q = q.eq("vendedor_id", vendedor);
    if (b) q = q.or(`cliente_nome.ilike.%${b.replace(/[%,()]/g, " ")}%,pedido_codigo.eq.${b.replace(/[^0-9A-Za-z]/g, "")}`);
    const [r, p] = await Promise.all([
      supabase.rpc("historico_resumo", { p_de: de, p_ate: ate, p_vendedor: vendedor || null, p_busca: b || null }),
      q,
    ]);
    if (r.error || p.error) toast.error("Não foi possível carregar", { description: mensagemErro((r.error ?? p.error)!) });
    setResumo((r.data ?? null) as Resumo | null);
    setPedidos((p.data ?? []) as Pedido[]);
  }, [supabase, de, ate, vendedor, buscaAplicada]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    supabase.from("pessoas").select("id, razao_social").eq("eh_vendedor", true).eq("ativo", true).order("razao_social")
      .then(({ data }) => setVendedores((data ?? []) as { id: string; razao_social: string }[]));
  }, [supabase]);

  async function abrirPedido(codigo: string) {
    if (aberto === codigo) { setAberto(null); return; }
    setAberto(codigo);
    if (itens[codigo]) return;
    const { data } = await supabase.from("vendas_historico").select("linha, produto_codigo, produto_nome, quantidade, preco, total, unidade")
      .eq("pedido_codigo", codigo).order("linha");
    setItens((x) => ({ ...x, [codigo]: (data ?? []) as Item[] }));
  }

  async function importar(f: File) {
    if (arquivo.current) arquivo.current.value = "";
    try {
      setImportando("Lendo a planilha...");
      const linhas = await lerPlanilha(f);
      if (!linhas.length) throw new Error("A planilha não tem linhas de venda.");
      const lotes = emLotes(linhas);
      let feitas = 0, pedidosOk = 0;
      for (const [i, lote] of lotes.entries()) {
        setImportando(`Enviando ${i + 1} de ${lotes.length}...`);
        const { data, error } = await supabase.rpc("historico_importar", { p_linhas: lote, p_origem: "atende" });
        if (error) throw new Error(mensagemErro(error));
        feitas += (data as { linhas: number }).linhas;
        pedidosOk += (data as { pedidos: number }).pedidos;
      }
      toast.success(`Histórico importado: ${formatarNumero(pedidosOk)} pedidos, ${formatarNumero(feitas)} itens`);
      void carregar();
    } catch (e) {
      toast.error("Importação não concluída", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setImportando(null);
    }
  }

  const maxMes = Math.max(1, ...(resumo?.meses ?? []).map((m) => Number(m.total)));

  return (
    <>
      <Cabecalho trilha="Vendas" titulo="Histórico de vendas"
        acoes={podeImportar && <>
          <input ref={arquivo} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importar(f); }} />
          <Button onClick={() => arquivo.current?.click()} disabled={!!importando}><Upload size={15} /> {importando ?? "Importar planilha"}</Button>
        </>} />

      <Card className="mb-3 p-3">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca); }}>
          <div><Label htmlFor="h-de">De</Label><Input id="h-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
          <div><Label htmlFor="h-ate">Até</Label><Input id="h-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
          <div className="min-w-48">
            <Label htmlFor="h-vend">Vendedor</Label>
            <Select id="h-vend" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
              <option value="">Todos</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.razao_social}</option>)}
            </Select>
          </div>
          <div className="min-w-56 flex-1">
            <Label htmlFor="h-busca">Cliente, produto, cidade ou nº do pedido</Label>
            <Input id="h-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar..." />
          </div>
          <Button type="submit">Filtrar</Button>
        </form>
      </Card>

      {!resumo ? <div className="py-10 text-center text-sm text-muted">Carregando...</div> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Faturado", formatarMoeda(Number(resumo.total))],
              ["Pedidos", formatarNumero(Number(resumo.pedidos))],
              ["Ticket médio", resumo.pedidos ? formatarMoeda(Number(resumo.total) / Number(resumo.pedidos)) : "—"],
              ["Clientes atendidos", formatarNumero(Number(resumo.clientes))],
            ].map(([r, v]) => (
              <Card key={r} className="p-4"><div className="text-xs text-muted">{r}</div><div className="tabular mt-1 text-xl font-semibold">{v}</div></Card>
            ))}
          </div>

          {resumo.meses.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-medium">Faturado por mês</h2>
                {resumo.primeira && <span className="text-xs text-muted">{formatarData(resumo.primeira)} a {formatarData(resumo.ultima)}</span>}
              </div>
              <div className="flex h-28 items-end gap-1.5">
                {resumo.meses.map((m) => (
                  <div key={m.mes} className="group flex h-full flex-1 flex-col justify-end" title={`${formatarMoeda(Number(m.total))} · ${m.pedidos} pedidos`}>
                    <div className="tabular mb-0.5 text-center text-[10px] text-muted opacity-0 group-hover:opacity-100">{formatarMoeda(Number(m.total))}</div>
                    <div className="rounded-t bg-chart/40 transition-colors group-hover:bg-accent" style={{ height: `${Math.max(2, (Number(m.total) / maxMes) * 80)}%` }} />
                    <div className="mt-1 text-center text-[10px] text-muted capitalize">
                      {new Date(m.mes + "T12:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {(resumo.sem_cliente > 0 || resumo.sem_produto > 0 || resumo.nao_faturados > 0) && (
            <p className="text-xs text-muted">
              {resumo.sem_cliente > 0 && <>{resumo.sem_cliente} {resumo.sem_cliente === 1 ? "cliente" : "clientes"} da planilha sem cadastro no ERP (aparecem pelo nome). </>}
              {resumo.sem_produto > 0 && <>{resumo.sem_produto} {resumo.sem_produto === 1 ? "produto" : "produtos"} sem cadastro. </>}
              {resumo.nao_faturados > 0 && <>{resumo.nao_faturados} pedidos não faturados no sistema anterior ficam fora dos totais.</>}
            </p>
          )}

          <Abas abas={[...ABAS]} ativa={aba} onChange={(a) => setAba(a as (typeof ABAS)[number])} />

          {aba === "Pedidos" && (
            <Card>
              {!pedidos?.length ? <Vazio titulo="Nenhuma venda no período" texto={podeImportar ? "Importe a planilha de vendas do sistema anterior." : undefined} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b border-line text-left text-xs text-muted uppercase">
                      <tr><th className="w-6" /><th className="px-2 py-2 font-medium">Pedido</th><th className="px-2 py-2 font-medium">Faturado</th><th className="px-2 py-2 font-medium">Cliente</th>
                        <th className="px-2 py-2 font-medium">Vendedor</th><th className="px-2 py-2 font-medium">Pagamento</th><th className="px-3 py-2 text-right font-medium">Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line/70">
                      {pedidos.map((p) => (
                        <FragmentoPedido key={p.pedido_codigo} p={p} aberto={aberto === p.pedido_codigo} itens={itens[p.pedido_codigo]} onClick={() => abrirPedido(p.pedido_codigo)} />
                      ))}
                    </tbody>
                  </table>
                  {pedidos.length === 500 && <p className="px-3 py-2 text-xs text-muted">Mostrando os 500 mais recentes. Use os filtros para achar outros.</p>}
                </div>
              )}
            </Card>
          )}

          {aba === "Clientes" && (
            <Card>
              {!resumo.clientes_top.length ? <Vazio titulo="Nenhum cliente no período" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="border-b border-line text-left text-xs text-muted uppercase">
                      <tr><th className="px-3 py-2 font-medium">Cliente</th><th className="px-2 py-2 font-medium">Cidade</th><th className="px-2 py-2 text-right font-medium">Pedidos</th>
                        <th className="px-2 py-2 font-medium">Última compra</th><th className="px-3 py-2 text-right font-medium">Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line/70">
                      {resumo.clientes_top.map((c) => (
                        <tr key={c.documento ?? c.nome}>
                          <td className="max-w-80 truncate px-3 py-2">{c.cliente_id ? <Link href={`/cadastros/pessoas/${c.cliente_id}`} className="hover:text-accent hover:underline">{c.nome}</Link> : c.nome}</td>
                          <td className="px-2 py-2 text-xs text-muted">{c.cidade}</td>
                          <td className="tabular px-2 py-2 text-right">{c.pedidos}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{formatarData(c.ultima)}</td>
                          <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatarMoeda(Number(c.total))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {aba === "Produtos" && (
            <Card>
              {!resumo.produtos_top.length ? <Vazio titulo="Nenhum produto no período" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="border-b border-line text-left text-xs text-muted uppercase">
                      <tr><th className="px-3 py-2 font-medium">Produto</th><th className="px-2 py-2 text-right font-medium">Quantidade</th><th className="px-2 py-2 text-right font-medium">Pedidos</th>
                        <th className="px-2 py-2 text-right font-medium">Clientes</th><th className="px-3 py-2 text-right font-medium">Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line/70">
                      {resumo.produtos_top.map((p) => (
                        <tr key={p.codigo ?? p.nome}>
                          <td className="max-w-96 truncate px-3 py-2"><span className="text-xs text-muted">{p.codigo}</span> {p.nome}</td>
                          <td className="tabular px-2 py-2 text-right whitespace-nowrap">{formatarNumero(Number(p.quantidade))} {p.unidade}</td>
                          <td className="tabular px-2 py-2 text-right">{p.pedidos}</td>
                          <td className="tabular px-2 py-2 text-right">{p.clientes}</td>
                          <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatarMoeda(Number(p.total))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {aba === "Vendedores" && (
            <Card className="p-4">
              {!resumo.vendedores.length ? <Vazio titulo="Nenhuma venda no período" /> : (
                <ul className="space-y-2.5">
                  {resumo.vendedores.map((v) => {
                    const max = Math.max(1, ...resumo.vendedores.map((x) => Number(x.total)));
                    return (
                      <li key={v.nome} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                        <span className="truncate">{v.nome}</span>
                        <div className="h-2 rounded-full bg-surface-2"><div className="h-full rounded-full bg-chart" style={{ width: `${Math.max(2, (Number(v.total) / max) * 100)}%` }} /></div>
                        <span className="tabular text-right">{formatarMoeda(Number(v.total))} <span className="text-xs text-muted">· {v.pedidos} ped.</span></span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
          <p className="text-xs text-muted">Vendas do sistema anterior (Atende). Elas contam nas metas, no painel e no último pedido do cliente no app, mas não geram estoque, financeiro nem comissão.</p>
        </div>
      )}
    </>
  );
}

function FragmentoPedido({ p, aberto, itens, onClick }: { p: Pedido; aberto: boolean; itens?: Item[]; onClick: () => void }) {
  return (
    <>
      <tr className={cn("cursor-pointer hover:bg-surface-2/60", aberto && "bg-surface-2/60")} onClick={onClick}>
        <td className="pl-3"><ChevronRight size={14} className={cn("text-muted transition-transform", aberto && "rotate-90")} /></td>
        <td className="px-2 py-2 whitespace-nowrap">{p.pedido_codigo}{p.nfe ? <span className="ml-1 text-xs text-muted">NF {p.nfe}</span> : null}</td>
        <td className="px-2 py-2 whitespace-nowrap">{formatarData(p.data)}</td>
        <td className="max-w-72 truncate px-2 py-2">{p.cliente_nome}</td>
        <td className="px-2 py-2 text-xs">{p.vendedor_nome}</td>
        <td className="px-2 py-2 text-xs text-muted">{p.forma_pagamento}</td>
        <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatarMoeda(Number(p.total))}</td>
      </tr>
      {aberto && (
        <tr>
          <td />
          <td colSpan={6} className="px-2 pb-3">
            {!itens ? <div className="py-2 text-xs text-muted">Carregando...</div> : (
              <table className="w-full text-xs">
                <tbody className="divide-y divide-line/50">
                  {itens.map((i) => (
                    <tr key={i.linha}>
                      <td className="py-1 pr-2 text-muted">{i.produto_codigo}</td>
                      <td className="py-1">{i.produto_nome}</td>
                      <td className="tabular py-1 text-right">{formatarNumero(Number(i.quantidade))} {i.unidade}</td>
                      <td className="tabular py-1 text-right">{formatarMoeda(Number(i.preco))}</td>
                      <td className="tabular py-1 text-right">{formatarMoeda(Number(i.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
