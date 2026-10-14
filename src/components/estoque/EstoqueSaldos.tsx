"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, Download, PackagePlus, Search } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Abas, Badge, Button, Cabecalho, Card, Input, Select, Vazio } from "@/components/ui";
import { cn, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { mensagemErro, situacaoValidade } from "@/lib/pedidos";
import { exportarExcel } from "@/components/crud/exportar";
import { DialogoEntrada, DialogoMovimento, useDepositos, type SaldoLote } from "@/components/estoque/Dialogos";

type Produto = {
  produto_id: string; produto_codigo: string; produto_nome: string; estoque_minimo: number;
  quantidade: number; quantidade_reservada: number; disponivel: number; quantidade_vencida: number; proxima_validade: string | null; lotes: number;
};
type Lote = SaldoLote & { produto_id: string; dias_para_vencer: number | null; fabricacao: string | null; valor_custo: number };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const diasAte = (d: string | null) => (d ? Math.round((new Date(`${d}T12:00:00`).getTime() - new Date(new Date().toISOString().slice(0, 10) + "T12:00:00").getTime()) / 86400000) : null);

export function EstoqueSaldos({ podeMovimentar }: { podeMovimentar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const { depositos } = useDepositos();
  const [aba, setAba] = useState("Por produto");
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [busca, setBusca] = useState("");
  const [deposito, setDeposito] = useState("");
  const [filtro, setFiltro] = useState<string | null>(null);
  const [entrada, setEntrada] = useState(false);
  const [movimento, setMovimento] = useState<SaldoLote | null>(null);

  const carregar = useCallback(async () => {
    const [p, l] = await Promise.all([
      supabase.from("vw_estoque_produtos").select("*").order("produto_nome").limit(5000),
      supabase.from("vw_estoque").select("*").order("produto_nome").order("validade", { nullsFirst: false }).limit(5000),
    ]);
    if (p.error || l.error) return toast.error("Não foi possível carregar o estoque", { description: mensagemErro(p.error ?? l.error) });
    setProdutos(p.data as Produto[]);
    setLotes(l.data as Lote[]);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  const termo = norm(busca.trim());
  const casa = (codigo: string, nome: string, lote?: string | null) => !termo || termo.split(/\s+/).every((t) => norm(`${codigo} ${nome} ${lote ?? ""}`).includes(t));

  const listaProdutos = (produtos ?? []).filter((p) => {
    if (!casa(p.produto_codigo, p.produto_nome)) return false;
    if (filtro === "sem") return Number(p.quantidade) <= 0;
    if (filtro === "minimo") return Number(p.estoque_minimo) > 0 && Number(p.disponivel) < Number(p.estoque_minimo);
    if (filtro === "com") return Number(p.quantidade) > 0;
    return true;
  });
  const listaLotes = (lotes ?? []).filter((l) => {
    if (deposito && l.deposito_id !== deposito) return false;
    if (!casa(l.produto_codigo, l.produto_nome, l.lote_numero)) return false;
    if (filtro === "vencidos") return l.dias_para_vencer !== null && l.dias_para_vencer < 0;
    if (filtro === "30") return l.dias_para_vencer !== null && l.dias_para_vencer >= 0 && l.dias_para_vencer <= 30;
    if (filtro === "reservados") return Number(l.quantidade_reservada) > 0;
    return true;
  });

  const totais = useMemo(() => {
    const ls = lotes ?? [];
    return {
      valor: ls.reduce((a, l) => a + Number(l.valor_custo ?? 0), 0),
      vencidos: ls.filter((l) => l.dias_para_vencer !== null && l.dias_para_vencer < 0 && Number(l.quantidade) > 0).length,
      vencendo: ls.filter((l) => l.dias_para_vencer !== null && l.dias_para_vencer >= 0 && l.dias_para_vencer <= 30 && Number(l.quantidade) > 0).length,
      semEstoque: (produtos ?? []).filter((p) => Number(p.quantidade) <= 0).length,
    };
  }, [lotes, produtos]);

  async function exportar() {
    if (aba === "Por produto") {
      await exportarExcel("Estoque por produto", ["Código", "Produto", "Quantidade", "Reservado", "Disponível", "Vencido", "Estoque mínimo", "Próxima validade", "Lotes"],
        listaProdutos.map((p) => [p.produto_codigo, p.produto_nome, Number(p.quantidade), Number(p.quantidade_reservada), Number(p.disponivel), Number(p.quantidade_vencida), Number(p.estoque_minimo), formatarData(p.proxima_validade), Number(p.lotes)]));
    } else {
      await exportarExcel("Estoque por lote", ["Código", "Produto", "Depósito", "Lote", "Fabricação", "Validade", "Dias para vencer", "Quantidade", "Reservado", "Disponível", "Valor de custo"],
        listaLotes.map((l) => [l.produto_codigo, l.produto_nome, l.deposito_nome, l.lote_numero ?? "", formatarData(l.fabricacao), formatarData(l.validade), l.dias_para_vencer ?? "", Number(l.quantidade), Number(l.quantidade_reservada), Number(l.disponivel), Number(l.valor_custo)]));
    }
  }

  const chips = aba === "Por produto"
    ? [["com", "Com estoque"], ["sem", "Sem estoque"], ["minimo", "Abaixo do mínimo"]]
    : [["vencidos", "Vencidos"], ["30", "Vencem em 30 dias"], ["reservados", "Com reserva"]];

  return (
    <>
      <Cabecalho
        trilha="Estoque"
        titulo="Saldos por lote"
        acoes={podeMovimentar && <Button variante="primario" onClick={() => setEntrada(true)}><PackagePlus size={16} /> Entrada</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Valor em estoque (custo)", formatarMoeda(totais.valor), null, null],
          ["Lotes vencidos", String(totais.vencidos), totais.vencidos > 0 ? "erro" : null, "vencidos"],
          ["Vencem em 30 dias", String(totais.vencendo), totais.vencendo > 0 ? "aviso" : null, "30"],
          ["Produtos sem estoque", String(totais.semEstoque), null, "sem"],
        ].map(([r, v, tom, f]) => (
          <button key={String(r)} disabled={!f} onClick={() => { if (!f) return; setAba(f === "sem" ? "Por produto" : "Por lote"); setFiltro(String(f)); }}
            className="rounded-lg border border-line bg-surface p-4 text-left transition-colors enabled:hover:border-accent">
            <div className="text-xs text-muted">{r}</div>
            <div className={cn("tabular mt-1 text-xl font-semibold", tom === "erro" && "text-bad", tom === "aviso" && "text-warn")}>{v}</div>
          </button>
        ))}
      </div>

      <Abas abas={["Por produto", "Por lote"]} ativa={aba} onChange={(a) => { setAba(a); setFiltro(null); }} />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={aba === "Por lote" ? "Produto ou lote" : "Código ou nome do produto"} className="pl-8" aria-label="Buscar" />
          </div>
          {aba === "Por lote" && (
            <Select value={deposito} onChange={(e) => setDeposito(e.target.value)} className="w-auto" aria-label="Depósito">
              <option value="">Todos os depósitos</option>
              {depositos.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
            </Select>
          )}
          <Button onClick={exportar}><Download size={16} /> Excel</Button>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          {chips.map(([v, r]) => (
            <button key={v} onClick={() => setFiltro(filtro === v ? null : v)}
              className={cn("rounded-full border px-3 py-1 text-xs", filtro === v ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}>{r}</button>
          ))}
        </div>

        {produtos === null ? (
          <div className="px-4 py-10 text-center text-sm text-muted">Carregando...</div>
        ) : aba === "Por produto" ? (
          listaProdutos.length === 0 ? <Vazio titulo="Nenhum produto com esses filtros" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Produto</th>
                    <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                    <th className="px-3 py-2 text-right font-medium">Reservado</th>
                    <th className="px-3 py-2 text-right font-medium">Disponível</th>
                    <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Mínimo</th>
                    <th className="px-3 py-2 font-medium">Próxima validade</th>
                  </tr>
                </thead>
                <tbody>
                  {listaProdutos.map((p) => {
                    const abaixo = Number(p.estoque_minimo) > 0 && Number(p.disponivel) < Number(p.estoque_minimo);
                    const sv = situacaoValidade(diasAte(p.proxima_validade));
                    return (
                      <tr key={p.produto_id} className="cursor-pointer border-b border-line/70 hover:bg-surface-2/70"
                        onClick={() => { setAba("Por lote"); setBusca(p.produto_codigo); setFiltro(null); }}>
                        <td className="px-3 py-2">
                          <span className="text-muted">{p.produto_codigo}</span> {p.produto_nome}
                          {Number(p.quantidade_vencida) > 0 && <span className="ml-2"><Badge tom="erro">{formatarNumero(p.quantidade_vencida)} vencido</Badge></span>}
                        </td>
                        <td className={cn("tabular px-3 py-2 text-right", Number(p.quantidade) <= 0 && "text-muted")}>{formatarNumero(p.quantidade)}</td>
                        <td className="tabular px-3 py-2 text-right">{Number(p.quantidade_reservada) ? formatarNumero(p.quantidade_reservada) : <span className="text-muted/50">—</span>}</td>
                        <td className={cn("tabular px-3 py-2 text-right font-medium", abaixo && "text-warn")}>{formatarNumero(p.disponivel)}</td>
                        <td className="tabular hidden px-3 py-2 text-right md:table-cell">{Number(p.estoque_minimo) ? formatarNumero(p.estoque_minimo) : <span className="text-muted/50">—</span>}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {p.proxima_validade ? formatarData(p.proxima_validade) : <span className="text-muted/50">—</span>}
                          {sv && <span className="ml-2"><Badge tom={sv.tom}>{sv.rotulo}</Badge></span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : listaLotes.length === 0 ? (
          <Vazio titulo={(lotes ?? []).length ? "Nenhum lote com esses filtros" : "Nenhum estoque lançado"} texto={(lotes ?? []).length ? undefined : podeMovimentar ? "Use Entrada para lançar o estoque atual de cada produto, com lote e validade." : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">Lote</th>
                  <th className="px-3 py-2 font-medium">Validade</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Depósito</th>
                  <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                  <th className="px-3 py-2 text-right font-medium">Reservado</th>
                  <th className="px-3 py-2 text-right font-medium">Disponível</th>
                  {podeMovimentar && <th className="w-12" />}
                </tr>
              </thead>
              <tbody>
                {listaLotes.map((l) => {
                  const sv = situacaoValidade(l.dias_para_vencer);
                  return (
                    <tr key={l.id} className={cn("border-b border-line/70", sv?.tom === "erro" && "bg-bad/5")}>
                      <td className="px-3 py-2"><span className="text-muted">{l.produto_codigo}</span> {l.produto_nome}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{l.lote_numero ?? <span className="text-muted/50">sem lote</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {l.validade ? formatarData(l.validade) : <span className="text-muted/50">—</span>}
                        {sv && <span className="ml-2"><Badge tom={sv.tom}>{sv.rotulo}</Badge></span>}
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell">{l.deposito_nome}</td>
                      <td className="tabular px-3 py-2 text-right">{formatarNumero(l.quantidade)}</td>
                      <td className="tabular px-3 py-2 text-right">{Number(l.quantidade_reservada) ? formatarNumero(l.quantidade_reservada) : <span className="text-muted/50">—</span>}</td>
                      <td className="tabular px-3 py-2 text-right font-medium">{formatarNumero(l.disponivel)}</td>
                      {podeMovimentar && (
                        <td className="px-1 py-1">
                          <Button tamanho="p" variante="fantasma" onClick={() => setMovimento(l)} aria-label={`Movimentar lote ${l.lote_numero ?? ""}`} title="Perda, ajuste ou transferência">
                            <ArrowLeftRight size={15} />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-3 py-2 text-xs text-muted">
          {aba === "Por produto" ? `${listaProdutos.length} produtos` : `${listaLotes.length} lotes`}
        </div>
      </Card>

      <DialogoEntrada aberto={entrada} aoFechar={() => setEntrada(false)} aoConcluir={carregar} />
      <DialogoMovimento saldo={movimento} aoFechar={() => setMovimento(null)} aoConcluir={carregar} />
    </>
  );
}
