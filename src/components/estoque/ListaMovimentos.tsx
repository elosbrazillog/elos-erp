"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, PackagePlus, Search } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Cabecalho, Card, Input, Select, Vazio } from "@/components/ui";
import { cn, formatarData, formatarNumero } from "@/lib/utils";
import { ORIGEM_MOVIMENTO, TIPO_MOVIMENTO, mensagemErro } from "@/lib/pedidos";
import { exportarExcel } from "@/components/crud/exportar";
import { DialogoEntrada, useDepositos } from "@/components/estoque/Dialogos";

const POR_PAGINA = 50;
type Mov = {
  id: string; data: string; tipo: string; origem: string; deposito_nome: string; produto_codigo: string; produto_nome: string;
  lote_numero: string | null; validade: string | null; quantidade_sinal: number; observacao: string | null; usuario_nome: string | null;
};

const dataHora = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function ListaMovimentos({ podeMovimentar }: { podeMovimentar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const { depositos } = useDepositos();
  const [linhas, setLinhas] = useState<Mov[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [tipo, setTipo] = useState("");
  const [deposito, setDeposito] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [entrada, setEntrada] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const consulta = useCallback((contagem: boolean) => {
    let q = supabase.from("vw_estoque_movimentos").select("*", contagem ? { count: "exact" } : undefined);
    if (tipo === "transferencia") q = q.in("tipo", ["transferencia_saida", "transferencia_entrada"]);
    else if (tipo === "ajuste") q = q.in("tipo", ["ajuste_entrada", "ajuste_saida"]);
    else if (tipo) q = q.eq("tipo", tipo);
    if (deposito) q = q.eq("deposito_id", deposito);
    if (de) q = q.gte("data", `${de}T00:00:00`);
    if (ate) q = q.lte("data", `${ate}T23:59:59`);
    const t = buscaAplicada.replace(/[,()%*\\]/g, " ").trim();
    if (t) q = q.or(`produto_codigo.ilike.%${t}%,produto_nome.ilike.%${t}%,lote_numero.ilike.%${t}%,observacao.ilike.%${t}%`);
    return q.order("data", { ascending: false });
  }, [supabase, tipo, deposito, de, ate, buscaAplicada]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, count, error } = await consulta(true).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    setCarregando(false);
    if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
    setLinhas((data ?? []) as Mov[]);
    setTotal(count ?? 0);
  }, [consulta, pagina]);

  useEffect(() => { carregar(); }, [carregar]);

  function aoDigitar(v: string) {
    setBusca(v);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => { setPagina(0); setBuscaAplicada(v); }, 350);
  }

  async function exportar() {
    const { data, error } = await consulta(false).limit(5000);
    if (error) return toast.error("Não foi possível exportar", { description: mensagemErro(error) });
    await exportarExcel("Movimentações de estoque", ["Data", "Tipo", "Origem", "Depósito", "Código", "Produto", "Lote", "Validade", "Quantidade", "Observação", "Usuário"],
      ((data ?? []) as Mov[]).map((m) => [dataHora(m.data), TIPO_MOVIMENTO[m.tipo] ?? m.tipo, ORIGEM_MOVIMENTO[m.origem] ?? m.origem, m.deposito_nome, m.produto_codigo, m.produto_nome,
        m.lote_numero ?? "", formatarData(m.validade), Number(m.quantidade_sinal), m.observacao ?? "", m.usuario_nome ?? ""]));
  }

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const reset = <T,>(f: (v: T) => void) => (v: T) => { setPagina(0); f(v); };

  return (
    <>
      <Cabecalho trilha="Estoque" titulo="Movimentações"
        acoes={podeMovimentar && <Button variante="primario" onClick={() => setEntrada(true)}><PackagePlus size={16} /> Entrada</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <Input value={busca} onChange={(e) => aoDigitar(e.target.value)} placeholder="Produto, lote ou observação" className="pl-8" aria-label="Buscar" />
          </div>
          <Select value={tipo} onChange={(e) => reset(setTipo)(e.target.value)} className="w-auto" aria-label="Tipo">
            <option value="">Todos os tipos</option>
            <option value="entrada">Entradas</option>
            <option value="saida">Saídas</option>
            <option value="perda">Perdas</option>
            <option value="ajuste">Ajustes</option>
            <option value="transferencia">Transferências</option>
            <option value="devolucao">Devoluções</option>
          </Select>
          <Select value={deposito} onChange={(e) => reset(setDeposito)(e.target.value)} className="w-auto" aria-label="Depósito">
            <option value="">Todos os depósitos</option>
            {depositos.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted">De <Input type="date" value={de} onChange={(e) => reset(setDe)(e.target.value)} className="w-auto" /></label>
          <label className="flex items-center gap-1.5 text-xs text-muted">Até <Input type="date" value={ate} onChange={(e) => reset(setAte)(e.target.value)} className="w-auto" /></label>
          <Button onClick={exportar}><Download size={16} /> Excel</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Produto</th>
                <th className="px-3 py-2 font-medium">Lote</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Depósito</th>
                <th className="px-3 py-2 text-right font-medium">Qtd</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Observação</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Usuário</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((m) => (
                <tr key={m.id} className="border-b border-line/70">
                  <td className="px-3 py-2 whitespace-nowrap">{dataHora(m.data)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {TIPO_MOVIMENTO[m.tipo] ?? m.tipo}
                    {m.origem !== "manual" && <div className="text-xs text-muted">{ORIGEM_MOVIMENTO[m.origem] ?? m.origem}</div>}
                  </td>
                  <td className="px-3 py-2"><span className="text-muted">{m.produto_codigo}</span> {m.produto_nome}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{m.lote_numero ?? <span className="text-muted/50">—</span>}{m.validade && <div className="text-xs text-muted">val. {formatarData(m.validade)}</div>}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{m.deposito_nome}</td>
                  <td className={cn("tabular px-3 py-2 text-right font-medium whitespace-nowrap", Number(m.quantidade_sinal) < 0 ? "text-bad" : "text-ok")}>
                    {Number(m.quantidade_sinal) > 0 ? "+" : "−"}{formatarNumero(Math.abs(Number(m.quantidade_sinal)))}
                  </td>
                  <td className="hidden max-w-60 truncate px-3 py-2 text-muted lg:table-cell" title={m.observacao ?? undefined}>{m.observacao}</td>
                  <td className="hidden px-3 py-2 text-muted lg:table-cell">{m.usuario_nome}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!carregando && linhas.length === 0 && <Vazio titulo="Nenhuma movimentação" texto={podeMovimentar ? "Entradas, perdas, ajustes e transferências aparecem aqui, com quem lançou." : undefined} />}
          {carregando && linhas.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">Carregando...</div>}
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
          <span className="tabular">{total} {total === 1 ? "movimentação" : "movimentações"}</span>
          <div className="flex items-center gap-2">
            <Button tamanho="p" variante="fantasma" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></Button>
            <span className="tabular">Página {pagina + 1} de {paginas}</span>
            <Button tamanho="p" variante="fantasma" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página"><ChevronRight size={16} /></Button>
          </div>
        </div>
      </Card>
      <DialogoEntrada aberto={entrada} aoFechar={() => setEntrada(false)} aoConcluir={carregar} />
    </>
  );
}
