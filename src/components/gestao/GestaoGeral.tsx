"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Card } from "@/components/ui";
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

  const seletor = (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="flex rounded-full bg-white/10 p-0.5">
        {PERIODOS.map(([k, r]) => (
          <button key={k} onClick={() => { setChave(k); setIntervalo(periodo(k)); }} aria-pressed={chave === k}
            className={cn("rounded-full px-3 py-1 text-[13px] transition-colors", chave === k ? "bg-white font-medium text-black" : "text-white/70 hover:text-white")}>{r}</button>
        ))}
      </div>
      <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[13px] text-white/70">
        <input type="date" aria-label="De" value={de} onChange={(e) => { setChave("livre"); setIntervalo([e.target.value, ate]); }}
          className="bg-transparent py-0.5 text-white [color-scheme:dark] focus:outline-none" />
        <span>até</span>
        <input type="date" aria-label="Até" value={ate} onChange={(e) => { setChave("livre"); setIntervalo([de, e.target.value]); }}
          className="bg-transparent py-0.5 text-white [color-scheme:dark] focus:outline-none" />
      </div>
      <button onClick={carregar} disabled={carregando} aria-label="Atualizar" className="rounded-full bg-white/10 p-1.5 text-white/70 hover:text-white">
        <RefreshCw size={14} className={cn(carregando && "animate-spin")} />
      </button>
    </div>
  );

  return (
    <div className="-mx-4 -mt-6 lg:-mx-8">
      {!d ? (
        <section className="bg-black px-4 pt-6 pb-10 text-white lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-lg font-semibold">Gestão geral</h1>{seletor}</div>
          <div className="py-16 text-center text-sm text-white/50">Carregando...</div>
        </section>
      ) : <Conteudo d={d} seletor={seletor} />}
    </div>
  );
}

