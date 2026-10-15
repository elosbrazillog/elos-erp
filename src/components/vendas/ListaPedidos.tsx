"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Plus, Search } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Select, Vazio } from "@/components/ui";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { STATUS_PEDIDO, mensagemErro, type StatusPedido } from "@/lib/pedidos";
import { exportarExcel } from "@/components/crud/exportar";

const POR_PAGINA = 50;

type Linha = {
  id: string; numero: number; tipo: "pedido" | "orcamento"; status: StatusPedido; data_emissao: string; data_entrega: string | null;
  cliente_codigo: number | null; cliente_nome: string; cliente_fantasia: string | null; vendedor_nome: string | null; rota_nome: string | null;
  qtd_itens: number; valor_total: number; peso_total_kg: number; motivo_trava: string | null; faturado_em: string | null;
};

const FILTROS: { rotulo: string; status: StatusPedido[] | null }[] = [
  { rotulo: "Todos", status: null },
  { rotulo: "Rascunho", status: ["rascunho"] },
  { rotulo: "Aguardando crédito", status: ["aguardando_credito"] },
  { rotulo: "Aprovados", status: ["aprovado"] },
  { rotulo: "Em andamento", status: ["em_separacao", "faturado", "em_rota"] },
  { rotulo: "Entregues", status: ["entregue"] },
  { rotulo: "Cancelados", status: ["cancelado", "devolvido"] },
];

