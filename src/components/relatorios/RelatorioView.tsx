"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Label, Select, Vazio } from "@/components/ui";
import { carregarOpcoesRelacao } from "@/components/crud/CampoInput";
import { cn, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";
import { exportarExcel } from "@/components/crud/exportar";
import { obterRelatorio, type Coluna } from "@/lib/relatorios";
import { Grafico } from "@/components/relatorios/Grafico";
import type { Opcao } from "@/lib/entidades";

type Linha = Record<string, unknown>;
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function atalhos() {
  const h = new Date();
  const y = h.getFullYear(), m = h.getMonth();
  return [
    { rotulo: "Este mês", de: local(new Date(y, m, 1)), ate: local(new Date(y, m + 1, 0)) },
    { rotulo: "Mês passado", de: local(new Date(y, m - 1, 1)), ate: local(new Date(y, m, 0)) },
    { rotulo: "Últimos 30 dias", de: local(new Date(Date.now() - 29 * 864e5)), ate: local(h) },
    { rotulo: "Este ano", de: local(new Date(y, 0, 1)), ate: local(new Date(y, 11, 31)) },
  ];
}

function celula(c: Coluna, v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-muted/50">—</span>;
  switch (c.tipo) {
    case "moeda": return formatarMoeda(v);
    case "numero": return formatarNumero(v);
    case "inteiro": return Number(v).toLocaleString("pt-BR");
    case "pct": return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "data": return formatarData(v);
    case "classe": return <Badge tom={v === "A" ? "acento" : v === "B" ? "aviso" : "neutro"}>{String(v)}</Badge>;
    default: return String(v);
  }
}
function textoExcel(c: Coluna, v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (c.tipo === "moeda" || c.tipo === "numero" || c.tipo === "inteiro" || c.tipo === "pct") return Number(v);
  if (c.tipo === "data") return formatarData(v);
  return String(v);
}
const direita = (c: Coluna) => ["moeda", "numero", "inteiro", "pct"].includes(c.tipo ?? "");

export function RelatorioView({ slug }: { slug: string }) {
  const rel = obterRelatorio(slug)!;
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const inicial = rel.periodoPadrao === "proximos30"
    ? { de: local(new Date()), ate: local(new Date(Date.now() + 30 * 864e5)) }
    : atalhos()[0];
  const [f, setF] = useState({ de: inicial.de, ate: inicial.ate, agrupar: "dia", vendedor: "", rota: "", entregues: false, dias: "30" });
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ops, setOps] = useState<{ vendedores: Opcao[]; rotas: Opcao[] }>({ vendedores: [], rotas: [] });
  const tem = (x: string) => rel.filtros.includes(x as never);

  useEffect(() => {
    Promise.all([
      tem("vendedor") ? carregarOpcoesRelacao({ tabela: "pessoas", rotulo: "razao_social", filtro: { eh_vendedor: true } }) : Promise.resolve([]),
      tem("rota") ? carregarOpcoesRelacao({ tabela: "rotas", rotulo: "nome" }) : Promise.resolve([]),
    ]).then(([vendedores, rotas]) => setOps({ vendedores, rotas }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const gerar = useCallback(async () => {
    const args: Record<string, unknown> = {};
    if (tem("periodo")) { args.p_de = f.de; args.p_ate = f.ate; }
    if (tem("agrupar")) args.p_agrupar = f.agrupar;
    if (tem("vendedor")) args.p_vendedor = f.vendedor || null;
    if (tem("rota")) args.p_rota = f.rota || null;
    if (tem("entregues")) args.p_entregues = f.entregues;
    if (tem("dias")) args.p_dias = parseInt(f.dias, 10) || 30;
    if (tem("periodo") && f.de > f.ate) return toast.error("A data inicial é depois da final");
    setCarregando(true);
    const { data, error } = await supabase.rpc(rel.rpc, args);
    setCarregando(false);
    if (error) { setLinhas([]); return toast.error("Não foi possível gerar o relatório", { description: mensagemErro(error) }); }
    setLinhas((data ?? []) as Linha[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, rel, f]);

  useEffect(() => { gerar(); }, [gerar]);

  const totais = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of rel.colunas) if (c.total) t[c.chave] = (linhas ?? []).reduce((a, l) => a + Number(l[c.chave] ?? 0), 0);
    return t;
  }, [linhas, rel]);

  async function exportar() {
    const cols = rel.colunas;
    const corpo = (linhas ?? []).map((l) => cols.map((c) => textoExcel(c, l[c.chave])));
    if (cols.some((c) => c.total)) corpo.push(cols.map((c, i) => (c.total ? totais[c.chave] : i === 0 ? "Total" : "")));
    await exportarExcel(rel.titulo, cols.map((c) => c.rotulo), corpo);
  }

  const resumoFiltro = [
    tem("periodo") && `${formatarData(f.de)} a ${formatarData(f.ate)}`,
    tem("vendedor") && f.vendedor && `vendedor ${ops.vendedores.find((o) => o.valor === f.vendedor)?.rotulo}`,
    tem("rota") && f.rota && `rota ${ops.rotas.find((o) => o.valor === f.rota)?.rotulo}`,
    tem("entregues") && (f.entregues ? "só pedidos entregues" : "pedidos confirmados"),
    tem("dias") && `vencidos e até ${f.dias} dias`,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted print:hidden"><Link href="/relatorios" className="hover:text-ink">Relatórios</Link> · {rel.grupo}</div>
          <h1 className="text-xl font-semibold">{rel.titulo}</h1>
          <p className="text-sm text-muted">{rel.descricao}</p>
          {resumoFiltro && <p className="hidden text-sm print:block">{resumoFiltro}</p>}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href="/relatorios"><Button><ArrowLeft size={16} /> Relatórios</Button></Link>
          <Button onClick={() => window.print()} disabled={!linhas?.length}><Printer size={16} /> Imprimir</Button>
          <Button onClick={exportar} disabled={!linhas?.length}><Download size={16} /> Excel</Button>
        </div>
      </div>

      {rel.filtros.length > 0 && (
        <Card className="mb-4 p-3 print:hidden">
          <div className="flex flex-wrap items-end gap-3">
            {tem("periodo") && (
              <>
                <div><Label htmlFor="r-de">De</Label><Input id="r-de" type="date" className="w-auto" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></div>
                <div><Label htmlFor="r-ate">Até</Label><Input id="r-ate" type="date" className="w-auto" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></div>
                {rel.periodoPadrao !== "proximos30" && (
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {atalhos().map((a) => (
                      <button key={a.rotulo} onClick={() => setF({ ...f, de: a.de, ate: a.ate })}
                        className={cn("rounded-full border px-2.5 py-1 text-xs", f.de === a.de && f.ate === a.ate ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}>{a.rotulo}</button>
                    ))}
                  </div>
                )}
              </>
            )}
            {tem("agrupar") && (
              <div><Label htmlFor="r-ag">Agrupar por</Label>
                <Select id="r-ag" className="w-auto" value={f.agrupar} onChange={(e) => setF({ ...f, agrupar: e.target.value })}>
                  <option value="dia">Dia</option><option value="semana">Semana</option><option value="mes">Mês</option>
                </Select></div>
            )}
            {tem("vendedor") && (
              <div><Label htmlFor="r-vend">Vendedor</Label>
                <Select id="r-vend" className="w-auto min-w-40" value={f.vendedor} onChange={(e) => setF({ ...f, vendedor: e.target.value })}>
                  <option value="">Todos</option>{ops.vendedores.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </Select></div>
            )}
            {tem("rota") && (
              <div><Label htmlFor="r-rota">Rota</Label>
                <Select id="r-rota" className="w-auto min-w-36" value={f.rota} onChange={(e) => setF({ ...f, rota: e.target.value })}>
                  <option value="">Todas</option>{ops.rotas.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </Select></div>
            )}
            {tem("dias") && (
              <div><Label htmlFor="r-dias">Vencendo em até</Label>
                <Select id="r-dias" className="w-auto" value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })}>
                  {["7", "15", "30", "60", "90"].map((d) => <option key={d} value={d}>{d} dias</option>)}
                </Select></div>
            )}
            {tem("entregues") && (
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="accent-[var(--accent)]" checked={f.entregues} onChange={(e) => setF({ ...f, entregues: e.target.checked })} />
                Só pedidos entregues
              </label>
            )}
          </div>
        </Card>
      )}

      {linhas === null || (carregando && !linhas.length) ? <div className="py-10 text-center text-sm text-muted">Gerando...</div>
        : linhas.length === 0 ? <Card><Vazio titulo={rel.vazio} /></Card>
        : (
          <div className={cn("space-y-4 transition-opacity", carregando && "opacity-60")}>
            {rel.grafico && <Card className="p-4 break-inside-avoid"><Grafico def={rel.grafico} linhas={linhas} /></Card>}
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                      {rel.colunas.map((c) => (
                        <th key={c.chave} className={cn("px-3 py-2 font-medium whitespace-nowrap", direita(c) && "text-right", c.oculta_celular && "hidden md:table-cell print:table-cell")}>{c.rotulo}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l, i) => (
                      <tr key={i} className="border-b border-line/70">
                        {rel.colunas.map((c) => (
                          <td key={c.chave} className={cn("px-3 py-1.5", direita(c) && "tabular text-right whitespace-nowrap", c.oculta_celular && "hidden md:table-cell print:table-cell")}>
                            {celula(c, l[c.chave])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {rel.colunas.some((c) => c.total) && (
                    <tfoot>
                      <tr className="border-t-2 border-line font-semibold">
                        {rel.colunas.map((c, i) => (
                          <td key={c.chave} className={cn("px-3 py-2", direita(c) && "tabular text-right whitespace-nowrap", c.oculta_celular && "hidden md:table-cell print:table-cell")}>
                            {c.total ? celula(c, totais[c.chave]) : i === 0 ? "Total" : ""}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <div className="px-3 py-2 text-xs text-muted">{linhas.length} {linhas.length === 1 ? "linha" : "linhas"}</div>
            </Card>
          </div>
        )}
    </>
  );
}