function Conteudo({ d, seletor }: { d: Dados; seletor: React.ReactNode }) {
  const margem = n(d.custo_conhecido) > 0 ? ((n(d.custo_conhecido) - n(d.custo)) / n(d.custo_conhecido)) * 100 : null;
  const ticket = n(d.pedidos) ? n(d.faturado) / n(d.pedidos) : 0;
  const ticketAnt = n(d.pedidos_ant) ? n(d.faturado_ant) / n(d.pedidos_ant) : 0;
  const caixa = n(d.recebido) - n(d.pago);
  const inad = n(d.receber_aberto) > 0 ? (n(d.receber_vencido) / n(d.receber_aberto)) * 100 : 0;
  const st = d.pedidos_status ?? {};
  const varFat = pct(n(d.faturado), n(d.faturado_ant));

  const alertas: [string, string][] = [];
  if (n(d.receber_vencido) > 0) alertas.push([`${formatarMoeda(n(d.receber_vencido))} a receber vencido`, "/financeiro/lancamentos"]);
  if (n(d.pagar_vencido) > 0) alertas.push([`${formatarMoeda(n(d.pagar_vencido))} a pagar vencido`, "/financeiro/lancamentos"]);
  if (n(st.aguardando_credito?.qtd) > 0) alertas.push([`${st.aguardando_credito.qtd} pedidos esperando crédito`, "/vendas/credito"]);
  if (n(d.acertos_pendentes) > 0) alertas.push([`${d.acertos_pendentes} cargas sem acerto`, "/expedicao/cargas"]);
  if (n(d.boletos_erro) > 0) alertas.push([`${d.boletos_erro} boletos com erro`, "/financeiro/painel"]);
  else if (n(d.boletos_a_enviar) > 0) alertas.push([`${d.boletos_a_enviar} boletos para enviar ao banco`, "/financeiro/painel"]);
  if (n(d.estoque_vencido_itens) > 0) alertas.push([`${d.estoque_vencido_itens} produtos com lote vencido`, "/estoque/saldos"]);
  if (n(d.clientes_parados_qtd) > 0) alertas.push([`${d.clientes_parados_qtd} clientes parados há 30+ dias`, "#parados"]);

  return (
    <>
      {/* Faixa preta da marca: faturamento, a régua da meta e o dia a dia */}
      <section className="bg-black px-4 pt-6 pb-16 text-white lg:px-8 xl:rounded-b-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Gestão geral</h1>
            <p className="text-[13px] text-white/50">{formatarData(d.de)} a {formatarData(d.ate)}, comparado com {formatarData(d.ant_de)} a {formatarData(d.ant_ate)}</p>
          </div>
          {seletor}
        </div>

        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-end">
          <div>
            <div className="text-[13px] text-white/60">Faturado no período</div>
            <div className="tabular mt-1 text-[clamp(2.4rem,5vw,3.6rem)] leading-none font-bold tracking-[-0.03em]">{formatarMoeda(n(d.faturado))}</div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              {varFat !== null && (
                <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-medium", varFat >= 0 ? "bg-ok/20 text-[#5fd68a]" : "bg-accent/25 text-[#ff8a8e]")}>
                  {varFat >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{variacaoTexto(varFat)}
                </span>
              )}
              <span className="text-white/60">antes {formatarMoeda(n(d.faturado_ant))}</span>
            </div>
            <ReguaMeta d={d} />
          </div>
          <GraficoDiario dias={d.diario} hoje={d.hoje} />
        </div>
      </section>

      {/* Indicadores numa régua só */}
      <div className="relative -mt-10 px-4 lg:px-8">
        <Card className="grid grid-cols-2 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-line max-lg:[&>*]:border-b max-lg:[&>*]:border-line">
          <Indicador rotulo="Margem bruta" valor={margem === null ? "—" : `${formatarNumero(Math.round(margem * 10) / 10)}%`}
            detalhe={margem === null ? "falta custo nos produtos" : `${formatarMoeda(n(d.custo_conhecido) - n(d.custo))} de lucro bruto`} />
          <Indicador rotulo="Pedidos" valor={formatarNumero(n(d.pedidos))} variacao={pct(n(d.pedidos), n(d.pedidos_ant))} />
          <Indicador rotulo="Ticket médio" valor={formatarMoeda(ticket)} variacao={pct(ticket, ticketAnt)} />
          <Indicador rotulo="Clientes atendidos" valor={formatarNumero(n(d.clientes))} variacao={pct(n(d.clientes), n(d.clientes_ant))}
            detalhe={d.carteira ? `${Math.round((n(d.clientes) / n(d.carteira)) * 100)}% da base de ${formatarNumero(n(d.carteira))}` : undefined} />
          <Indicador rotulo="Caixa do período" valor={formatarMoeda(caixa)} negativo={caixa < 0}
            detalhe={`entrou ${formatarMoeda(n(d.recebido))}, saiu ${formatarMoeda(n(d.pago))}`} />
        </Card>
      </div>

      <div className="space-y-5 px-4 py-5 lg:px-8">
        {alertas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-medium"><AlertTriangle size={15} className="text-accent" /> Resolver</span>
            {alertas.map(([t, h]) => (
              <Link key={t} href={h} className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-[13px] text-ink transition-colors hover:border-accent">{t}</Link>
            ))}
          </div>
        )}

        <Equipe d={d} />

        <div className="grid gap-4 lg:grid-cols-3">
          <Bloco titulo="Maiores clientes">
            <ListaBarras itens={d.top_clientes.map((c) => ({ chave: c.cliente_id ?? c.nome, nome: c.nome, valor: n(c.total),
              extra: c.total_ant ? variacaoTexto(pct(n(c.total), n(c.total_ant))) : "novo", sobe: !c.total_ant || n(c.total) >= n(c.total_ant),
              href: c.cliente_id ? `/cadastros/pessoas/${c.cliente_id}` : undefined }))} />
          </Bloco>
          <Bloco titulo="Produtos que mais venderam">
            <ListaBarras itens={d.top_produtos.map((p) => ({ chave: p.codigo ?? p.nome, nome: p.nome, valor: n(p.total),
              extra: p.margem !== null ? `${formatarNumero(n(p.margem))}% margem` : `${formatarNumero(n(p.quantidade))} un` }))} />
          </Bloco>
          <Bloco titulo="Pararam de comprar" id="parados" lateral={`${d.clientes_parados_qtd} clientes`}>
            {d.clientes_parados.length === 0 ? <p className="text-sm text-muted">Toda a carteira comprou nos últimos 30 dias.</p> : (
              <ul className="-mx-1 divide-y divide-line/70">
                {d.clientes_parados.map((c) => {
                  const dias = Math.round((new Date(d.hoje + "T12:00").getTime() - new Date(c.ultima + "T12:00").getTime()) / 864e5);
                  return (
                    <li key={c.cliente_id}>
                      <Link href={`/cadastros/pessoas/${c.cliente_id}`} className="flex items-center gap-3 rounded-md px-1 py-2 hover:bg-surface-2/70">
                        <span className={cn("tabular w-11 shrink-0 rounded-md py-1 text-center text-xs font-semibold", dias > 60 ? "bg-accent text-white" : "bg-accent-soft text-accent")}>{dias}d</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{c.nome}</span>
                          <span className="block text-xs text-muted">{c.vendedor ?? "sem vendedor"}</span>
                        </span>
                        <span className="tabular shrink-0 text-right text-xs text-muted">{formatarMoeda(n(c.media))}<br />por mês</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Bloco>
        </div>

        {/* Dinheiro: o que vai entrar, o que vai sair e o que tem */}
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_0.9fr]">
          <Bloco titulo="Vai entrar">
            <Valor grande={formatarMoeda(n(d.receber_aberto))} legenda="a receber em aberto" />
            <div className="mt-4 space-y-2">
              <Barra rotulo="Vencido" valor={n(d.receber_vencido)} total={n(d.receber_aberto)} cor="bg-accent" detalhe={`${formatarNumero(Math.round(inad))}% do aberto`} />
              <Barra rotulo="Próximos 30 dias" valor={n(d.receber_30)} total={n(d.receber_aberto)} cor="bg-ok" />
            </div>
            <p className="mt-3 text-xs text-muted">Recebido no período: <b className="tabular font-medium text-ink">{formatarMoeda(n(d.recebido))}</b></p>
          </Bloco>
          <Bloco titulo="Vai sair">
            <Valor grande={formatarMoeda(n(d.pagar_aberto))} legenda="a pagar em aberto" />
            <div className="mt-4 space-y-2">
              <Barra rotulo="Vencido" valor={n(d.pagar_vencido)} total={n(d.pagar_aberto)} cor="bg-accent" />
              <Barra rotulo="Próximos 30 dias" valor={n(d.pagar_30)} total={n(d.pagar_aberto)} cor="bg-chart" />
            </div>
            {d.despesas_grupos.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 text-xs text-muted">Despesas do período</div>
                <ListaBarras itens={d.despesas_grupos.map((g) => ({ chave: g.grupo, nome: g.grupo, valor: n(g.valor) }))} compacta />
              </div>
            )}
          </Bloco>
          <section className="flex flex-col justify-between rounded-lg bg-black p-5 text-white">
            <div>
              <div className="text-[13px] text-white/60">Saldo em caixa e bancos</div>
              <div className="tabular mt-1 text-3xl font-bold tracking-[-0.02em]">{formatarMoeda(n(d.saldo_contas))}</div>
            </div>
            <div className="mt-6 space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-white/60">+ a receber em 30 dias</span><span className="tabular">{formatarMoeda(n(d.receber_30))}</span></div>
              <div className="flex justify-between"><span className="text-white/60">− a pagar em 30 dias</span><span className="tabular">{formatarMoeda(n(d.pagar_30))}</span></div>
              <div className="flex justify-between border-t border-white/15 pt-1.5 font-medium">
                <span>Previsto em 30 dias</span>
                <span className={cn("tabular", n(d.saldo_contas) + n(d.receber_30) - n(d.pagar_30) < 0 && "text-[#ff8a8e]")}>
                  {formatarMoeda(n(d.saldo_contas) + n(d.receber_30) - n(d.pagar_30))}
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* Do pedido à entrega: a esteira de hoje */}
        <Bloco titulo="Do pedido à entrega, agora">
          <ol className="grid gap-px overflow-hidden rounded-md bg-line sm:grid-cols-3 lg:grid-cols-6">
            <Etapa n={1} r="Esperando crédito" v={n(st.aguardando_credito?.qtd)} href="/vendas/credito" alerta={n(st.aguardando_credito?.qtd) > 0} />
            <Etapa n={2} r="Aprovados" v={n(st.aprovado?.qtd)} detalhe={formatarMoeda(n(st.aprovado?.valor))} href="/vendas/pedidos" />
            <Etapa n={3} r="A faturar" v={n(d.a_faturar?.qtd)} detalhe={formatarMoeda(n(d.a_faturar?.valor))} href="/fiscal/faturamento" />
            <Etapa n={4} r="Em separação" v={n(st.em_separacao?.qtd)} detalhe={`${n(d.cargas_abertas)} cargas abertas`} href="/expedicao/cargas" />
            <Etapa n={5} r="Em rota" v={n(st.em_rota?.qtd)} href="/expedicao/acompanhamento" />
            <Etapa n={6} r="Entregues no período" v={n(d.entregas?.entregues)} detalhe={`${n(d.entregas?.devolvidas)} devolvidos, ${n(d.entregas?.ausentes)} ausentes`} href="/expedicao/entregas" />
          </ol>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Mini r="Acertos pendentes" v={formatarNumero(n(d.acertos_pendentes))} alerta={n(d.acertos_pendentes) > 0} href="/expedicao/cargas" />
            <Mini r="Frota no período" v={formatarMoeda(n(d.frota?.valor))} detalhe={`${formatarNumero(n(d.frota?.litros))} litros`} href="/expedicao/despesas" />
            <Mini r="Boletos para enviar" v={formatarNumero(n(d.boletos_a_enviar))} alerta={n(d.boletos_erro) > 0} detalhe={n(d.boletos_erro) ? `${d.boletos_erro} com erro` : undefined} href="/financeiro/painel" />
            <Mini r="Estoque a custo" v={formatarMoeda(n(d.estoque_valor))} href="/estoque/saldos" />
            <Mini r="Abaixo do mínimo" v={formatarNumero(n(d.estoque_abaixo_minimo))} alerta={n(d.estoque_abaixo_minimo) > 0} href="/estoque/saldos" />
            <Mini r="Vencem em 30 dias" v={formatarNumero(n(d.estoque_vence_30))} alerta={n(d.estoque_vencido_itens) > 0}
              detalhe={n(d.estoque_vencido_itens) ? `${d.estoque_vencido_itens} já vencidos` : undefined} href="/estoque/saldos" />
          </div>
        </Bloco>
        <p className="text-xs text-muted">As vendas incluem o histórico importado do Atende. A margem usa o custo cadastrado em cada produto.</p>
      </div>
    </>
  );
}

function variacaoTexto(v: number | null) {
  if (v === null) return "";
  return `${v >= 0 ? "+" : "−"}${formatarNumero(Math.abs(Math.round(v)))}%`;
}

// A régua da meta: onde está, onde deveria estar hoje e onde fecha no ritmo atual
function ReguaMeta({ d }: { d: Dados }) {
  const meta = n(d.meta);
  const mesmoMes = d.de.slice(0, 7) === d.ate.slice(0, 7) && d.de.endsWith("-01");
  if (!meta || !mesmoMes) {
    return <p className="mt-6 text-[13px] text-white/50">{meta ? "A régua da meta aparece quando o período é um mês." : "Sem meta lançada para o mês."}</p>;
  }
  const total = new Date(Number(d.de.slice(0, 4)), Number(d.de.slice(5, 7)), 0).getDate();
  const corrido = Math.min(total, Math.max(1, Number((d.ate < d.hoje ? d.ate : d.hoje).slice(8, 10))));
  const fat = n(d.faturado);
  const projecao = (fat / corrido) * total;
  const escala = Math.max(meta, projecao) * 1.04;
  const x = (v: number) => `${Math.min(100, (v / escala) * 100)}%`;
  const deveria = meta * (corrido / total);
  const falta = Math.max(0, meta - fat);
  return (
    <div className="mt-7">
      <div className="mb-2 flex items-baseline justify-between text-[13px]">
        <span><b className="tabular text-base">{formatarNumero(Math.round((fat / meta) * 1000) / 10)}%</b> <span className="text-white/60">da meta de {formatarMoeda(meta)}</span></span>
        <span className="text-white/60">{falta > 0 ? <>faltam <span className="tabular text-white">{formatarMoeda(falta)}</span></> : <span className="text-[#5fd68a]">meta batida</span>}</span>
      </div>
      <div className="relative h-3 rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-0 rounded-full border border-dashed border-white/30" style={{ width: x(projecao) }} title="Projeção no ritmo atual" />
        <div className={cn("absolute inset-y-0 left-0 rounded-full", fat >= meta ? "bg-ok" : "bg-accent")} style={{ width: x(fat) }} />
        <div className="absolute -inset-y-1.5 w-0.5 rounded bg-white" style={{ left: x(deveria) }} title="Onde deveria estar hoje" />
        <div className="absolute -inset-y-1.5 w-px bg-white/40" style={{ left: x(meta) }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/60">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-0.5 rounded bg-white" /> hoje deveria estar em {formatarMoeda(deveria)}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm border border-dashed border-white/40" /> fecha o mês em {formatarMoeda(projecao)} nesse ritmo</span>
      </div>
    </div>
  );
}

function GraficoDiario({ dias, hoje }: { dias: Dados["diario"]; hoje: string }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const W = 640, H = 170;
  const max = Math.max(1, ...dias.flatMap((x) => [n(x.atual), n(x.anterior)])) * 1.1;
  const passo = W / Math.max(1, dias.length);
  const bw = Math.max(1.5, Math.min(16, passo * 0.62));
  const y = (v: number) => H - (v / max) * H;
  const linha = dias.map((x, i) => `${i ? "L" : "M"}${(i * passo + passo / 2).toFixed(1)} ${y(n(x.anterior)).toFixed(1)}`).join(" ");
  const sel = ativo !== null ? dias[ativo] : null;
  const marca = Math.max(1, Math.round(dias.length / 7));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-white/60">{sel ? formatarData(sel.dia) : "Faturado por dia"}</span>
        {sel ? (
          <span className="tabular">{formatarMoeda(n(sel.atual))} <span className="text-white/50">antes {formatarMoeda(n(sel.anterior))}</span></span>
        ) : (
          <span className="flex items-center gap-3 text-[12px] text-white/60">
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-white/80" /> período</span>
            <span className="flex items-center gap-1"><svg width="14" height="4" aria-hidden><line x1="0" x2="14" y1="2" y2="2" stroke="#ff4d52" strokeDasharray="3 2" strokeWidth="1.5" /></svg> anterior</span>
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full select-none" role="img" aria-label="Faturamento por dia comparado ao período anterior" onPointerLeave={() => setAtivo(null)}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.06)" />)}
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="rgba(255,255,255,0.2)" />
        {dias.map((x, i) => {
          const v = n(x.atual), h = v > 0 ? Math.max(2, H - y(v)) : 0, cx = i * passo + passo / 2;
          const marcado = ativo === i || (ativo === null && x.dia === hoje);
          return (
            <g key={x.dia} onPointerEnter={() => setAtivo(i)}>
              <rect x={i * passo} y={0} width={passo} height={H + 18} fill="transparent" />
              {h > 0 && <rect x={cx - bw / 2} y={H - h} width={bw} height={h} rx={Math.min(3, bw / 2)} fill={marcado ? "#ff4d52" : "#ffffff"} opacity={marcado ? 1 : 0.78} />}
              {x.dia > hoje && <rect x={cx - bw / 2} y={H - 1} width={bw} height={1} fill="rgba(255,255,255,0.25)" />}
              {i % marca === 0 && <text x={cx} y={H + 14} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.45)">{x.dia.slice(8, 10)}/{x.dia.slice(5, 7)}</text>}
            </g>
          );
        })}
        <path d={linha} fill="none" stroke="#ff4d52" strokeWidth="1.6" strokeDasharray="4 3" strokeLinejoin="round" pointerEvents="none" />
      </svg>
    </div>
  );
}

function Indicador({ rotulo, valor, variacao, detalhe, negativo }: { rotulo: string; valor: string; variacao?: number | null; detalhe?: string; negativo?: boolean }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[13px] text-muted">{rotulo}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("tabular text-[1.4rem] leading-tight font-semibold tracking-[-0.01em]", negativo && "text-bad")}>{valor}</span>
        {variacao !== undefined && variacao !== null && (
          <span className={cn("tabular text-xs font-medium", variacao >= 0 ? "text-ok" : "text-bad")}>{variacaoTexto(variacao)}</span>
        )}
      </div>
      {detalhe && <div className="mt-0.5 text-xs text-muted">{detalhe}</div>}
    </div>
  );
}

function Bloco({ titulo, children, lateral, id }: { titulo: string; children: React.ReactNode; lateral?: string; id?: string }) {
  return (
    <Card className="p-5">
      <div id={id} className="mb-4 flex items-baseline justify-between gap-2 scroll-mt-4">
        <h2 className="text-[15px] font-semibold">{titulo}</h2>
        {lateral && <span className="text-xs text-muted">{lateral}</span>}
      </div>
      {children}
    </Card>
  );
}

function Valor({ grande, legenda }: { grande: string; legenda: string }) {
  return (
    <div>
      <div className="tabular text-2xl font-bold tracking-[-0.02em]">{grande}</div>
      <div className="text-xs text-muted">{legenda}</div>
    </div>
  );
}

function Barra({ rotulo, valor, total, cor, detalhe }: { rotulo: string; valor: number; total: number; cor: string; detalhe?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-muted">{rotulo}{detalhe ? <span className="ml-1 text-xs">({detalhe})</span> : null}</span>
        <span className="tabular">{formatarMoeda(valor)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className={cn("h-full rounded-full", cor)} style={{ width: `${total > 0 ? Math.max(valor > 0 ? 2 : 0, Math.min(100, (valor / total) * 100)) : 0}%` }} /></div>
    </div>
  );
}

function Equipe({ d }: { d: Dados }) {
  if (!d.vendedores.length) return null;
  const mesmoMes = d.de.slice(0, 7) === d.ate.slice(0, 7) && d.de.endsWith("-01");
  const total = new Date(Number(d.de.slice(0, 4)), Number(d.de.slice(5, 7)), 0).getDate();
  const ritmo = mesmoMes ? Math.min(1, Math.max(1, Number((d.ate < d.hoje ? d.ate : d.hoje).slice(8, 10))) / total) : null;
  return (
    <Card>
      <div className="flex items-baseline justify-between px-5 pt-5 pb-3">
        <h2 className="text-[15px] font-semibold">Equipe de vendas</h2>
        {ritmo !== null && <span className="flex items-center gap-1.5 text-xs text-muted"><span className="h-3 w-0.5 rounded bg-ink" /> onde deveria estar hoje</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm [&_td]:whitespace-nowrap">
          <thead>
            <tr className="border-y border-line text-left text-xs text-muted">
              <th className="px-5 py-2 font-medium">Vendedor</th><th className="px-3 py-2 text-right font-medium">Faturado</th>
              <th className="w-56 px-3 py-2 font-medium">Meta</th><th className="px-3 py-2 text-right font-medium">Variação</th>
              <th className="px-3 py-2 text-right font-medium">Pedidos</th><th className="px-3 py-2 text-right font-medium">Ticket</th>
              <th className="px-3 py-2 text-right font-medium">Clientes atendidos</th><th className="px-3 py-2 text-right font-medium">Visitas sem pedido</th>
              <th className="px-5 py-2 text-right font-medium">Comissão</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {d.vendedores.map((v) => {
              const p = v.meta ? n(v.faturado) / n(v.meta) : null;
              const varia = pct(n(v.faturado), n(v.faturado_ant));
              const atras = p !== null && ritmo !== null && p < ritmo * 0.9;
              return (
                <tr key={v.nome} className="hover:bg-surface-2/50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">{iniciais(v.nome)}</span>
                      <span className="font-medium">{v.nome}</span>
                    </div>
                  </td>
                  <td className="tabular px-3 py-3 text-right font-medium">{formatarMoeda(n(v.faturado))}</td>
                  <td className="px-3 py-3">
                    {p === null ? <span className="text-xs text-muted">sem meta</span> : (
                      <div className="flex items-center gap-2.5">
                        <div className="relative h-2 flex-1 rounded-full bg-surface-2">
                          <div className={cn("h-full rounded-full", p >= 1 ? "bg-ok" : atras ? "bg-accent" : "bg-chart")} style={{ width: `${Math.min(100, Math.max(2, p * 100))}%` }} />
                          {ritmo !== null && ritmo < 1 && <div className="absolute -inset-y-1 w-0.5 rounded bg-ink" style={{ left: `${ritmo * 100}%` }} />}
                        </div>
                        <span className={cn("tabular w-10 text-right text-xs font-medium", atras && "text-accent")}>{Math.round(p * 100)}%</span>
                      </div>
                    )}
                  </td>
                  <td className={cn("tabular px-3 py-3 text-right text-xs font-medium", varia === null ? "text-muted" : varia >= 0 ? "text-ok" : "text-bad")}>{varia === null ? "—" : variacaoTexto(varia)}</td>
                  <td className="tabular px-3 py-3 text-right">{v.pedidos}</td>
                  <td className="tabular px-3 py-3 text-right">{v.pedidos ? formatarMoeda(n(v.faturado) / n(v.pedidos)) : "—"}</td>
                  <td className="tabular px-3 py-3 text-right">{v.carteira ? <>{v.clientes} <span className="text-muted">de {v.carteira}</span></> : v.clientes}</td>
                  <td className="tabular px-3 py-3 text-right">{v.sem_pedido}</td>
                  <td className="tabular px-5 py-3 text-right">{formatarMoeda(n(v.comissao))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function ListaBarras({ itens, compacta }: { itens: { chave: string; nome: string; valor: number; extra?: string; sobe?: boolean; href?: string }[]; compacta?: boolean }) {
  if (!itens.length) return <p className="text-sm text-muted">Nada no período.</p>;
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className={compacta ? "space-y-2" : "space-y-3"}>
      {itens.map((i, k) => (
        <li key={i.chave} className="text-sm">
          <div className="flex items-baseline gap-2">
            {!compacta && <span className="tabular w-4 shrink-0 text-xs text-muted">{k + 1}</span>}
            {i.href ? <Link href={i.href} className="min-w-0 flex-1 truncate hover:text-accent">{i.nome}</Link> : <span className="min-w-0 flex-1 truncate">{i.nome}</span>}
            <span className="tabular shrink-0 font-medium">{formatarMoeda(i.valor)}</span>
          </div>
          <div className={cn("mt-1 flex items-center gap-2", !compacta && "pl-6")}>
            <div className="h-1 flex-1 rounded-full bg-surface-2"><div className="h-full rounded-full bg-chart" style={{ width: `${Math.max(2, (i.valor / max) * 100)}%` }} /></div>
            {i.extra && <span className={cn("w-20 shrink-0 text-right text-[11px]", i.sobe === undefined ? "text-muted" : i.sobe ? "text-ok" : "text-bad")}>{i.extra}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Etapa({ n: num, r, v, detalhe, href, alerta }: { n: number; r: string; v: number; detalhe?: string; href: string; alerta?: boolean }) {
  return (
    <li className="bg-surface">
      <Link href={href} className="flex h-full flex-col gap-1 p-4 transition-colors hover:bg-surface-2/70">
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-semibold", alerta ? "bg-accent text-white" : "bg-surface-2 text-ink")}>{num}</span>{r}
        </span>
        <span className={cn("tabular text-2xl font-semibold", alerta && "text-accent")}>{formatarNumero(v)}</span>
        {detalhe && <span className="text-xs text-muted">{detalhe}</span>}
      </Link>
    </li>
  );
}

function Mini({ r, v, detalhe, href, alerta }: { r: string; v: string; detalhe?: string; href: string; alerta?: boolean }) {
  return (
    <Link href={href} className="block rounded-md -m-1 p-1 hover:bg-surface-2/60">
      <div className="text-xs text-muted">{r}</div>
      <div className={cn("tabular font-semibold", alerta && "text-accent")}>{v}</div>
      {detalhe && <div className="text-[11px] text-muted">{detalhe}</div>}
    </Link>
  );
}
