"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, FileCheck2, Plus, Printer, Search, Truck } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Select, Vazio } from "@/components/ui";
import { cn, formatarData, formatarMoeda, dataLocal } from "@/lib/utils";
import { STATUS_PEDIDO, mensagemErro, type StatusPedido } from "@/lib/pedidos";
import { exportarExcel } from "@/components/crud/exportar";
import { Dialogo } from "@/components/ui/Dialogo";
import { Label } from "@/components/ui";
import { useOpcoesCarga } from "@/components/expedicao/ListaCargas";

const POR_PAGINA = 50;

type Linha = {
  id: string; numero: number; tipo: "pedido" | "orcamento"; status: StatusPedido; data_emissao: string; data_entrega: string | null;
  cliente_codigo: number | null; cliente_nome: string; cliente_fantasia: string | null; vendedor_nome: string | null; rota_nome: string | null;
  qtd_itens: number; valor_total: number; peso_total_kg: number; motivo_trava: string | null; faturado_em: string | null; gera_boleto: boolean; rota_id: string | null;
};
type Selecionado = Pick<Linha, "id" | "numero" | "tipo" | "status" | "valor_total" | "faturado_em" | "gera_boleto" | "peso_total_kg"> & { rota_id?: string | null };
type CargaAberta = { id: string; numero: number; data: string; rota_nome: string | null; motorista_nome: string | null; qtd_pedidos: number };
type ResultadoFat = { faturados: number; boletos: number; erros: { pedido_id: string; numero: number; motivo: string }[]; ids: string[] };
const FATURAVEL: StatusPedido[] = ["aprovado", "em_separacao", "em_rota", "entregue"];
const LIMITE_LOTE = 150;
const podeFaturarPedido = (l: Selecionado) => l.tipo === "pedido" && !l.faturado_em && FATURAVEL.includes(l.status);

const FILTROS: { rotulo: string; status: StatusPedido[] | null }[] = [
  { rotulo: "Todos", status: null },
  { rotulo: "Rascunho", status: ["rascunho"] },
  { rotulo: "Aguardando crédito", status: ["aguardando_credito"] },
  { rotulo: "Aprovados", status: ["aprovado"] },
  { rotulo: "Em andamento", status: ["em_separacao", "faturado", "em_rota"] },
  { rotulo: "Entregues", status: ["entregue"] },
  { rotulo: "Cancelados", status: ["cancelado", "devolvido"] },
];

