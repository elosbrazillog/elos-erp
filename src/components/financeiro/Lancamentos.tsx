"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Plus, Search } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Abas, Badge, Button, Cabecalho, Card, Input, Vazio } from "@/components/ui";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";
import { exportarExcel } from "@/components/crud/exportar";
import { DialogoBaixa, DialogoBaixaLote, DialogoDetalhe, DialogoNovo, SITUACAO, type Lancamento } from "@/components/financeiro/Dialogos";

const POR_PAGINA = 50;
const ABAS = ["A receber", "A pagar"];
const FILTROS = [
  { k: "abertos", rotulo: "Em aberto" },
  { k: "atrasados", rotulo: "Atrasados (todos)" },
  { k: "quitados", rotulo: "Quitados" },
  { k: "todos", rotulo: "Todos" },
  { k: "cancelados", rotulo: "Cancelados" },
] as const;
type Filtro = (typeof FILTROS)[number]["k"];

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function mesAtual() {
  const h = new Date();
  return { de: local(new Date(h.getFullYear(), h.getMonth(), 1)), ate: local(new Date(h.getFullYear(), h.getMonth() + 1, 0)) };
}
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Lancamentos({ podeCriar, podeEditar }: { podeCriar: boolean; podeEditar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [aba, setAba] = useState(ABAS[0]);
  const tipo = aba === "A receber" ? "receber" : "pagar";
  const [periodo, setPeriodo] = useState(mesAtual);
  const [filtro, setFiltro] = useState<Filtro>("abertos");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Lancamento[] | null>(null);
  const [pagina, setPagina] = useState(0);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [novo, setNovo] = useState(false);
  const [baixa, setBaixa] = useState<Lancamento | null>(null);
  const [lote, setLote] = useState<Lancamento[] | null>(null);
  const [detalhe, setDetalhe] = useState<Lancamento | null>(null);

  const carregar = useCallback(async () => {
    let q = supabase.from("vw_lancamentos").select("*").eq("tipo", tipo);
    if (filtro === "atrasados") q = q.eq("situacao", "atrasado");
    else {
      q = q.gte("data_vencimento", periodo.de).lte("data_vencimento", periodo.ate);
      if (filtro === "cancelados") q = q.eq("ativo", false);
      else {
        q = q.eq("ativo", true);
        if (filtro === "abertos") q = q.is("data_quitacao", null);
        if (filtro === "quitados") q = q.not("data_quitacao", "is", null);
      }
    }
    const { data, error } = await q.order("data_vencimento").order("descricao").limit(3000);
    if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
    setLinhas(data as Lancamento[]);
    setSelecionados(new Set());
    setPagina(0);
  }, [supabase, tipo, filtro, periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  // Totais do período (independem do filtro de situação)
  const [totais, setTotais] = useState({ total: 0, aberto: 0, atrasado: 0, pago: 0 });
  useEffect(() => {
    supabase.from("vw_lancamentos").select("valor, valor_pago, situacao").eq("tipo", tipo).eq("ativo", true)
      .gte("data_vencimento", periodo.de).lte("data_vencimento", periodo.ate).limit(5000)
      .then(({ data }) => {
        const ls = (data ?? []) as { valor: number; valor_pago: number | null; situacao: string }[];
        setTotais({
          total: ls.reduce((a, l) => a + Number(l.valor), 0),
          aberto: ls.filter((l) => l.situacao !== "quitado").reduce((a, l) => a + Number(l.valor), 0),
          atrasado: ls.filter((l) => l.situacao === "atrasado").reduce((a, l) => a + Number(l.valor), 0),
          pago: ls.filter((l) => l.situacao === "quitado").reduce((a, l) => a + Number(l.valor_pago ?? 0), 0),
        });
      });
  }, [supabase, tipo, periodo, linhas]);

  const termo = norm(busca.trim());
  const visiveis = (linhas ?? []).filter((l) => !termo || termo.split(/\s+/).every((t) =>
    norm(`${l.descricao} ${l.documento ?? ""} ${l.pessoa_nome ?? ""} ${l.pessoa_fantasia ?? ""} ${l.pessoa_codigo ?? ""} ${l.plano_conta_nome ?? ""}`).includes(t)));
  const paginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA));
  const pag = visiveis.slice(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA);
  const somaVisiveis = visiveis.reduce((a, l) => a + Number(l.valor), 0);
  const abertosSel = visiveis.filter((l) => selecionados.has(l.id) && l.ativo && !l.data_quitacao);
  const podeMarcar = (l: Lancamento) => podeEditar && l.ativo && !l.data_quitacao;
  const todosMarcados = pag.filter(podeMarcar).length > 0 && pag.filter(podeMarcar).every((l) => selecionados.has(l.id));

  function mudarMes(d: -1 | 1) {
    const base = new Date(`${periodo.de}T12:00:00`);
    const ini = new Date(base.getFullYear(), base.getMonth() + d, 1);
    setPeriodo({ de: local(ini), ate: local(new Date(ini.getFullYear(), ini.getMonth() + 1, 0)) });
  }

  async function exportar() {
    await exportarExcel(`${aba} ${periodo.de} a ${periodo.ate}`,
      ["Vencimento", "Código", "Pessoa", "Descrição", "Documento", "Parcela", "Plano de contas", "Centro de custo", "Forma", "Conta", "Valor", "Situação", "Pago em", "Valor pago", "Juros", "Multa", "Desconto"],
      visiveis.map((l) => [formatarData(l.data_vencimento), l.pessoa_codigo ?? "", l.pessoa_fantasia || l.pessoa_nome || "", l.descricao, l.documento ?? "", `${l.parcela}/${l.total_parcelas}`,
        l.plano_conta_nome ?? "", l.centro_custo_nome ?? "", l.forma_nome ?? "", l.conta_nome ?? "", Number(l.valor), SITUACAO[l.situacao].rotulo,
        formatarData(l.data_quitacao), l.valor_pago === null ? "" : Number(l.valor_pago), Number(l.juros), Number(l.multa), Number(l.desconto)]));
  }

  const verbo = tipo === "receber" ? "Recebido" : "Pago";
  const nomeMesBruto = new Date(`${periodo.de}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const nomeMes = nomeMesBruto.charAt(0).toUpperCase() + nomeMesBruto.slice(1);
  const mesInteiro = periodo.de === local(new Date(new Date(`${periodo.de}T12:00:00`).getFullYear(), new Date(`${periodo.de}T12:00:00`).getMonth(), 1))
    && periodo.ate === local(new Date(new Date(`${periodo.de}T12:00:00`).getFullYear(), new Date(`${periodo.de}T12:00:00`).getMonth() + 1, 0));

  return (
    <>
      <Cabecalho trilha="Financeiro" titulo="Lançamentos"
        acoes={podeCriar && <Button variante="primario" onClick={() => setNovo(true)}><Plus size={16} /> {tipo === "receber" ? "Conta a receber" : "Conta a pagar"}</Button>} />
      <Abas abas={ABAS} ativa={aba} onChange={(a) => { setAba(a); setLinhas(null); }} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button tamanho="p" variante="fantasma" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></Button>
        <span className="min-w-36 text-center text-sm font-medium">{mesInteiro ? nomeMes : "Período"}</span>
        <Button tamanho="p" variante="fantasma" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight size={16} /></Button>
        <label className="flex items-center gap-1.5 text-xs text-muted">De <Input type="date" className="w-auto" value={periodo.de} onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })} /></label>
        <label className="flex items-center gap-1.5 text-xs text-muted">Até <Input type="date" className="w-auto" value={periodo.ate} onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })} /></label>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Previsto no período", totais.total, ""],
          ["Em aberto", totais.aberto, ""],
          ["Em atraso", totais.atrasado, totais.atrasado > 0 ? "text-bad" : ""],
          [verbo, totais.pago, "text-ok"],
        ].map(([r, v, c]) => (
          <Card key={String(r)} className="p-4">
            <div className="text-xs text-muted">{r}</div>
            <div className={cn("tabular mt-1 text-xl font-semibold", String(c))}>{formatarMoeda(v)}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <Input value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} placeholder="Pessoa, descrição, documento ou plano de contas" className="pl-8" aria-label="Buscar" />
          </div>
          <Button onClick={exportar}><Download size={16} /> Excel</Button>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          {FILTROS.map((x) => (
            <button key={x.k} onClick={() => setFiltro(x.k)}
              className={cn("rounded-full border px-3 py-1 text-xs", filtro === x.k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}>{x.rotulo}</button>
          ))}
        </div>

        {abertosSel.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-accent-soft px-3 py-2 text-sm">
            <span className="font-medium">{abertosSel.length} selecionados · {formatarMoeda(abertosSel.reduce((a, l) => a + Number(l.valor), 0))}</span>
            <Button tamanho="p" variante="primario" onClick={() => setLote(abertosSel)}>{tipo === "receber" ? "Receber selecionados" : "Pagar selecionados"}</Button>
            <Button tamanho="p" variante="fantasma" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button>
          </div>
        )}

        {linhas === null ? <div className="px-4 py-10 text-center text-sm text-muted">Carregando...</div>
          : visiveis.length === 0 ? (
            <Vazio titulo="Nenhum lançamento com esses filtros"
              texto={tipo === "receber" ? "Títulos de pedidos aparecem aqui quando a carga sai para entrega." : podeCriar ? "Lance as contas a pagar em Conta a pagar." : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                    <th className="w-10 px-3 py-2">
                      {podeEditar && <input type="checkbox" className="accent-[var(--accent)]" aria-label="Selecionar todos em aberto" checked={todosMarcados}
                        onChange={() => setSelecionados(todosMarcados ? new Set() : new Set(pag.filter(podeMarcar).map((l) => l.id)))} />}
                    </th>
                    <th className="px-3 py-2 font-medium">Vencimento</th>
                    <th className="px-3 py-2 font-medium">{tipo === "receber" ? "Cliente" : "Favorecido"}</th>
                    <th className="px-3 py-2 font-medium">Descrição</th>
                    <th className="hidden px-3 py-2 font-medium lg:table-cell">Forma · conta</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {pag.map((l) => {
                    const st = SITUACAO[l.situacao];
                    return (
                      <tr key={l.id} onClick={() => setDetalhe(l)} className={cn("cursor-pointer border-b border-line/70 hover:bg-surface-2/70", !l.ativo && "text-muted", selecionados.has(l.id) && "bg-accent-soft/50")}>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {podeMarcar(l) && <input type="checkbox" className="accent-[var(--accent)]" aria-label="Selecionar" checked={selecionados.has(l.id)}
                            onChange={() => setSelecionados((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} />}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatarData(l.data_vencimento)}
                          {l.dias_atraso > 0 && <div className="text-xs text-bad">{l.dias_atraso} {l.dias_atraso === 1 ? "dia" : "dias"}</div>}
                        </td>
                        <td className="max-w-56 px-3 py-2"><div className="truncate">{l.pessoa_fantasia || l.pessoa_nome || <span className="text-muted/50">—</span>}</div></td>
                        <td className="max-w-72 px-3 py-2">
                          <div className="truncate">{l.descricao}</div>
                          {l.plano_conta_nome && <div className="truncate text-xs text-muted">{l.plano_conta_nome}</div>}
                        </td>
                        <td className="hidden px-3 py-2 text-xs text-muted lg:table-cell">{[l.forma_nome, l.conta_nome].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                          {formatarMoeda(l.valor)}
                          {l.data_quitacao && Number(l.valor_pago) !== Number(l.valor) && <div className="text-xs text-muted">pago {formatarMoeda(l.valor_pago)}</div>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Badge tom={st.tom}>{st.rotulo}</Badge>
                          {l.data_quitacao && <div className="text-xs text-muted">{formatarData(l.data_quitacao)}</div>}
                        </td>
                        <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                          {podeMarcar(l) && <Button tamanho="p" onClick={() => setBaixa(l)}>{tipo === "receber" ? "Receber" : "Pagar"}</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
          <span className="tabular">{visiveis.length} lançamentos · {formatarMoeda(somaVisiveis)}</span>
          <div className="flex items-center gap-2">
            <Button tamanho="p" variante="fantasma" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></Button>
            <span className="tabular">Página {pagina + 1} de {paginas}</span>
            <Button tamanho="p" variante="fantasma" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página"><ChevronRight size={16} /></Button>
          </div>
        </div>
      </Card>

      <DialogoNovo tipo={tipo} aberto={novo} aoFechar={() => setNovo(false)} aoConcluir={carregar} />
      <DialogoBaixa lancamento={baixa} aoFechar={() => setBaixa(null)} aoConcluir={carregar} />
      <DialogoBaixaLote lancamentos={lote} aoFechar={() => setLote(null)} aoConcluir={carregar} />
      <DialogoDetalhe lancamento={detalhe} podeEditar={podeEditar} aoFechar={() => setDetalhe(null)} aoConcluir={carregar}
        aoBaixar={(l) => { setDetalhe(null); setBaixa(l); }} />
    </>
  );
}
