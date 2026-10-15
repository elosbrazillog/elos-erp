"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileCheck2, Printer, RefreshCw, Search, Undo2 } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Textarea, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, formatarData, formatarMoeda, dataLocal } from "@/lib/utils";
import { STATUS_PEDIDO, mensagemErro, type StatusPedido } from "@/lib/pedidos";

type Linha = {
  id: string; numero: number; status: StatusPedido; data_emissao: string; data_entrega: string | null; valor_total: number; faturado_em: string | null;
  cliente_nome: string; cliente_fantasia: string | null; vendedor_nome: string | null; rota_nome: string | null; rota_id: string | null;
  condicao_nome: string | null; forma_nome: string | null; gera_boleto: boolean; carga_id: string | null; carga_numero: number | null;
  boletos: number; boletos_registrados: number;
};
type Resultado = { faturados: number; boletos: number; erros: { pedido_id: string; numero: number; motivo: string }[]; ids: string[] };

const hojeMenos = (dias: number) => dataLocal(-dias);
const LIMITE_IMPRESSAO = 150;

export function Faturamento({ podeFaturar }: { podeFaturar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [aba, setAba] = useState<"a_faturar" | "faturados">("a_faturar");
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [rota, setRota] = useState("");
  const [carga, setCarga] = useState("");
  const [forma, setForma] = useState("");
  const [de, setDe] = useState(hojeMenos(7));
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [estornando, setEstornando] = useState<Linha | null>(null);
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    let q = supabase.from("vw_faturamento").select("*");
    q = aba === "a_faturar" ? q.is("faturado_em", null) : q.not("faturado_em", "is", null).gte("faturado_em", `${de}T00:00:00`);
    const { data, error } = await q.order("numero", { ascending: false }).limit(2000);
    if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
    setLinhas((data ?? []) as Linha[]);
  }, [supabase, aba, de]);
  useEffect(() => { setLinhas(null); setSel(new Set()); carregar(); }, [carregar]);

  const todas = linhas ?? [];
  const rotas = [...new Map(todas.filter((l) => l.rota_id).map((l) => [l.rota_id!, l.rota_nome ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cargas = [...new Map(todas.filter((l) => l.carga_id).map((l) => [l.carga_id!, l.carga_numero!])).entries()].sort((a, b) => b[1] - a[1]);
  const formas = [...new Set(todas.map((l) => l.forma_nome ?? "Sem forma"))].sort();
  const t = busca.trim().toLowerCase();
  const visiveis = todas.filter((l) =>
    (!rota || l.rota_id === rota) && (!carga || l.carga_id === carga) && (!forma || (l.forma_nome ?? "Sem forma") === forma) &&
    (!t || `${l.numero} ${l.cliente_nome} ${l.cliente_fantasia ?? ""} ${l.vendedor_nome ?? ""}`.toLowerCase().includes(t)));
  const selecionadas = todas.filter((l) => sel.has(l.id));
  const totalSel = selecionadas.reduce((a, l) => a + Number(l.valor_total), 0);
  const comBoletoSel = selecionadas.filter((l) => (aba === "a_faturar" ? l.gera_boleto : l.boletos > 0)).length;
  const todasMarcadas = visiveis.length > 0 && visiveis.every((l) => sel.has(l.id));

  function marcar(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function marcarTodas() {
    setSel((s) => {
      const n = new Set(s);
      if (todasMarcadas) visiveis.forEach((l) => n.delete(l.id));
      else visiveis.forEach((l) => n.add(l.id));
      return n;
    });
  }

  async function faturar() {
    setOcupado(true);
    const ids = selecionadas.map((l) => l.id);
    const { data, error } = await supabase.rpc("pedido_faturar_lote", { p_pedidos: ids });
    setOcupado(false);
    setConfirmando(false);
    if (error) return toast.error("Não foi possível faturar", { description: mensagemErro(error) });
    const r = data as Omit<Resultado, "ids">;
    const comErro = new Set(r.erros.map((e) => e.pedido_id));
    setResultado({ ...r, ids: ids.filter((i) => !comErro.has(i)) });
    setSel(new Set());
    carregar();
  }

  async function estornar() {
    if (!estornando) return;
    if (!motivo.trim()) return toast.error("Informe o motivo");
    setOcupado(true);
    const { error } = await supabase.rpc("pedido_estornar_faturamento", { p_pedido: estornando.id, p_motivo: motivo });
    setOcupado(false);
    if (error) return toast.error("Não foi possível estornar", { description: mensagemErro(error) });
    toast.success(`Faturamento do pedido ${estornando.numero} estornado`);
    setEstornando(null);
    setMotivo("");
    setSel(new Set());
    carregar();
  }

  function imprimirBoletos(ids: string[]) {
    if (!ids.length) return;
    if (ids.length > LIMITE_IMPRESSAO) return toast.error(`Selecione até ${LIMITE_IMPRESSAO} pedidos por impressão`);
    window.open(`/imprimir/boletos?pedidos=${ids.join(",")}`, "_blank", "noopener");
  }

  return (
    <>
      <Cabecalho trilha="Fiscal" titulo="Faturamento"
        acoes={<Button onClick={carregar}><RefreshCw size={16} /> Atualizar</Button>} />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {([["a_faturar", "A faturar"], ["faturados", "Faturados"]] as const).map(([k, r]) => (
          <button key={k} onClick={() => setAba(k)} aria-pressed={aba === k}
            className={cn("rounded-full border px-3 py-1 text-sm", aba === k ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted")}>{r}</button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pedido, cliente ou vendedor" className="pl-8" aria-label="Buscar" />
          </div>
          <Select value={rota} onChange={(e) => setRota(e.target.value)} aria-label="Rota" className="w-44">
            <option value="">Todas as rotas</option>
            {rotas.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </Select>
          <Select value={carga} onChange={(e) => setCarga(e.target.value)} aria-label="Carga" className="w-36">
            <option value="">Todas as cargas</option>
            {cargas.map(([id, n]) => <option key={id} value={id}>Carga {n}</option>)}
          </Select>
          <Select value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma de pagamento" className="w-40">
            <option value="">Toda forma</option>
            {formas.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
          {aba === "faturados" && (
            <div className="flex items-center gap-1.5 text-sm"><Label htmlFor="fat-de">Faturados desde</Label><Input id="fat-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" /></div>
          )}
        </div>

        {linhas === null ? <div className="py-10 text-center text-sm text-muted">Carregando...</div>
          : visiveis.length === 0 ? (
            <Vazio titulo={aba === "a_faturar" ? "Nenhum pedido para faturar" : "Nenhum pedido faturado no período"}
              texto={aba === "a_faturar" ? "Aparecem aqui os pedidos aprovados, em separação, em rota ou entregues que ainda não foram faturados." : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-muted">
                  <tr>
                    <th className="w-10 px-3 py-2"><input type="checkbox" checked={todasMarcadas} onChange={marcarTodas} aria-label="Marcar todos" className="size-4 accent-[var(--accent)]" /></th>
                    <th className="px-2 py-2 font-medium">Pedido</th>
                    <th className="px-2 py-2 font-medium">Cliente</th>
                    <th className="hidden px-2 py-2 font-medium lg:table-cell">Vendedor</th>
                    <th className="hidden px-2 py-2 font-medium md:table-cell">Rota / carga</th>
                    <th className="px-2 py-2 font-medium">Pagamento</th>
                    <th className="px-2 py-2 text-right font-medium">Valor</th>
                    <th className="px-2 py-2 font-medium">Situação</th>
                    {aba === "faturados" && <th className="px-2 py-2 font-medium">Boletos</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {visiveis.map((l) => {
                    const st = STATUS_PEDIDO[l.status];
                    return (
                      <tr key={l.id} className={cn("cursor-pointer hover:bg-surface-2/60", sel.has(l.id) && "bg-accent-soft/50")} onClick={() => marcar(l.id)}>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={sel.has(l.id)} onChange={() => marcar(l.id)} aria-label={`Marcar pedido ${l.numero}`} className="size-4 accent-[var(--accent)]" />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <Link href={`/vendas/pedidos/${l.id}`} onClick={(e) => e.stopPropagation()} className="tabular font-medium hover:text-accent">{l.numero}</Link>
                          <div className="text-xs text-muted">{formatarData(l.data_emissao)}</div>
                        </td>
                        <td className="max-w-64 px-2 py-2"><div className="truncate">{l.cliente_fantasia || l.cliente_nome}</div></td>
                        <td className="hidden px-2 py-2 lg:table-cell">{l.vendedor_nome ?? <span className="text-muted/50">—</span>}</td>
                        <td className="hidden px-2 py-2 md:table-cell">
                          {l.rota_nome ?? <span className="text-muted/50">—</span>}
                          {l.carga_numero && <div className="text-xs text-muted">Carga {l.carga_numero}</div>}
                        </td>
                        <td className="px-2 py-2">
                          <div>{l.forma_nome ?? <span className="text-muted/50">—</span>}</div>
                          <div className="text-xs text-muted">{l.condicao_nome}</div>
                        </td>
                        <td className="tabular px-2 py-2 text-right whitespace-nowrap">{formatarMoeda(l.valor_total)}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <Badge tom={st.tom}>{st.rotulo}</Badge>
                          {l.faturado_em && <div className="mt-0.5 text-xs text-muted">fat. {formatarData(l.faturado_em)}</div>}
                        </td>
                        {aba === "faturados" && (
                          <td className="px-2 py-2 text-xs whitespace-nowrap">
                            {l.boletos === 0 ? <span className="text-muted">—</span>
                              : l.boletos_registrados === l.boletos ? <Badge tom="ok">{l.boletos} registrado{l.boletos > 1 ? "s" : ""}</Badge>
                              : <Badge tom="aviso">{l.boletos - l.boletos_registrados} a registrar</Badge>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      {sel.size > 0 && (
        <div className="sticky bottom-3 z-10 mt-3">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-lg bg-side px-4 py-2.5 text-white shadow-lg">
            <div className="flex-1 text-sm">
              <b className="tabular">{sel.size}</b> {sel.size === 1 ? "pedido" : "pedidos"} · <span className="tabular font-semibold">{formatarMoeda(totalSel)}</span>
              {comBoletoSel > 0 && <span className="text-side-ink"> · {comBoletoSel} com boleto</span>}
            </div>
            <Button onClick={() => setSel(new Set())}>Limpar</Button>
            {aba === "a_faturar" && podeFaturar && (
              <Button variante="primario" onClick={() => setConfirmando(true)}><FileCheck2 size={16} /> Faturar selecionados</Button>
            )}
            {aba === "faturados" && (
              <>
                {podeFaturar && sel.size === 1 && (
                  <Button onClick={() => { setMotivo(""); setEstornando(selecionadas[0]); }}><Undo2 size={16} /> Estornar</Button>
                )}
                <Button variante="primario" disabled={comBoletoSel === 0} onClick={() => imprimirBoletos(selecionadas.filter((l) => l.boletos > 0).map((l) => l.id))}>
                  <Printer size={16} /> Imprimir boletos
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <Dialogo aberto={confirmando} titulo={`Faturar ${sel.size} ${sel.size === 1 ? "pedido" : "pedidos"}`} aoFechar={() => setConfirmando(false)}
        rodape={<><Button onClick={() => setConfirmando(false)}>Voltar</Button><Button variante="primario" disabled={ocupado} onClick={faturar}>{ocupado ? "Faturando..." : "Faturar"}</Button></>}>
        <div className="space-y-2 text-sm">
          <p>Total de <b className="tabular">{formatarMoeda(totalSel)}</b>. {comBoletoSel > 0 && <>{comBoletoSel} {comBoletoSel === 1 ? "pedido paga" : "pedidos pagam"} com boleto.</>}</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>As contas a receber são geradas agora, com vencimento contado a partir de hoje.</li>
            <li>Pedido faturado não pode mais ser alterado pelo vendedor nem cancelado (só com estorno do faturamento).</li>
            <li>Os boletos ficam aguardando o registro no Sicredi para serem impressos.</li>
          </ul>
        </div>
      </Dialogo>

      <Dialogo aberto={!!resultado} titulo="Faturamento concluído" aoFechar={() => setResultado(null)}
        rodape={<>
          <Button onClick={() => setResultado(null)}>Fechar</Button>
          {resultado && resultado.boletos > 0 && (
            <Button variante="primario" onClick={() => imprimirBoletos(resultado.ids)}><Printer size={16} /> Imprimir boletos</Button>
          )}
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

      <Dialogo aberto={!!estornando} titulo={`Estornar faturamento do pedido ${estornando?.numero ?? ""}`} aoFechar={() => setEstornando(null)}
        descricao="As contas a receber e os boletos ainda não registrados são cancelados, e o pedido volta a poder ser alterado."
        rodape={<><Button onClick={() => setEstornando(null)}>Voltar</Button><Button variante="perigo" disabled={ocupado} onClick={estornar}>Estornar</Button></>}>
        <Label htmlFor="est-motivo" obrigatorio>Motivo</Label>
        <Textarea id="est-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Dialogo>
    </>
  );
}
