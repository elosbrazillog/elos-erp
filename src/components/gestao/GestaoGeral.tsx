"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Cabecalho, Card, Input } from "@/components/ui";
import { cn, dataLocal, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";

type Vend = { nome: string; meta: number | null; faturado: number; faturado_ant: number; pedidos: number; clientes: number; carteira: number; comissao: number; sem_pedido: number };
type Dados = {
  de: string; ate: string; ant_de: string; ant_ate: string; hoje: string;
  faturado: number; faturado_ant: number; pedidos: number; pedidos_ant: number; custo: number; custo_conhecido: number;
  clientes: number; clientes_ant: number; carteira: number; meta: number | null;
  diario: { dia: string; atual: number; anterior: number }[];
  vendedores: Vend[];
  top_clientes: { cliente_id: string | null; nome: string; total: number; pedidos: number; total_ant: number }[];
  top_produtos: { codigo: string; nome: string; quantidade: number; total: number; margem: number | null }[];
  clientes_parados: { cliente_id: string; nome: string; ultima: string; media: number; vendedor: string | null }[];
  clientes_parados_qtd: number;
  recebido: number; pago: number; receber_aberto: number; receber_vencido: number; receber_vencido_clientes: number;
  pagar_aberto: number; pagar_vencido: number; pagar_30: number; receber_30: number; saldo_contas: number;
  despesas_grupos: { grupo: string; valor: number }[];
  pedidos_status: Record<string, { qtd: number; valor: number }>;
  a_faturar: { qtd: number; valor: number }; cargas_abertas: number;
  entregas: { entregues: number; devolvidas: number; ausentes: number };
  acertos_pendentes: number; boletos_a_enviar: number; boletos_erro: number; frota: { valor: number; litros: number };
  estoque_valor: number; estoque_abaixo_minimo: number; estoque_vencido_itens: number; estoque_vence_30: number;
};

const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);

function periodo(chave: string): [string, string] {
  const hoje = dataLocal();
  const [y, m] = hoje.split("-").map(Number);
  const ini = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const fim = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  switch (chave) {
    case "mes_passado": return m === 1 ? [ini(y - 1, 12), fim(y - 1, 12)] : [ini(y, m - 1), fim(y, m - 1)];
    case "90": return [dataLocal(-89), hoje];
    case "ano": return [`${y}-01-01`, hoje];
    default: return [ini(y, m), hoje];
  }
}
const PERIODOS = [["mes", "Este mês"], ["mes_passado", "Mês passado"], ["90", "90 dias"], ["ano", "No ano"]] as const;