export function ListaPedidos({ podeCriar }: { podeCriar: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [total, setTotal] = useState(0);
  const [soma, setSoma] = useState<number | null>(null);
  const [pagina, setPagina] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [tipo, setTipo] = useState<"todos" | "pedido" | "orcamento">("todos");
  const [filtro, setFiltro] = useState(0);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const consulta = useCallback(
    (cols: string, contagem: boolean) => {
      let q = supabase.from("vw_pedidos").select(cols, contagem ? { count: "exact" } : undefined).eq("ativo", true);
      if (tipo !== "todos") q = q.eq("tipo", tipo);
      const st = FILTROS[filtro].status;
      if (st) q = q.in("status", st);
      if (de) q = q.gte("data_emissao", `${de}T00:00:00`);
      if (ate) q = q.lte("data_emissao", `${ate}T23:59:59`);
      const termo = buscaAplicada.replace(/[,()%*\\]/g, " ").trim();
      if (termo) {
        if (/^\d+$/.test(termo)) q = q.or(`numero.eq.${termo},cliente_codigo.eq.${termo}`);
        else q = q.or(`cliente_nome.ilike.%${termo}%,cliente_fantasia.ilike.%${termo}%,vendedor_nome.ilike.%${termo}%`);
      }
      return q;
    },
    [supabase, tipo, filtro, de, ate, buscaAplicada],
  );

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, count, error } = await consulta("*", true)
      .order("numero", { ascending: false })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    setCarregando(false);
    if (error) return toast.error("Não foi possível carregar os pedidos", { description: mensagemErro(error) });
    setLinhas((data ?? []) as unknown as Linha[]);
    setTotal(count ?? 0);
    // soma do período filtrado (até 5000 pedidos)
    const s = await consulta("valor_total, status", false).limit(5000);
    const validos = ((s.data ?? []) as unknown as { valor_total: number; status: string }[]).filter((l) => l.status !== "cancelado");
    setSoma(validos.reduce((a, l) => a + Number(l.valor_total), 0));
  }, [consulta, pagina]);

  useEffect(() => { carregar(); }, [carregar]);

  function aoDigitar(v: string) {
    setBusca(v);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => { setPagina(0); setBuscaAplicada(v); }, 350);
  }

  async function exportar() {
    const { data, error } = await consulta("*", false).order("numero", { ascending: false }).limit(5000);
    if (error) return toast.error("Não foi possível exportar", { description: mensagemErro(error) });
    const ls = (data ?? []) as unknown as Linha[];
    await exportarExcel(
      "Pedidos",
      ["Número", "Tipo", "Emissão", "Entrega", "Código", "Cliente", "Fantasia", "Vendedor", "Rota", "Itens", "Peso (kg)", "Total", "Situação"],
      ls.map((l) => [
        l.numero, l.tipo === "orcamento" ? "Orçamento" : "Pedido", formatarData(l.data_emissao), formatarData(l.data_entrega),
        l.cliente_codigo ?? "", l.cliente_nome, l.cliente_fantasia ?? "", l.vendedor_nome ?? "", l.rota_nome ?? "",
        Number(l.qtd_itens), Number(l.peso_total_kg), Number(l.valor_total), STATUS_PEDIDO[l.status].rotulo,
      ]),
    );
  }

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const temFiltro = !!(buscaAplicada || filtro || tipo !== "todos" || de || ate);

  return (
    <>
      <Cabecalho
        trilha="Vendas"
        titulo="Pedidos e orçamentos"
        acoes={podeCriar && (
          <Link href="/vendas/pedidos/novo"><Button variante="primario"><Plus size={16} /> Novo</Button></Link>
        )}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <Input value={busca} onChange={(e) => aoDigitar(e.target.value)} placeholder="Número, código ou nome do cliente, vendedor" className="pl-8" aria-label="Buscar" />
          </div>
          <Select value={tipo} onChange={(e) => { setPagina(0); setTipo(e.target.value as typeof tipo); }} className="w-auto" aria-label="Tipo">
            <option value="todos">Pedidos e orçamentos</option>
            <option value="pedido">Só pedidos</option>
            <option value="orcamento">Só orçamentos</option>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            De <Input type="date" value={de} onChange={(e) => { setPagina(0); setDe(e.target.value); }} className="w-auto" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Até <Input type="date" value={ate} onChange={(e) => { setPagina(0); setAte(e.target.value); }} className="w-auto" />
          </label>
          <Button onClick={exportar}><Download size={16} /> Excel</Button>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          {FILTROS.map((f, i) => (
            <button key={f.rotulo} onClick={() => { setPagina(0); setFiltro(i); }}
              className={cn("rounded-full border px-3 py-1 text-xs", filtro === i ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}>
              {f.rotulo}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Nº</th>
                <th className="px-3 py-2 font-medium">Emissão</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Vendedor</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Rota</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Entrega</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const st = STATUS_PEDIDO[l.status];
                return (
                  <tr key={l.id} onClick={() => router.push(`/vendas/pedidos/${l.id}`)} className="cursor-pointer border-b border-line/70 hover:bg-surface-2/70">
                    <td className="tabular px-3 py-2 whitespace-nowrap">
                      {l.numero}
                      {l.tipo === "orcamento" && <span className="ml-1.5"><Badge tom="acento">Orçamento</Badge></span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatarData(l.data_emissao)}</td>
                    <td className="max-w-72 px-3 py-2">
                      <div className="truncate">{l.cliente_fantasia || l.cliente_nome}</div>
                      {l.cliente_fantasia && <div className="truncate text-xs text-muted">{l.cliente_nome}</div>}
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">{l.vendedor_nome ?? <span className="text-muted/50">—</span>}</td>
                    <td className="hidden px-3 py-2 lg:table-cell">{l.rota_nome ?? <span className="text-muted/50">—</span>}</td>
                    <td className="hidden px-3 py-2 whitespace-nowrap lg:table-cell">{l.data_entrega ? formatarData(l.data_entrega) : <span className="text-muted/50">—</span>}</td>
                    <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatarMoeda(l.valor_total)}</td>
                    <td className="px-3 py-2 whitespace-nowrap" title={l.motivo_trava ?? undefined}><Badge tom={st.tom}>{st.rotulo}</Badge>{l.faturado_em && <span className="ml-1"><Badge tom="acento">Faturado</Badge></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!carregando && linhas.length === 0 && (
            <Vazio
              titulo={temFiltro ? "Nenhum pedido com esses filtros" : "Nenhum pedido ainda"}
              texto={temFiltro ? "Mude os filtros ou limpe a busca." : podeCriar ? "Clique em Novo para lançar o primeiro pedido ou orçamento." : undefined}
            />
          )}
          {carregando && linhas.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">Carregando...</div>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
          <span className="tabular">
            {total} {total === 1 ? "registro" : "registros"}
            {soma !== null && total > 0 && <> · {formatarMoeda(soma)} sem os cancelados</>}
          </span>
          <div className="flex items-center gap-2">
            <Button tamanho="p" variante="fantasma" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></Button>
            <span className="tabular">Página {pagina + 1} de {paginas}</span>
            <Button tamanho="p" variante="fantasma" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página"><ChevronRight size={16} /></Button>
          </div>
        </div>
      </Card>
    </>
  );
}