export function ListaPedidos({ podeCriar, podeFaturar, podeMontarCarga }: { podeCriar: boolean; podeFaturar: boolean; podeMontarCarga: boolean }) {
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
  const [sel, setSel] = useState<Map<string, Selecionado>>(new Map());
  const [confirmando, setConfirmando] = useState(false);
  const [faturando, setFaturando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoFat | null>(null);
  const [marcandoTodos, setMarcandoTodos] = useState(false);
  const [montando, setMontando] = useState(false);
  const [cargasAbertas, setCargasAbertas] = useState<CargaAberta[]>([]);
  const [fc, setFc] = useState({ destino: "nova", carga_id: "", data: dataLocal(), rota_id: "", motorista_id: "", veiculo_id: "" });
  const [salvandoCarga, setSalvandoCarga] = useState(false);

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

  const paginaMarcada = linhas.length > 0 && linhas.every((l) => sel.has(l.id));
  function marcar(l: Linha) {
    setSel((s) => { const n = new Map(s); if (n.has(l.id)) n.delete(l.id); else n.set(l.id, l); return n; });
  }
  function marcarPagina() {
    setSel((s) => {
      const n = new Map(s);
      if (paginaMarcada) linhas.forEach((l) => n.delete(l.id));
      else linhas.forEach((l) => n.set(l.id, l));
      return n;
    });
  }
  async function marcarTodosDoFiltro() {
    setMarcandoTodos(true);
    const { data, error } = await consulta("id, numero, tipo, status, valor_total, faturado_em, gera_boleto, peso_total_kg, rota_id", false)
      .order("numero", { ascending: false }).limit(1000);
    setMarcandoTodos(false);
    if (error) return toast.error("Não foi possível marcar", { description: mensagemErro(error) });
    setSel(new Map(((data ?? []) as unknown as Selecionado[]).map((l) => [l.id, l])));
  }

  const selecionados = [...sel.values()];
  const totalSel = selecionados.reduce((a, l) => a + Number(l.valor_total), 0);
  const faturaveis = selecionados.filter(podeFaturarPedido);
  const comBoleto = selecionados.filter((l) => l.faturado_em && l.gera_boleto);

  const paraCarga = selecionados.filter((l) => l.tipo === "pedido" && l.status === "aprovado");
  const opcoesCarga = useOpcoesCarga();

  async function abrirMontagem() {
    const rotas = new Map<string, number>();
    paraCarga.forEach((l) => l.rota_id && rotas.set(l.rota_id, (rotas.get(l.rota_id) ?? 0) + 1));
    const rotaComum = [...rotas.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    setFc((f) => ({ ...f, destino: "nova", carga_id: "", rota_id: rotaComum }));
    setMontando(true);
    const { data } = await supabase.from("vw_expedicoes").select("id, numero, data, rota_nome, motorista_nome, qtd_pedidos")
      .eq("status", "montando").order("data", { ascending: false }).limit(50);
    setCargasAbertas((data ?? []) as CargaAberta[]);
  }

  async function montarCarga() {
    if (!paraCarga.length) return;
    setSalvandoCarga(true);
    let cargaId = fc.carga_id;
    if (fc.destino === "nova") {
      if (!fc.data) { setSalvandoCarga(false); return toast.error("Informe a data de saída"); }
      const { data, error } = await supabase.from("expedicoes").insert({
        data: fc.data, rota_id: fc.rota_id || null, motorista_id: fc.motorista_id || null, veiculo_id: fc.veiculo_id || null,
      }).select("id").single();
      if (error) { setSalvandoCarga(false); return toast.error("Não foi possível criar a carga", { description: mensagemErro(error) }); }
      cargaId = data.id;
    } else if (!cargaId) {
      setSalvandoCarga(false);
      return toast.error("Escolha a carga");
    }
    const { data: n, error } = await supabase.rpc("expedicao_incluir_pedidos", { p_expedicao: cargaId, p_pedidos: paraCarga.map((l) => l.id) });
    setSalvandoCarga(false);
    if (error) return toast.error("Não foi possível incluir os pedidos", { description: mensagemErro(error) });
    toast.success(`${n} ${n === 1 ? "pedido incluído" : "pedidos incluídos"} na carga, na ordem de visita dos clientes`);
    setMontando(false);
    setSel(new Map());
    router.push(`/expedicao/cargas/${cargaId}`);
  }

  function abrirLote(rota: string, ids: string[], param = "ids") {
    if (!ids.length) return;
    if (ids.length > LIMITE_LOTE) return toast.error(`Selecione até ${LIMITE_LOTE} pedidos por impressão`);
    window.open(`${rota}?${param}=${ids.join(",")}`, "_blank", "noopener");
  }

  async function faturar() {
    setFaturando(true);
    const ids = faturaveis.map((l) => l.id);
    const { data, error } = await supabase.rpc("pedido_faturar_lote", { p_pedidos: ids });
    setFaturando(false);
    setConfirmando(false);
    if (error) return toast.error("Não foi possível faturar", { description: mensagemErro(error) });
    const r = data as Omit<ResultadoFat, "ids">;
    const comErro = new Set(r.erros.map((e) => e.pedido_id));
    setResultado({ ...r, ids: ids.filter((i) => !comErro.has(i)) });
    setSel(new Map());
    carregar();
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
                <th className="w-9 py-2 pl-3"><input type="checkbox" checked={paginaMarcada} onChange={marcarPagina} aria-label="Marcar os pedidos desta página" className="size-4 accent-[var(--accent)]" /></th>
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
                  <tr key={l.id} onClick={() => router.push(`/vendas/pedidos/${l.id}`)} className={cn("cursor-pointer border-b border-line/70 hover:bg-surface-2/70", sel.has(l.id) && "bg-accent-soft/50")}>
                    <td className="py-2 pl-3" onClick={(e) => { e.stopPropagation(); marcar(l); }}>
                      <input type="checkbox" checked={sel.has(l.id)} onChange={() => undefined} aria-label={`Marcar ${l.tipo === "orcamento" ? "orçamento" : "pedido"} ${l.numero}`} className="size-4 accent-[var(--accent)]" />
                    </td>
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
        {paginaMarcada && total > linhas.length && sel.size < total && (
          <div className="border-b border-line bg-accent-soft/40 px-3 py-2 text-center text-xs">
            Os {linhas.length} desta página estão marcados.{" "}
            <button className="font-medium text-accent underline disabled:opacity-50" disabled={marcandoTodos} onClick={marcarTodosDoFiltro}>
              {marcandoTodos ? "Marcando..." : `Marcar todos os ${Math.min(total, 1000)} deste filtro`}
            </button>
          </div>
        )}

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

      {sel.size > 0 && (
        <div className="sticky bottom-3 z-10 mt-3">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-lg bg-side px-4 py-2.5 text-white shadow-lg">
            <div className="mr-auto text-sm">
              <b className="tabular">{sel.size}</b> {sel.size === 1 ? "marcado" : "marcados"} · <span className="tabular font-semibold">{formatarMoeda(totalSel)}</span>
            </div>
            <Button onClick={() => setSel(new Map())}>Limpar</Button>
            <Button onClick={() => abrirLote("/imprimir/pedidos", selecionados.map((l) => l.id))}><Printer size={16} /> Imprimir pedidos</Button>
            {comBoleto.length > 0 && (
              <Button onClick={() => abrirLote("/imprimir/boletos", comBoleto.map((l) => l.id), "pedidos")}><Printer size={16} /> Boletos ({comBoleto.length})</Button>
            )}
            {podeMontarCarga && (
              <Button disabled={!paraCarga.length} onClick={abrirMontagem}
                title={!paraCarga.length ? "Só pedidos aprovados entram na rota de entrega" : undefined}>
                <Truck size={16} /> Montar rota{paraCarga.length ? ` (${paraCarga.length})` : ""}
              </Button>
            )}
            {podeFaturar && (
              <Button variante="primario" disabled={!faturaveis.length} title={!faturaveis.length ? "Nenhum marcado pode ser faturado (precisa ser pedido aprovado em diante e ainda não faturado)" : undefined}
                onClick={() => setConfirmando(true)}>
                <FileCheck2 size={16} /> Faturar{faturaveis.length ? ` (${faturaveis.length})` : ""}
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialogo aberto={confirmando} titulo={`Faturar ${faturaveis.length} ${faturaveis.length === 1 ? "pedido" : "pedidos"}`} aoFechar={() => setConfirmando(false)}
        rodape={<><Button onClick={() => setConfirmando(false)}>Voltar</Button><Button variante="primario" disabled={faturando} onClick={faturar}>{faturando ? "Faturando..." : "Faturar"}</Button></>}>
        <div className="space-y-2 text-sm">
          <p>
            Total de <b className="tabular">{formatarMoeda(faturaveis.reduce((a, l) => a + Number(l.valor_total), 0))}</b>.
            {faturaveis.some((l) => l.gera_boleto) && <> {faturaveis.filter((l) => l.gera_boleto).length} com boleto.</>}
          </p>
          {faturaveis.length < sel.size && (
            <p className="rounded bg-surface-2 p-2 text-xs text-muted">
              {sel.size - faturaveis.length} dos marcados ficam de fora: orçamentos, rascunhos, aguardando crédito, cancelados ou já faturados.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>As contas a receber são geradas agora, com vencimento contado a partir de hoje.</li>
            <li>Pedido faturado não pode mais ser alterado pelo vendedor nem cancelado (só com estorno em Fiscal › Faturamento).</li>
            <li>Os boletos ficam aguardando o registro no Sicredi para serem impressos.</li>
          </ul>
        </div>
      </Dialogo>

      <Dialogo aberto={montando} titulo={`Montar rota com ${paraCarga.length} ${paraCarga.length === 1 ? "pedido" : "pedidos"}`}
        descricao="Os pedidos entram na carga na ordem de visita dos clientes. Depois você ajusta a ordem, separa e dá saída na tela da carga."
        aoFechar={() => setMontando(false)}
        rodape={<><Button onClick={() => setMontando(false)}>Voltar</Button><Button variante="primario" disabled={salvandoCarga} onClick={montarCarga}><Truck size={16} /> {salvandoCarga ? "Montando..." : "Montar rota"}</Button></>}>
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            {formatarMoeda(paraCarga.reduce((a, l) => a + Number(l.valor_total), 0))} · {paraCarga.reduce((a, l) => a + Number(l.peso_total_kg ?? 0), 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg
            {paraCarga.length < sel.size && <> · {sel.size - paraCarga.length} dos marcados ficam de fora (só pedidos aprovados entram)</>}
          </p>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5"><input type="radio" name="destino" checked={fc.destino === "nova"} onChange={() => setFc({ ...fc, destino: "nova" })} className="accent-[var(--accent)]" /> Nova carga</label>
            <label className={cn("flex items-center gap-1.5", !cargasAbertas.length && "opacity-50")}>
              <input type="radio" name="destino" disabled={!cargasAbertas.length} checked={fc.destino === "existente"} onChange={() => setFc({ ...fc, destino: "existente", carga_id: cargasAbertas[0]?.id ?? "" })} className="accent-[var(--accent)]" />
              Carga em montagem{cargasAbertas.length ? ` (${cargasAbertas.length})` : ""}
            </label>
          </div>
          {fc.destino === "nova" ? (
            <div className="grid grid-cols-2 gap-3">
              <div><Label obrigatorio htmlFor="mc-data">Data de saída</Label><Input id="mc-data" type="date" value={fc.data} onChange={(e) => setFc({ ...fc, data: e.target.value })} /></div>
              <div><Label htmlFor="mc-rota">Rota</Label>
                <Select id="mc-rota" value={fc.rota_id} onChange={(e) => setFc({ ...fc, rota_id: e.target.value })}>
                  <option value="">—</option>{opcoesCarga.rotas.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </Select></div>
              <div><Label htmlFor="mc-mot">Motorista</Label>
                <Select id="mc-mot" value={fc.motorista_id} onChange={(e) => setFc({ ...fc, motorista_id: e.target.value })}>
                  <option value="">—</option>{opcoesCarga.motoristas.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </Select></div>
              <div><Label htmlFor="mc-vei">Veículo</Label>
                <Select id="mc-vei" value={fc.veiculo_id} onChange={(e) => setFc({ ...fc, veiculo_id: e.target.value })}>
                  <option value="">—</option>{opcoesCarga.veiculos.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </Select></div>
            </div>
          ) : (
            <div><Label htmlFor="mc-carga">Carga</Label>
              <Select id="mc-carga" value={fc.carga_id} onChange={(e) => setFc({ ...fc, carga_id: e.target.value })}>
                {cargasAbertas.map((c) => (
                  <option key={c.id} value={c.id}>Carga {c.numero} · {formatarData(c.data)}{c.rota_nome ? ` · ${c.rota_nome}` : ""}{c.motorista_nome ? ` · ${c.motorista_nome}` : ""} · {c.qtd_pedidos} pedidos</option>
                ))}
              </Select></div>
          )}
        </div>
      </Dialogo>

      <Dialogo aberto={!!resultado} titulo="Faturamento concluído" aoFechar={() => setResultado(null)}
        rodape={<>
          <Button onClick={() => setResultado(null)}>Fechar</Button>
          {resultado && resultado.ids.length > 0 && <Button onClick={() => abrirLote("/imprimir/pedidos", resultado.ids)}><Printer size={16} /> Imprimir pedidos</Button>}
          {resultado && resultado.boletos > 0 && <Button variante="primario" onClick={() => abrirLote("/imprimir/boletos", resultado.ids, "pedidos")}><Printer size={16} /> Imprimir boletos</Button>}
        </>}>
        {resultado && (
          <div className="space-y-2 text-sm">
            <p><b>{resultado.faturados}</b> {resultado.faturados === 1 ? "pedido faturado" : "pedidos faturados"}{resultado.boletos > 0 && <>, {resultado.boletos} {resultado.boletos === 1 ? "boleto gerado" : "boletos gerados"}</>}.</p>
            {resultado.erros.length > 0 && (
              <div className="rounded border border-bad/30 bg-bad/5 p-2">
                <div className="mb-1 text-xs font-medium text-bad">{resultado.erros.length} não {resultado.erros.length === 1 ? "foi faturado" : "foram faturados"}</div>
                <ul className="space-y-0.5 text-xs">{resultado.erros.map((e) => <li key={e.pedido_id}><b>Pedido {e.numero}:</b> {e.motivo}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </Dialogo>
    </>
  );
}
