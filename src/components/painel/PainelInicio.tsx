"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";
import { cn, formatarMoeda, formatarNumero } from "@/lib/utils";

export type Vendedor = {
  nome: string; meta: number | null; faturado_hoje: number; faturado_mes: number; pedidos_mes: number;
  percentual: number | null; comissao_hoje: number; comissao_mes: number;
};
export type DadosPainel = {
  mes?: string; hoje?: string; dias_uteis_mes?: number; dias_uteis_passados?: number; meta_empresa?: number | null;
  vendedores?: Vendedor[]; faturado_mes?: number; faturado_hoje?: number; pedidos_faturados_mes?: number;
  aguardando?: number; a_faturar_qtd?: number; a_faturar_valor?: number;
  diario?: { dia: string; valor: number }[]; meses?: { mes: string; valor: number; meta: number | null }[];
  pagar_aberto?: number; pagar_vencido?: number; pagar_vencido_qtd?: number; pagar_7?: number; pagar_7_qtd?: number;
  receber_aberto?: number; receber_vencido?: number; receber_vencido_qtd?: number; receber_7?: number; receber_7_qtd?: number;
  saldo_contas?: number; semanas?: { inicio: string; receber: number; pagar: number }[];
  estoque_baixo?: { nome: string; disponivel: number; minimo: number; falta: number }[]; estoque_baixo_qtd?: number;
};

const n = (v: unknown) => Number(v ?? 0);
const moedaCurta = (v: number) =>
  Math.abs(v) >= 1000 ? `R$ ${formatarNumero(Math.round(v / 100) / 10)} mil` : formatarMoeda(v);
const diaMes = (iso: string) => new Date(iso.slice(0, 10) + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const nomeMes = (iso: string) => new Date(iso.slice(0, 10) + "T12:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
const parcelas = (q?: number) => `${q ?? 0} ${q === 1 ? "parcela" : "parcelas"}`;

export function PainelInicio({ d }: { d: DadosPainel }) {
  const temVendas = !!d.vendedores;
  const temFin = d.pagar_aberto !== undefined;
  return (
    <div className="space-y-3">
      {temVendas && <MetasComissoes d={d} />}

      {(temVendas || temFin) && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {temFin && <>
            <Indicador rotulo="Contas a pagar em aberto" valor={formatarMoeda(n(d.pagar_aberto))} link={["ver despesas", "/financeiro/lancamentos"]} />
            <Indicador rotulo="A pagar vencido" valor={formatarMoeda(n(d.pagar_vencido))} alerta={n(d.pagar_vencido) > 0}
              detalhe={n(d.pagar_vencido_qtd) ? parcelas(d.pagar_vencido_qtd) : undefined} />
            <Indicador rotulo="A pagar em 7 dias" valor={formatarMoeda(n(d.pagar_7))} detalhe={n(d.pagar_7_qtd) ? parcelas(d.pagar_7_qtd) : undefined} />
          </>}
          {temVendas && <>
            <Indicador rotulo="Faturado no mês" valor={formatarMoeda(n(d.faturado_mes))}
              detalhe={`${d.pedidos_faturados_mes ?? 0} ${d.pedidos_faturados_mes === 1 ? "pedido" : "pedidos"}`} />
            <Indicador rotulo="Aguardando aprovação" valor={String(d.aguardando ?? 0)} link={["ver pedidos", "/vendas/credito"]} />
            <Indicador rotulo="Aprovados a faturar" valor={String(d.a_faturar_qtd ?? 0)} detalhe={formatarMoeda(n(d.a_faturar_valor))}
              link={n(d.a_faturar_qtd) ? ["faturar", "/vendas/pedidos"] : undefined} />
          </>}
          {temFin && <>
            <Indicador rotulo="A receber vencido" valor={formatarMoeda(n(d.receber_vencido))} alerta={n(d.receber_vencido) > 0}
              detalhe={parcelas(d.receber_vencido_qtd)} />
            <Indicador rotulo="A receber em 7 dias" valor={formatarMoeda(n(d.receber_7))} detalhe={parcelas(d.receber_7_qtd)} />
            <Indicador rotulo="Saldo em caixa e bancos" valor={formatarMoeda(n(d.saldo_contas))} link={["painel financeiro", "/financeiro/painel"]} />
          </>}
        </div>
      )}

      {(temVendas || temFin) && (
        <div className="grid gap-3 lg:grid-cols-3">
          {temVendas && d.diario && <Grafico titulo="Faturamento por dia" sub={`${moedaCurta(n(d.faturado_hoje))} hoje`}><Diario d={d} /></Grafico>}
          {temVendas && d.meses && <Grafico titulo="Últimos 6 meses" sub="faturado"><Meses meses={d.meses} /></Grafico>}
          {temFin && d.semanas && <Grafico titulo="Próximas 4 semanas" sub="em aberto, pelo vencimento"><Semanas semanas={d.semanas} /></Grafico>}
        </div>
      )}

      {(temVendas || d.estoque_baixo) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {temVendas && <PorVendedor vendedores={d.vendedores ?? []} />}
          {d.estoque_baixo && <EstoqueBaixo d={d} />}
        </div>
      )}
    </div>
  );
}