export function GestaoGeral() {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [chave, setChave] = useState<string>("mes");
  const [[de, ate], setIntervalo] = useState<[string, string]>(periodo("mes"));
  const [d, setD] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc("gestao_resumo", { p_de: de, p_ate: ate });
    setCarregando(false);
    if (error) { toast.error("Não foi possível carregar", { description: mensagemErro(error) }); return; }
    setD(data as Dados);
  }, [supabase, de, ate]);
  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <>
      <Cabecalho trilha="Administração" titulo="Gestão geral"
        acoes={<Button onClick={carregar} disabled={carregando}><RefreshCw size={15} className={cn(carregando && "animate-spin")} /> Atualizar</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {PERIODOS.map(([k, r]) => (
          <button key={k} onClick={() => { setChave(k); setIntervalo(periodo(k)); }}
            className={cn("rounded-full border px-3 py-1.5 text-sm", chave === k ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface hover:bg-surface-2")}>{r}</button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Input type="date" aria-label="De" value={de} onChange={(e) => { setChave("livre"); setIntervalo([e.target.value, ate]); }} className="w-40" />
          <span className="text-muted">a</span>
          <Input type="date" aria-label="Até" value={ate} onChange={(e) => { setChave("livre"); setIntervalo([de, e.target.value]); }} className="w-40" />
        </div>
      </div>
      {!d ? <div className="py-16 text-center text-sm text-muted">Carregando...</div> : <Conteudo d={d} />}
    </>
  );
}

function Conteudo({ d }: { d: Dados }) {
  const margem = n(d.custo_conhecido) > 0 ? ((n(d.custo_conhecido) - n(d.custo)) / n(d.custo_conhecido)) * 100 : null;
  const ticket = n(d.pedidos) ? n(d.faturado) / n(d.pedidos) : 0;
  const ticketAnt = n(d.pedidos_ant) ? n(d.faturado_ant) / n(d.pedidos_ant) : 0;
  const caixa = n(d.recebido) - n(d.pago);
  const inad = n(d.receber_aberto) > 0 ? (n(d.receber_vencido) / n(d.receber_aberto)) * 100 : 0;
  const st = d.pedidos_status ?? {};

  const alertas: [string, string][] = [];
  if (n(d.receber_vencido) > 0) alertas.push([`${formatarMoeda(n(d.receber_vencido))} a receber vencido de ${d.receber_vencido_clientes} ${d.receber_vencido_clientes === 1 ? "cliente" : "clientes"}`, "/financeiro/lancamentos"]);
  if (n(d.pagar_vencido) > 0) alertas.push([`${formatarMoeda(n(d.pagar_vencido))} de contas a pagar vencidas`, "/financeiro/lancamentos"]);
  if (n(st.aguardando_credito?.qtd) > 0) alertas.push([`${st.aguardando_credito.qtd} pedidos aguardando aprovação de crédito`, "/vendas/credito"]);
  if (n(d.acertos_pendentes) > 0) alertas.push([`${d.acertos_pendentes} cargas concluídas sem acerto com o motorista`, "/expedicao/cargas"]);
  if (n(d.boletos_erro) > 0) alertas.push([`${d.boletos_erro} boletos com erro no Sicredi`, "/financeiro/painel"]);
  else if (n(d.boletos_a_enviar) > 0) alertas.push([`${d.boletos_a_enviar} boletos ainda não enviados ao banco`, "/financeiro/painel"]);
  if (n(d.estoque_vencido_itens) > 0) alertas.push([`${d.estoque_vencido_itens} produtos com lote vencido no estoque`, "/estoque/saldos"]);
  if (n(d.clientes_parados_qtd) > 0) alertas.push([`${d.clientes_parados_qtd} clientes sem comprar há mais de 30 dias`, "#parados"]);

  return (
    <div className="space-y-3">
      {alertas.length > 0 && (
        <Card className="border-warn/40 bg-warn/5 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><AlertTriangle size={15} className="text-warn" /> Precisa de atenção</div>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {alertas.map(([t, h]) => <li key={t}><Link href={h} className="hover:text-accent hover:underline">{t}</Link></li>)}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Faturamento" valor={formatarMoeda(n(d.faturado))} variacao={pct(n(d.faturado), n(d.faturado_ant))} />
        <Kpi rotulo="Margem bruta estimada" valor={margem === null ? "—" : `${formatarNumero(Math.round(margem * 10) / 10)}%`}
          detalhe={margem === null ? "cadastre o custo dos produtos" : `${formatarMoeda(n(d.custo_conhecido) - n(d.custo))} de lucro bruto`} />
        <Kpi rotulo="Pedidos" valor={formatarNumero(n(d.pedidos))} variacao={pct(n(d.pedidos), n(d.pedidos_ant))} />
        <Kpi rotulo="Ticket médio" valor={formatarMoeda(ticket)} variacao={pct(ticket, ticketAnt)} />
        <Kpi rotulo="Clientes atendidos" valor={formatarNumero(n(d.clientes))} variacao={pct(n(d.clientes), n(d.clientes_ant))}
          detalhe={d.carteira ? `${Math.round((n(d.clientes) / n(d.carteira)) * 100)}% dos ${formatarNumero(n(d.carteira))} clientes` : undefined} />
        <Kpi rotulo="Caixa do período" valor={formatarMoeda(caixa)} alerta={caixa < 0}
          detalhe={`entrou ${formatarMoeda(n(d.recebido))} · saiu ${formatarMoeda(n(d.pago))}`} />
      </div>
      <p className="-mt-1 text-[11px] text-muted">Comparado com {formatarData(d.ant_de)} a {formatarData(d.ant_ate)}. Vendas incluem o histórico do Atende.</p>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">Faturamento por dia</h2>
            <span className="flex items-center gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-chart" /> período</span>
              <span className="flex items-center gap-1"><svg width="14" height="4" aria-hidden><line x1="0" x2="14" y1="2" y2="2" stroke="var(--accent)" strokeDasharray="3 2" strokeWidth="1.5" /></svg> período anterior</span>
            </span>
          </div>
          <GraficoDiario dias={d.diario} hoje={d.hoje} />
        </Card>
        <Meta d={d} />
      </div>

      <Equipe d={d} />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Maiores clientes</h3>
          <ListaBarras itens={d.top_clientes.map((c) => ({ chave: c.cliente_id ?? c.nome, nome: c.nome, valor: n(c.total),
            extra: c.total_ant ? variacaoTexto(pct(n(c.total), n(c.total_ant))) : "novo", href: c.cliente_id ? `/cadastros/pessoas/${c.cliente_id}` : undefined }))} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Produtos mais vendidos</h3>
          <ListaBarras itens={d.top_produtos.map((p) => ({ chave: p.codigo ?? p.nome, nome: p.nome, valor: n(p.total),
            extra: p.margem !== null ? `margem ${formatarNumero(n(p.margem))}%` : `${formatarNumero(n(p.quantidade))} un` }))} />
        </Card>
        <Card className="p-4" >
          <div id="parados" className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-medium">Clientes que pararam de comprar</h3>
            <span className="text-xs text-muted">{d.clientes_parados_qtd} no total</span>
          </div>
          {d.clientes_parados.length === 0 ? <p className="text-sm text-muted">Nenhum cliente parado.</p> : (
            <ul className="space-y-2 text-sm">
              {d.clientes_parados.map((c) => (
                <li key={c.cliente_id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0">
                    <Link href={`/cadastros/pessoas/${c.cliente_id}`} className="block truncate hover:text-accent hover:underline">{c.nome}</Link>
                    <span className="text-xs text-muted">última {formatarData(c.ultima)}{c.vendedor ? ` · ${c.vendedor}` : ""}</span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted">{formatarMoeda(n(c.media))}/mês</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">A receber</h3>
          <Linha r="Em aberto" v={formatarMoeda(n(d.receber_aberto))} />
          <Linha r="Vencido" v={formatarMoeda(n(d.receber_vencido))} alerta={n(d.receber_vencido) > 0} detalhe={`${formatarNumero(Math.round(inad * 10) / 10)}% do aberto`} />
          <Linha r="Vence em 30 dias" v={formatarMoeda(n(d.receber_30))} />
          <Linha r="Recebido no período" v={formatarMoeda(n(d.recebido))} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">A pagar</h3>
          <Linha r="Em aberto" v={formatarMoeda(n(d.pagar_aberto))} />
          <Linha r="Vencido" v={formatarMoeda(n(d.pagar_vencido))} alerta={n(d.pagar_vencido) > 0} />
          <Linha r="Vence em 30 dias" v={formatarMoeda(n(d.pagar_30))} />
          <Linha r="Saldo em caixa e bancos" v={formatarMoeda(n(d.saldo_contas))} forte />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Despesas do período por grupo</h3>
          {d.despesas_grupos.length === 0 ? <p className="text-sm text-muted">Nenhuma despesa lançada no período.</p> : (
            <ListaBarras itens={d.despesas_grupos.map((g) => ({ chave: g.grupo, nome: g.grupo, valor: n(g.valor) }))} cor="bg-accent/70" />
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-medium">Operação e estoque agora</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <Contador r="Aguardando crédito" v={n(st.aguardando_credito?.qtd)} href="/vendas/credito" alerta={n(st.aguardando_credito?.qtd) > 0} />
          <Contador r="A faturar" v={n(d.a_faturar?.qtd)} detalhe={formatarMoeda(n(d.a_faturar?.valor))} href="/vendas/pedidos" />
          <Contador r="Em separação" v={n(st.em_separacao?.qtd)} href="/expedicao/cargas" />
          <Contador r="Em rota" v={n(st.em_rota?.qtd)} href="/expedicao/acompanhamento" />
          <Contador r="Cargas abertas" v={n(d.cargas_abertas)} href="/expedicao/cargas" />
          <Contador r="Acertos pendentes" v={n(d.acertos_pendentes)} href="/expedicao/cargas" alerta={n(d.acertos_pendentes) > 0} />
          <Contador r="Entregas no período" v={n(d.entregas?.entregues)} detalhe={`${n(d.entregas?.devolvidas)} devolvidas · ${n(d.entregas?.ausentes)} ausentes`} />
          <Contador r="Combustível e frota" v={formatarMoeda(n(d.frota?.valor))} detalhe={`${formatarNumero(n(d.frota?.litros))} litros`} href="/expedicao/despesas" />
          <Contador r="Boletos a enviar" v={n(d.boletos_a_enviar)} href="/financeiro/painel" alerta={n(d.boletos_erro) > 0} detalhe={n(d.boletos_erro) ? `${d.boletos_erro} com erro` : undefined} />
          <Contador r="Estoque (custo)" v={formatarMoeda(n(d.estoque_valor))} href="/estoque/saldos" />
          <Contador r="Abaixo do mínimo" v={n(d.estoque_abaixo_minimo)} href="/estoque/saldos" alerta={n(d.estoque_abaixo_minimo) > 0} />
          <Contador r="Vencem em 30 dias" v={n(d.estoque_vence_30)} detalhe={n(d.estoque_vencido_itens) ? `${d.estoque_vencido_itens} já vencidos` : undefined} href="/estoque/saldos" alerta={n(d.estoque_vencido_itens) > 0} />
        </div>
      </Card>
    </div>
  );
}

function variacaoTexto(v: number | null) {
  if (v === null) return "";
  return `${v >= 0 ? "+" : ""}${formatarNumero(Math.round(v))}%`;
}

function Kpi({ rotulo, valor, variacao, detalhe, alerta }: { rotulo: string; valor: string; variacao?: number | null; detalhe?: string; alerta?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{rotulo}</div>
      <div className={cn("tabular mt-1 text-xl font-semibold", alerta && "text-bad")}>{valor}</div>
      {variacao !== undefined && variacao !== null && (
        <div className={cn("mt-0.5 flex items-center gap-0.5 text-xs", variacao >= 0 ? "text-ok" : "text-bad")}>
          {variacao >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {variacaoTexto(variacao)} <span className="text-muted">vs anterior</span>
        </div>
      )}
      {detalhe && <div className="mt-0.5 text-xs text-muted">{detalhe}</div>}
    </Card>
  );
}

function GraficoDiario({ dias, hoje }: { dias: Dados["diario"]; hoje: string }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const W = 640, H = 150;
  const max = Math.max(1, ...dias.flatMap((x) => [n(x.atual), n(x.anterior)])) * 1.1;
  const passo = W / Math.max(1, dias.length);
  const bw = Math.max(1, Math.min(18, passo - 2));
  const y = (v: number) => H - (v / max) * H;
  const linha = dias.map((x, i) => `${i ? "L" : "M"}${(i * passo + passo / 2).toFixed(1)} ${y(n(x.anterior)).toFixed(1)}`).join(" ");
  const sel = ativo !== null ? dias[ativo] : null;
  const total = dias.reduce((a, x) => a + n(x.atual), 0);
  const marca = Math.max(1, Math.round(dias.length / 8));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted">{sel ? formatarData(sel.dia) : "Total do período"}</span>
        <span className="tabular">{sel ? <>{formatarMoeda(n(sel.atual))} <span className="text-muted">· antes {formatarMoeda(n(sel.anterior))}</span></> : formatarMoeda(total)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full select-none" role="img" aria-label="Faturamento por dia comparado ao período anterior" onPointerLeave={() => setAtivo(null)}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--line)" />
        {dias.map((x, i) => {
          const v = n(x.atual), h = v > 0 ? Math.max(2, H - y(v)) : 0, cx = i * passo + passo / 2;
          return (
            <g key={x.dia} onPointerEnter={() => setAtivo(i)}>
              <rect x={i * passo} y={0} width={passo} height={H + 16} fill="transparent" />
              {h > 0 && <rect x={cx - bw / 2} y={H - h} width={bw} height={h} rx={Math.min(2, bw / 2)} fill={ativo === i ? "var(--accent)" : "var(--chart)"} opacity={ativo === i ? 1 : 0.5} />}
              {x.dia > hoje && <rect x={cx - bw / 2} y={H - 1} width={bw} height={1} fill="var(--line)" />}
              {i % marca === 0 && <text x={cx} y={H + 12} textAnchor="middle" fontSize="9" fill="var(--muted)">{x.dia.slice(8, 10)}/{x.dia.slice(5, 7)}</text>}
            </g>
          );
        })}
        <path d={linha} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" pointerEvents="none" />
      </svg>
    </div>
  );
}

function Meta({ d }: { d: Dados }) {
  const meta = n(d.meta);
  const mesmoMes = d.de.slice(0, 7) === d.ate.slice(0, 7) && d.de.endsWith("-01");
  if (!meta || !mesmoMes) {
    return (
      <Card className="p-4">
        <h3 className="mb-2 text-sm font-medium">Meta do mês</h3>
        <p className="text-sm text-muted">{meta ? "Escolha um mês (Este mês ou Mês passado) para ver o andamento da meta." : <>Sem meta lançada. <Link href="/vendas/metas" className="text-accent underline">Definir metas</Link></>}</p>
      </Card>
    );
  }
  const fim = new Date(Number(d.de.slice(0, 4)), Number(d.de.slice(5, 7)), 0);
  const total = fim.getDate();
  const corrido = Math.min(total, Math.max(1, Number((d.ate < d.hoje ? d.ate : d.hoje).slice(8, 10))));
  const projecao = (n(d.faturado) / corrido) * total;
  const p = n(d.faturado) / meta;
  const ritmo = corrido / total;
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-medium">Meta do mês</h3>
      <div className="tabular text-2xl font-semibold">{formatarNumero(Math.round(p * 1000) / 10)}%</div>
      <div className="text-xs text-muted">{formatarMoeda(n(d.faturado))} de {formatarMoeda(meta)}</div>
      <div className="relative mt-3 h-2 rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", p >= 1 ? "bg-ok" : "bg-chart")} style={{ width: `${Math.min(100, Math.max(1, p * 100))}%` }} />
        {ritmo < 1 && <div className="absolute -top-1 h-4 w-px bg-accent" style={{ left: `${ritmo * 100}%` }} title="Onde deveria estar hoje" />}
      </div>
      <div className="mt-3 space-y-1 text-sm">
        <Linha r="Projeção do mês" v={formatarMoeda(projecao)} alerta={projecao < meta} />
        <Linha r="Falta" v={formatarMoeda(Math.max(0, meta - n(d.faturado)))} />
        <Linha r="Precisa por dia" v={formatarMoeda(Math.max(0, meta - n(d.faturado)) / Math.max(1, total - corrido))} />
      </div>
    </Card>
  );
}

function Equipe({ d }: { d: Dados }) {
  if (!d.vendedores.length) return null;
  return (
    <Card>
      <div className="px-4 pt-4 pb-3"><h2 className="text-sm font-medium">Desempenho da equipe</h2></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm [&_td]:whitespace-nowrap">
          <thead>
            <tr className="border-y border-line bg-surface-2/60 text-left text-[11px] tracking-wide text-muted uppercase">
              <th className="px-4 py-2 font-medium">Vendedor</th><th className="px-3 py-2 text-right font-medium">Faturado</th>
              <th className="w-40 px-3 py-2 font-medium">Meta</th><th className="px-3 py-2 text-right font-medium">vs anterior</th>
              <th className="px-3 py-2 text-right font-medium">Pedidos</th><th className="px-3 py-2 text-right font-medium">Ticket</th>
              <th className="px-3 py-2 text-right font-medium">Positivação</th><th className="px-3 py-2 text-right font-medium">Visitas sem pedido</th>
              <th className="px-4 py-2 text-right font-medium">Comissão</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {d.vendedores.map((v) => {
              const p = v.meta ? n(v.faturado) / n(v.meta) : null;
              const varia = pct(n(v.faturado), n(v.faturado_ant));
              return (
                <tr key={v.nome}>
                  <td className="px-4 py-2.5">{v.nome}</td>
                  <td className="tabular px-3 py-2.5 text-right">{formatarMoeda(n(v.faturado))}</td>
                  <td className="px-3 py-2.5">
                    {p === null ? <span className="text-xs text-muted">sem meta</span> : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-surface-2"><div className={cn("h-full rounded-full", p >= 1 ? "bg-ok" : "bg-chart")} style={{ width: `${Math.min(100, Math.max(2, p * 100))}%` }} /></div>
                        <span className="tabular w-10 text-right text-xs">{Math.round(p * 100)}%</span>
                      </div>
                    )}
                  </td>
                  <td className={cn("tabular px-3 py-2.5 text-right text-xs", varia === null ? "text-muted" : varia >= 0 ? "text-ok" : "text-bad")}>{varia === null ? "—" : variacaoTexto(varia)}</td>
                  <td className="tabular px-3 py-2.5 text-right">{v.pedidos}</td>
                  <td className="tabular px-3 py-2.5 text-right">{v.pedidos ? formatarMoeda(n(v.faturado) / n(v.pedidos)) : "—"}</td>
                  <td className="tabular px-3 py-2.5 text-right">{v.carteira ? `${v.clientes}/${v.carteira}` : v.clientes}</td>
                  <td className="tabular px-3 py-2.5 text-right">{v.sem_pedido}</td>
                  <td className="tabular px-4 py-2.5 text-right">{formatarMoeda(n(v.comissao))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ListaBarras({ itens, cor = "bg-chart" }: { itens: { chave: string; nome: string; valor: number; extra?: string; href?: string }[]; cor?: string }) {
  if (!itens.length) return <p className="text-sm text-muted">Nada no período.</p>;
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="space-y-2.5">
      {itens.map((i) => (
        <li key={i.chave} className="text-sm">
          <div className="flex items-baseline justify-between gap-2">
            {i.href ? <Link href={i.href} className="truncate hover:text-accent hover:underline">{i.nome}</Link> : <span className="truncate">{i.nome}</span>}
            <span className="tabular shrink-0">{formatarMoeda(i.valor)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-surface-2"><div className={cn("h-full rounded-full", cor)} style={{ width: `${Math.max(2, (i.valor / max) * 100)}%` }} /></div>
            {i.extra && <span className="w-20 shrink-0 text-right text-[11px] text-muted">{i.extra}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Linha({ r, v, detalhe, alerta, forte }: { r: string; v: string; detalhe?: string; alerta?: boolean; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line/60 py-1.5 text-sm last:border-0">
      <span className="text-muted">{r}{detalhe && <span className="ml-1 text-xs">· {detalhe}</span>}</span>
      <span className={cn("tabular", alerta && "text-bad", forte && "font-semibold")}>{v}</span>
    </div>
  );
}

function Contador({ r, v, detalhe, href, alerta }: { r: string; v: number | string; detalhe?: string; href?: string; alerta?: boolean }) {
  const corpo = (
    <>
      <div className="text-xs text-muted">{r}</div>
      <div className={cn("tabular text-lg font-semibold", alerta && "text-warn")}>{typeof v === "number" ? formatarNumero(v) : v}</div>
      {detalhe && <div className="text-[11px] text-muted">{detalhe}</div>}
    </>
  );
  return href ? <Link href={href} className="block rounded-md hover:bg-surface-2/60">{corpo}</Link> : <div>{corpo}</div>;
}