function MetasComissoes({ d }: { d: DadosPainel }) {
  const vs = d.vendedores ?? [];
  const tot = vs.reduce((a, v) => ({ meta: a.meta + n(v.meta), fh: a.fh + n(v.faturado_hoje), fm: a.fm + n(v.faturado_mes),
    ch: a.ch + n(v.comissao_hoje), cm: a.cm + n(v.comissao_mes) }), { meta: 0, fh: 0, fm: 0, ch: 0, cm: 0 });
  const ritmo = d.dias_uteis_mes ? n(d.dias_uteis_passados) / n(d.dias_uteis_mes) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="font-semibold">Metas e comissões dos vendedores</h2>
        {ritmo !== null && <span className="text-xs text-muted">{d.dias_uteis_passados} de {d.dias_uteis_mes} dias úteis · {Math.round(ritmo * 100)}% do mês</span>}
      </div>
      {vs.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">Nenhum vendedor com meta ou faturamento no mês. <Link href="/vendas/metas" className="text-accent underline">Definir metas</Link></p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-[11px] font-medium tracking-wide text-muted uppercase">
                <th className="px-4 py-2 font-medium">Vendedor</th>
                <th className="px-3 py-2 text-right font-medium">Meta mensal</th>
                <th className="px-3 py-2 text-right font-medium">Faturado hoje</th>
                <th className="px-3 py-2 text-right font-medium">Faturado no mês</th>
                <th className="w-44 px-3 py-2 font-medium">Meta atingida</th>
                <th className="px-3 py-2 text-right font-medium">Comissão hoje</th>
                <th className="px-4 py-2 text-right font-medium">Comissão no mês</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {vs.map((v) => {
                const pct = v.meta ? (n(v.faturado_mes) / n(v.meta)) * 100 : null;
                return (
                  <tr key={v.nome}>
                    <td className="px-4 py-2.5">{v.nome}</td>
                    <td className="tabular px-3 py-2.5 text-right">{v.meta ? formatarMoeda(n(v.meta)) : <span className="text-muted">—</span>}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatarMoeda(n(v.faturado_hoje))}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatarMoeda(n(v.faturado_mes))}</td>
                    <td className="px-3 py-2.5"><BarraMeta pct={pct} ritmo={ritmo} /></td>
                    <td className="tabular px-3 py-2.5 text-right">{formatarMoeda(n(v.comissao_hoje))}</td>
                    <td className="tabular px-4 py-2.5 text-right">
                      {formatarMoeda(n(v.comissao_mes))} <span className="text-xs text-muted">({formatarNumero(n(v.percentual))}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {vs.length > 1 && (
              <tfoot>
                <tr className="border-t border-line font-medium">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="tabular px-3 py-2.5 text-right">{tot.meta ? formatarMoeda(tot.meta) : "—"}</td>
                  <td className="tabular px-3 py-2.5 text-right">{formatarMoeda(tot.fh)}</td>
                  <td className="tabular px-3 py-2.5 text-right">{formatarMoeda(tot.fm)}</td>
                  <td className="px-3 py-2.5"><BarraMeta pct={tot.meta ? (tot.fm / tot.meta) * 100 : null} ritmo={ritmo} /></td>
                  <td className="tabular px-3 py-2.5 text-right">{formatarMoeda(tot.ch)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{formatarMoeda(tot.cm)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">
        Comissão lançada automaticamente sobre os pedidos faturados e paga no dia 5 do mês seguinte. A marca na barra mostra onde a meta deveria estar hoje.{" "}
        <Link href="/vendas/metas" className="underline">Configurar metas</Link>
      </p>
    </Card>
  );
}

function BarraMeta({ pct, ritmo }: { pct: number | null; ritmo: number | null }) {
  if (pct === null) return <span className="text-xs text-muted">sem meta</span>;
  const atrasado = ritmo !== null && pct / 100 < ritmo * 0.9;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-ok" : "bg-accent")} style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%` }} />
        {ritmo !== null && ritmo < 1 && <div className="absolute -top-0.5 h-2.5 w-px bg-muted" style={{ left: `${ritmo * 100}%` }} title="Onde deveria estar hoje" />}
      </div>
      <span className={cn("tabular w-12 text-right text-xs", atrasado ? "text-warn" : "text-ink")}>{formatarNumero(Math.round(pct * 10) / 10)}%</span>
    </div>
  );
}

function Indicador({ rotulo, valor, detalhe, alerta, link }: { rotulo: string; valor: string; detalhe?: string; alerta?: boolean; link?: [string, string] }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{rotulo}</div>
      <div className={cn("tabular mt-1 text-xl font-semibold", alerta && "text-bad")}>{valor}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
        {detalhe && <span>{detalhe}</span>}
        {link && <Link href={link[1]} className="text-accent underline">{link[0]}</Link>}
      </div>
    </Card>
  );
}

function Grafico({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{titulo}</h3>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

// Linha de leitura acima do gráfico: mostra o ponto sob o cursor (ou o padrão)
function Leitura({ esquerda, direita }: { esquerda: string; direita: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-baseline justify-between text-xs">
      <span className="text-muted">{esquerda}</span>
      <span className="tabular">{direita}</span>
    </div>
  );
}

function Diario({ d }: { d: DadosPainel }) {
  const dias = d.diario ?? [];
  const hoje = d.hoje ?? "";
  const [ativo, setAtivo] = useState<string | null>(null);
  const porDia = d.meta_empresa && d.dias_uteis_mes ? n(d.meta_empresa) / d.dias_uteis_mes : null;
  const max = Math.max(1, porDia ?? 0, ...dias.map((x) => n(x.valor))) * 1.1;
  const W = 300, H = 90, gap = 2, bw = (W - gap * (dias.length - 1)) / Math.max(1, dias.length);
  const sel = dias.find((x) => x.dia === (ativo ?? hoje)) ?? dias[dias.length - 1];
  const y = (v: number) => H - (v / max) * H;
  return (
    <div>
      <Leitura esquerda={sel ? `${diaMes(sel.dia)}${sel.dia === hoje ? " · hoje" : ""}` : ""} direita={formatarMoeda(n(sel?.valor))} />
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full select-none" role="img" aria-label="Faturamento por dia no mês" onPointerLeave={() => setAtivo(null)}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--line)" />
        {dias.map((x, i) => {
          const v = n(x.valor), h = v > 0 ? Math.max(2, H - y(v)) : 0, px = i * (bw + gap);
          const destaque = x.dia === (ativo ?? hoje);
          return (
            <g key={x.dia} onPointerEnter={() => setAtivo(x.dia)}>
              <rect x={px - gap / 2} y={0} width={bw + gap} height={H + 14} fill="transparent" />
              {h > 0 && <rect x={px} y={H - h} width={bw} height={h} rx={Math.min(2, bw / 2)} fill="var(--accent)" opacity={destaque ? 1 : 0.4} />}
              {x.dia > hoje && <rect x={px} y={H - 1} width={bw} height={1} fill="var(--line)" />}
              {(i === 0 || Number(x.dia.slice(8, 10)) % 5 === 0) && (
                <text x={px + bw / 2} y={H + 11} textAnchor="middle" fontSize="8" fill="var(--muted)">{Number(x.dia.slice(8, 10))}</text>
              )}
            </g>
          );
        })}
        {porDia && <line x1="0" x2={W} y1={y(porDia)} y2={y(porDia)} stroke="var(--muted)" strokeDasharray="3 3" opacity="0.7" pointerEvents="none" />}
      </svg>
      {porDia && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <svg width="14" height="4" aria-hidden><line x1="0" x2="14" y1="2" y2="2" stroke="var(--muted)" strokeDasharray="3 3" /></svg>
          meta por dia útil · {formatarMoeda(porDia)}
        </div>
      )}
    </div>
  );
}

function Meses({ meses }: { meses: { mes: string; valor: number; meta: number | null }[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const max = Math.max(1, ...meses.map((m) => Math.max(n(m.valor), n(m.meta)))) * 1.1;
  const W = 300, H = 90, gap = 14, bw = (W - gap * (meses.length - 1)) / meses.length;
  const i0 = ativo ?? meses.length - 1, sel = meses[i0];
  const ant = i0 > 0 ? n(meses[i0 - 1].valor) : 0;
  const varia = ant > 0 ? ((n(sel.valor) - ant) / ant) * 100 : null;
  return (
    <div>
      <Leitura esquerda={new Date(sel.mes.slice(0, 10) + "T12:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        direita={<>{formatarMoeda(n(sel.valor))}{varia !== null && <span className="ml-1 text-muted">{varia >= 0 ? "+" : ""}{formatarNumero(Math.round(varia))}%</span>}</>} />
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full select-none" role="img" aria-label="Faturamento dos últimos 6 meses" onPointerLeave={() => setAtivo(null)}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--line)" />
        {meses.map((m, i) => {
          const v = n(m.valor), h = v > 0 ? Math.max(2, (v / max) * H) : 0, px = i * (bw + gap);
          const ym = m.meta ? H - (n(m.meta) / max) * H : null;
          return (
            <g key={m.mes} onPointerEnter={() => setAtivo(i)}>
              <rect x={px - gap / 2} y={0} width={bw + gap} height={H + 14} fill="transparent" />
              {h > 0 && <rect x={px} y={H - h} width={bw} height={h} rx="3" fill="var(--accent)" opacity={i === i0 ? 1 : 0.4} />}
              {ym !== null && <line x1={px - 2} x2={px + bw + 2} y1={ym} y2={ym} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="3 2" />}
              <text x={px + bw / 2} y={H + 11} textAnchor="middle" fontSize="8" fill="var(--muted)">{nomeMes(m.mes)}</text>
            </g>
          );
        })}
      </svg>
      {meses.some((m) => m.meta) && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <svg width="14" height="4" aria-hidden><line x1="0" x2="14" y1="2" y2="2" stroke="var(--muted)" strokeDasharray="3 2" strokeWidth="1.5" /></svg>
          meta do mês
        </div>
      )}
    </div>
  );
}

function Semanas({ semanas }: { semanas: { inicio: string; receber: number; pagar: number }[] }) {
  const [ativo, setAtivo] = useState(0);
  const max = Math.max(1, ...semanas.flatMap((s) => [n(s.receber), n(s.pagar)])) * 1.1;
  const W = 300, H = 90, grupo = W / semanas.length, bw = Math.min(26, grupo / 3.2);
  const sel = semanas[ativo];
  const saldo = n(sel.receber) - n(sel.pagar);
  return (
    <div>
      <Leitura esquerda={ativo === 0 ? "Esta semana (com vencidos)" : `Semana de ${diaMes(sel.inicio)}`}
        direita={<span className={saldo < 0 ? "text-bad" : ""}>{saldo >= 0 ? "+" : "−"}{formatarMoeda(Math.abs(saldo))}</span>} />
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full select-none" role="img" aria-label="A receber e a pagar nas próximas 4 semanas" onPointerLeave={() => setAtivo(0)}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--line)" />
        {semanas.map((s, i) => {
          const cx = i * grupo + grupo / 2;
          const hr = n(s.receber) > 0 ? Math.max(2, (n(s.receber) / max) * H) : 0;
          const hp = n(s.pagar) > 0 ? Math.max(2, (n(s.pagar) / max) * H) : 0;
          const op = i === ativo ? 1 : 0.45;
          return (
            <g key={s.inicio} onPointerEnter={() => setAtivo(i)}>
              <rect x={i * grupo} y={0} width={grupo} height={H + 14} fill="transparent" />
              {hr > 0 && <rect x={cx - bw - 1} y={H - hr} width={bw} height={hr} rx="3" fill="var(--accent)" opacity={op} />}
              {hp > 0 && <rect x={cx + 1} y={H - hp} width={bw} height={hp} rx="3" fill="var(--muted)" opacity={op * 0.75} />}
              <text x={cx} y={H + 11} textAnchor="middle" fontSize="8" fill="var(--muted)">{i === 0 ? "esta" : diaMes(s.inicio)}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent" />a receber <b className="tabular font-normal text-ink">{formatarMoeda(n(sel.receber))}</b></span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-muted/75" />a pagar <b className="tabular font-normal text-ink">{formatarMoeda(n(sel.pagar))}</b></span>
      </div>
    </div>
  );
}

function PorVendedor({ vendedores }: { vendedores: Vendedor[] }) {
  const vs = vendedores.filter((v) => n(v.faturado_mes) > 0);
  const max = Math.max(1, ...vs.map((v) => n(v.faturado_mes)));
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-medium">Vendas faturadas por vendedor (mês)</h3>
      {vs.length === 0 ? <p className="text-sm text-muted">Nada faturado no mês ainda.</p> : (
        <ul className="space-y-2.5">
          {vs.map((v) => (
            <li key={v.nome} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate">{v.nome}</span>
              <div className="h-2 rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (n(v.faturado_mes) / max) * 100)}%` }} />
              </div>
              <span className="tabular text-right">{formatarMoeda(n(v.faturado_mes))} <span className="text-xs text-muted">· {v.pedidos_mes}</span></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EstoqueBaixo({ d }: { d: DadosPainel }) {
  const itens = d.estoque_baixo ?? [];
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Estoque abaixo do mínimo</h3>
        {n(d.estoque_baixo_qtd) > itens.length && <Link href="/estoque/saldos" className="text-xs text-accent underline">ver todos ({d.estoque_baixo_qtd})</Link>}
      </div>
      {itens.length === 0 ? <p className="text-sm text-muted">Tudo certo com o estoque.</p> : (
        <ul className="space-y-2.5">
          {itens.map((e) => {
            const pct = n(e.minimo) ? Math.max(0, n(e.disponivel)) / n(e.minimo) : 0;
            return (
              <li key={e.nome} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-3 text-sm">
                <span className="truncate">{e.nome}</span>
                <div className="h-1.5 rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-warn" style={{ width: `${Math.max(pct > 0 ? 3 : 0, pct * 100)}%` }} />
                </div>
                <span className="tabular text-right text-xs text-muted">{formatarNumero(n(e.disponivel))} de {formatarNumero(n(e.minimo))}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
