"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, Minus, Plus, RefreshCw } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, dataLocal, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";
import { DialogoNovo, useOpcoesFinanceiro } from "@/components/financeiro/Dialogos";
import { CaixaBancos } from "@/components/financeiro/CaixaBancos";
import { CobrancaSicredi } from "@/components/financeiro/CobrancaSicredi";

const ABAS = ["Visão geral", "DRE simples", "Fluxo de caixa", "Caixa e bancos", "Plano de contas", "Centros de custo", "Boletos Sicredi"] as const;
type Aba = (typeof ABAS)[number];
export const GRUPOS_DRE = ["Receita bruta", "Impostos sobre vendas", "Custo das mercadorias", "Despesas comerciais", "Despesas com pessoal",
  "Despesas administrativas", "Resultado financeiro", "Outras receitas", "Outras despesas"];

const inicioMes = () => `${dataLocal().slice(0, 7)}-01`;
const fimMes = () => { const [a, m] = dataLocal().split("-").map(Number); return `${a}-${String(m).padStart(2, "0")}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`; };
const pct = (v: number, base: number) => (base ? `${formatarNumero(Math.round((v / base) * 1000) / 10)}%` : "");

export function PainelFinanceiro({ podeEditar, podeCriar }: { podeEditar: boolean; podeCriar: boolean }) {
  const [de, setDe] = useState(inicioMes);
  const [ate, setAte] = useState(fimMes);
  const [periodo, setPeriodo] = useState({ de: inicioMes(), ate: fimMes() });
  const [aba, setAba] = useState<Aba>("Visão geral");
  const [novo, setNovo] = useState<"receber" | "pagar" | null>(null);
  const [versao, setVersao] = useState(0);
  const atualizar = () => { if (de && ate && de <= ate) { setPeriodo({ de, ate }); setVersao((v) => v + 1); } else toast.error("Período inválido"); };

  return (
    <>
      <Cabecalho trilha="Financeiro" titulo="Departamento financeiro"
        acoes={podeCriar && <>
          <Button onClick={() => setNovo("receber")}><Plus size={16} /> Receita</Button>
          <Button variante="primario" onClick={() => setNovo("pagar")}><Minus size={16} /> Despesa</Button>
        </>} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">De <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" /></label>
        <label className="flex items-center gap-1.5">Até <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" /></label>
        <Button onClick={atualizar}><RefreshCw size={15} /> Atualizar</Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {ABAS.map((a) => (
          <button key={a} onClick={() => setAba(a)} aria-pressed={aba === a}
            className={cn("rounded-md border px-3.5 py-1.5 text-sm", aba === a ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface hover:bg-surface-2")}>{a}</button>
        ))}
      </div>

      {aba === "Visão geral" && <VisaoGeral key={`v${versao}`} de={periodo.de} ate={periodo.ate} irPara={setAba} />}
      {aba === "DRE simples" && <Dre key={`d${versao}`} de={periodo.de} ate={periodo.ate} />}
      {aba === "Fluxo de caixa" && <Fluxo key={`f${versao}`} de={periodo.de} ate={periodo.ate} />}
      {aba === "Caixa e bancos" && <CaixaBancos />}
      {aba === "Plano de contas" && <PlanoContas podeEditar={podeEditar} podeCriar={podeCriar} />}
      {aba === "Centros de custo" && <Centros key={`c${versao}`} podeEditar={podeEditar} podeCriar={podeCriar} de={periodo.de} ate={periodo.ate} />}
      {aba === "Boletos Sicredi" && <CobrancaSicredi de={periodo.de} ate={periodo.ate} />}

      <DialogoNovo tipo={novo ?? "pagar"} aberto={!!novo} aoFechar={() => setNovo(null)} aoConcluir={() => { setNovo(null); setVersao((v) => v + 1); }} />
    </>
  );
}

// ---------------------------------------------------------------------
type Resumo = {
  recebido: number; pago: number; a_receber: number; a_pagar: number; atraso_receber: number; atraso_pagar: number;
  vence_7_receber: number; vence_7_pagar: number; sem_classificacao: number; saldo_contas: number;
};
function VisaoGeral({ de, ate, irPara }: { de: string; ate: string; irPara: (a: Aba) => void }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [r, setR] = useState<Resumo | null>(null);
  const [contas, setContas] = useState<{ id: string; nome: string; saldo_atual: number }[]>([]);
  useEffect(() => {
    supabase.rpc("fin_resumo", { p_de: de, p_ate: ate }).then(({ data, error }) => {
      if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
      setR(data as Resumo);
    });
    supabase.from("vw_contas_saldos").select("id, nome, saldo_atual").eq("ativo", true).order("nome").then(({ data }) => setContas((data ?? []) as typeof contas));
  }, [supabase, de, ate]);
  if (!r) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;
  const resultado = Number(r.recebido) - Number(r.pago);
  const cartao = (t: string, v: number, sub?: string, tom?: "ok" | "erro") => (
    <Card className="p-4">
      <div className="text-xs text-muted">{t}</div>
      <div className={cn("tabular text-xl font-semibold", tom === "ok" && "text-ok", tom === "erro" && "text-bad")}>{formatarMoeda(v)}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cartao("Recebido no período", r.recebido)}
        {cartao("Pago no período", r.pago)}
        {cartao("Resultado de caixa", resultado, "recebido − pago", resultado >= 0 ? "ok" : "erro")}
        {cartao("Saldo em caixa e bancos", r.saldo_contas, "hoje")}
        {cartao("A receber no período", r.a_receber, `${formatarMoeda(r.vence_7_receber)} nos próximos 7 dias`)}
        {cartao("A pagar no período", r.a_pagar, `${formatarMoeda(r.vence_7_pagar)} nos próximos 7 dias`)}
        {cartao("Recebimentos atrasados", r.atraso_receber, undefined, Number(r.atraso_receber) > 0 ? "erro" : undefined)}
        {cartao("Pagamentos atrasados", r.atraso_pagar, undefined, Number(r.atraso_pagar) > 0 ? "erro" : undefined)}
      </div>
      {Number(r.sem_classificacao) > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-warn/40 bg-warn/5 p-3 text-sm">
          <span><b>{r.sem_classificacao}</b> {Number(r.sem_classificacao) === 1 ? "título está" : "títulos estão"} sem categoria ou sem centro de custo. Sem isso a DRE fica incompleta.</span>
          <Button tamanho="p" onClick={() => irPara("Centros de custo")}>Classificar títulos</Button>
        </Card>
      )}
      <Card>
        <div className="border-b border-line px-3 py-2 text-sm font-medium">Saldo por conta</div>
        <ul className="divide-y divide-line/70 text-sm">
          {contas.map((c) => <li key={c.id} className="flex justify-between px-3 py-2"><span>{c.nome}</span><span className={cn("tabular", Number(c.saldo_atual) < 0 && "text-bad")}>{formatarMoeda(c.saldo_atual)}</span></li>)}
        </ul>
      </Card>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/financeiro/lancamentos"><Button>Contas a pagar e receber</Button></Link>
        <Button onClick={() => irPara("DRE simples")}>Ver DRE</Button>
        <Button onClick={() => irPara("Fluxo de caixa")}>Ver fluxo de caixa</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
type LinhaDre = { grupo: string; ordem: number; conta_id: string | null; conta_codigo: string | null; conta_nome: string; tipo: "receber" | "pagar"; valor: number; qtd: number };
function Dre({ de, ate }: { de: string; ate: string }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [regime, setRegime] = useState<"competencia" | "caixa">("competencia");
  const [linhas, setLinhas] = useState<LinhaDre[] | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  useEffect(() => {
    setLinhas(null);
    supabase.rpc("fin_dre", { p_de: de, p_ate: ate, p_regime: regime }).then(({ data, error }) => {
      if (error) return toast.error("Não foi possível carregar a DRE", { description: mensagemErro(error) });
      setLinhas((data ?? []) as LinhaDre[]);
    });
  }, [supabase, de, ate, regime]);
  if (!linhas) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;

  // valor com sinal: receita soma, despesa subtrai
  const sinal = (l: LinhaDre) => (l.tipo === "receber" ? 1 : -1) * Number(l.valor);
  const g = (nome: string) => linhas.filter((l) => l.grupo === nome).reduce((a, l) => a + sinal(l), 0);
  const bruta = g("Receita bruta");
  const liquida = bruta + g("Impostos sobre vendas");
  const lucroBruto = liquida + g("Custo das mercadorias");
  const operacional = lucroBruto + g("Despesas comerciais") + g("Despesas com pessoal") + g("Despesas administrativas");
  const semClass = g("Sem classificação");
  const liquido = operacional + g("Resultado financeiro") + g("Outras receitas") + g("Outras despesas") + semClass;

  const Grupo = ({ nome, prefixo }: { nome: string; prefixo: string }) => {
    const contas = linhas.filter((l) => l.grupo === nome);
    const v = g(nome);
    const aberto = abertos.has(nome);
    if (!contas.length && nome === "Sem classificação") return null;
    return (
      <>
        <tr className="border-b border-line/60">
          <td className="px-3 py-2">
            <button className="flex items-center gap-1.5 disabled:cursor-default" disabled={!contas.length}
              onClick={() => setAbertos((s) => { const n = new Set(s); if (n.has(nome)) n.delete(nome); else n.add(nome); return n; })}>
              <ChevronRight size={14} className={cn("text-muted transition-transform", aberto && "rotate-90", !contas.length && "opacity-0")} />
              <span className="text-muted">{prefixo}</span> {nome}
              {nome === "Sem classificação" && <Badge tom="aviso">classificar</Badge>}
            </button>
          </td>
          <td className={cn("tabular px-3 py-2 text-right", v < 0 && "text-bad")}>{formatarMoeda(v)}</td>
          <td className="tabular px-3 py-2 text-right text-xs text-muted">{pct(v, bruta)}</td>
        </tr>
        {aberto && contas.map((c) => (
          <tr key={`${c.conta_id}-${c.tipo}`} className="border-b border-line/40 text-xs">
            <td className="py-1.5 pr-3 pl-10 text-muted">{c.conta_codigo ? `${c.conta_codigo} · ` : ""}{c.conta_nome} <span className="text-muted/60">({c.qtd})</span></td>
            <td className="tabular px-3 py-1.5 text-right">{formatarMoeda(sinal(c))}</td>
            <td />
          </tr>
        ))}
      </>
    );
  };
  const Total = ({ nome, v }: { nome: string; v: number }) => (
    <tr className="border-b border-line bg-surface-2/60 font-semibold">
      <td className="px-3 py-2">= {nome}</td>
      <td className={cn("tabular px-3 py-2 text-right", v < 0 && "text-bad")}>{formatarMoeda(v)}</td>
      <td className="tabular px-3 py-2 text-right text-xs">{pct(v, bruta)}</td>
    </tr>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-sm font-medium">DRE simples · {formatarData(de)} a {formatarData(ate)}</span>
        <div className="flex gap-1 text-xs">
          {([["competencia", "Competência"], ["caixa", "Caixa (pagos)"]] as const).map(([k, r]) => (
            <button key={k} onClick={() => setRegime(k)} aria-pressed={regime === k}
              className={cn("rounded-full border px-3 py-1", regime === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>{r}</button>
          ))}
        </div>
      </div>
      {linhas.length === 0 ? <Vazio titulo="Nenhum lançamento no período" /> : (
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr><th className="px-3 py-2 font-medium">Conta</th><th className="px-3 py-2 text-right font-medium">Valor</th><th className="w-20 px-3 py-2 text-right font-medium">% receita</th></tr>
          </thead>
          <tbody>
            <Grupo nome="Receita bruta" prefixo="(+)" />
            <Grupo nome="Impostos sobre vendas" prefixo="(−)" />
            <Total nome="Receita líquida" v={liquida} />
            <Grupo nome="Custo das mercadorias" prefixo="(−)" />
            <Total nome="Lucro bruto" v={lucroBruto} />
            <Grupo nome="Despesas comerciais" prefixo="(−)" />
            <Grupo nome="Despesas com pessoal" prefixo="(−)" />
            <Grupo nome="Despesas administrativas" prefixo="(−)" />
            <Total nome="Resultado operacional" v={operacional} />
            <Grupo nome="Resultado financeiro" prefixo="(±)" />
            <Grupo nome="Outras receitas" prefixo="(+)" />
            <Grupo nome="Outras despesas" prefixo="(−)" />
            <Grupo nome="Sem classificação" prefixo="(±)" />
            <Total nome="Resultado líquido" v={liquido} />
          </tbody>
        </table>
      )}
      <p className="px-3 py-2 text-xs text-muted">
        {regime === "competencia" ? "Competência: conta pela data de competência de cada título, pago ou não." : "Caixa: conta só o que foi pago ou recebido no período, pela data do pagamento."}
        {" "}As vendas entram como receita bruta pelo valor dos títulos dos pedidos.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------
type DiaFluxo = { data: string; recebido: number; pago: number; a_receber: number; a_pagar: number; saldo: number };
function Fluxo({ de, ate }: { de: string; ate: string }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [dias, setDias] = useState<DiaFluxo[] | null>(null);
  const [agrupar, setAgrupar] = useState<"dia" | "semana" | "mes">("dia");
  useEffect(() => {
    setDias(null);
    supabase.rpc("fin_fluxo_caixa", { p_de: de, p_ate: ate }).then(({ data, error }) => {
      if (error) return toast.error("Não foi possível carregar o fluxo", { description: mensagemErro(error) });
      setDias((data ?? []) as DiaFluxo[]);
    });
  }, [supabase, de, ate]);
  const linhas = useMemo(() => {
    const chave = (d: string) => {
      if (agrupar === "dia") return d;
      if (agrupar === "mes") return d.slice(0, 7);
      const dt = new Date(`${d}T12:00`); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); return dt.toISOString().slice(0, 10);
    };
    const m = new Map<string, DiaFluxo & { ate: string }>();
    for (const d of dias ?? []) {
      const k = chave(d.data);
      const x = m.get(k) ?? { data: k, ate: d.data, recebido: 0, pago: 0, a_receber: 0, a_pagar: 0, saldo: 0 };
      x.recebido += Number(d.recebido); x.pago += Number(d.pago); x.a_receber += Number(d.a_receber); x.a_pagar += Number(d.a_pagar);
      x.saldo = Number(d.saldo); x.ate = d.data;
      m.set(k, x);
    }
    return [...m.values()];
  }, [dias, agrupar]);
  if (!dias) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;
  const tot = linhas.reduce((a, l) => ({ r: a.r + l.recebido, p: a.p + l.pago, ar: a.ar + l.a_receber, ap: a.ap + l.a_pagar }), { r: 0, p: 0, ar: 0, ap: 0 });
  const hoje = dataLocal();
  const rotulo = (l: { data: string; ate: string }) => agrupar === "dia" ? formatarData(l.data)
    : agrupar === "mes" ? new Date(`${l.data}-15T12:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    : `${formatarData(l.data).slice(0, 5)} a ${formatarData(l.ate).slice(0, 5)}`;
  const visiveis = agrupar === "dia" ? linhas.filter((l) => l.recebido || l.pago || l.a_receber || l.a_pagar || l.data === hoje) : linhas;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-sm font-medium">Fluxo de caixa · realizado até hoje e previsto pelos vencimentos</span>
        <div className="flex gap-1 text-xs">
          {([["dia", "Por dia"], ["semana", "Por semana"], ["mes", "Por mês"]] as const).map(([k, r]) => (
            <button key={k} onClick={() => setAgrupar(k)} aria-pressed={agrupar === k}
              className={cn("rounded-full border px-3 py-1", agrupar === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>{r}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Período</th>
              <th className="px-3 py-2 text-right font-medium">Recebido</th><th className="px-3 py-2 text-right font-medium">Pago</th>
              <th className="px-3 py-2 text-right font-medium">A receber</th><th className="px-3 py-2 text-right font-medium">A pagar</th>
              <th className="px-3 py-2 text-right font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {visiveis.map((l) => (
              <tr key={l.data} className={cn(agrupar === "dia" && l.data === hoje && "bg-accent-soft/40")}>
                <td className="px-3 py-1.5 whitespace-nowrap">{rotulo(l)}{agrupar === "dia" && l.data === hoje ? " · hoje" : ""}</td>
                <td className="tabular px-3 py-1.5 text-right text-ok">{l.recebido ? formatarMoeda(l.recebido) : ""}</td>
                <td className="tabular px-3 py-1.5 text-right text-bad">{l.pago ? formatarMoeda(l.pago) : ""}</td>
                <td className="tabular px-3 py-1.5 text-right">{l.a_receber ? formatarMoeda(l.a_receber) : ""}</td>
                <td className="tabular px-3 py-1.5 text-right">{l.a_pagar ? formatarMoeda(l.a_pagar) : ""}</td>
                <td className={cn("tabular px-3 py-1.5 text-right font-medium", l.saldo < 0 && "text-bad")}>{formatarMoeda(l.saldo)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line font-semibold">
            <tr>
              <td className="px-3 py-2">Total</td>
              <td className="tabular px-3 py-2 text-right">{formatarMoeda(tot.r)}</td><td className="tabular px-3 py-2 text-right">{formatarMoeda(tot.p)}</td>
              <td className="tabular px-3 py-2 text-right">{formatarMoeda(tot.ar)}</td><td className="tabular px-3 py-2 text-right">{formatarMoeda(tot.ap)}</td>
              <td className="tabular px-3 py-2 text-right">{formatarMoeda(linhas[linhas.length - 1]?.saldo ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-3 py-2 text-xs text-muted">Títulos vencidos e não pagos aparecem como previstos para hoje. O saldo parte do saldo das contas no início do período.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------
type Conta = { id: string; codigo: string; nome: string; tipo: "receita" | "despesa"; grupo_dre: string | null; ativo: boolean };
function PlanoContas({ podeEditar, podeCriar }: { podeEditar: boolean; podeCriar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [editando, setEditando] = useState<Conta | null>(null);
  const [nova, setNova] = useState<Omit<Conta, "id" | "ativo"> | null>(null);
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("plano_contas").select("id, codigo, nome, tipo, grupo_dre, ativo").order("codigo");
    if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
    setContas((data ?? []) as Conta[]);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  function proximoCodigo(tipo: "receita" | "despesa") {
    const raiz = tipo === "receita" ? "1" : "2";
    const nums = (contas ?? []).filter((c) => c.codigo.startsWith(`${raiz}.`)).map((c) => Number(c.codigo.split(".")[1]) || 0).filter((n) => n < 99);
    return `${raiz}.${String(Math.max(0, ...nums) + 1).padStart(2, "0")}`;
  }
  async function salvarEdicao() {
    if (!editando || !editando.nome.trim()) return toast.error("Informe o nome");
    const { error } = await supabase.from("plano_contas").update({ nome: editando.nome.trim(), grupo_dre: editando.grupo_dre || null, ativo: editando.ativo }).eq("id", editando.id);
    if (error) return toast.error("Não foi possível salvar", { description: mensagemErro(error) });
    toast.success("Conta salva"); setEditando(null); carregar();
  }
  async function criar() {
    if (!nova || !nova.nome.trim() || !nova.codigo.trim()) return toast.error("Informe código e nome");
    const raiz = nova.codigo.split(".")[0];
    const pai = (contas ?? []).find((c) => c.codigo === raiz);
    const { error } = await supabase.from("plano_contas").insert({ codigo: nova.codigo.trim(), nome: nova.nome.trim(), tipo: nova.tipo, grupo_dre: nova.grupo_dre || null, pai_id: pai?.id ?? null });
    if (error) return toast.error("Não foi possível criar", { description: mensagemErro(error) });
    toast.success("Conta criada"); setNova(null); carregar();
  }
  if (!contas) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;
  return (
    <>
      {podeCriar && <Button variante="primario" className="mb-3" onClick={() => setNova({ codigo: proximoCodigo("despesa"), nome: "", tipo: "despesa", grupo_dre: "Despesas administrativas" })}><Plus size={16} /> Conta</Button>}
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted uppercase">
            <tr><th className="px-3 py-2 font-medium">Código</th><th className="px-3 py-2 font-medium">Conta</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 font-medium">Grupo na DRE</th><th className="px-3 py-2 font-medium">Ativo</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {contas.map((c) => {
              const sintetica = !c.codigo.includes(".");
              return (
                <tr key={c.id} className={cn(sintetica && "bg-surface-2/50 font-medium", !c.ativo && "opacity-50")}>
                  <td className="tabular px-3 py-2">{c.codigo}</td>
                  <td className={cn("px-3 py-2", !sintetica && "pl-6")}>{c.nome}</td>
                  <td className="px-3 py-2 text-xs">{c.tipo === "receita" ? "Receita" : "Despesa"}</td>
                  <td className="px-3 py-2 text-xs text-muted">{sintetica ? "" : c.grupo_dre ?? <Badge tom="aviso">sem grupo</Badge>}</td>
                  <td className="px-3 py-2 text-xs">{c.ativo ? "Sim" : "Não"}</td>
                  <td className="px-3 py-1.5 text-right">{podeEditar && !sintetica && <Button tamanho="p" onClick={() => setEditando({ ...c })}>Editar</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Dialogo aberto={!!editando} titulo={`Conta ${editando?.codigo ?? ""}`} aoFechar={() => setEditando(null)}
        rodape={<><Button onClick={() => setEditando(null)}>Voltar</Button><Button variante="primario" onClick={salvarEdicao}>Salvar</Button></>}>
        {editando && (
          <div className="space-y-3">
            <div><Label htmlFor="pc-nome" obrigatorio>Nome</Label><Input id="pc-nome" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} /></div>
            <div><Label htmlFor="pc-grupo">Grupo na DRE</Label>
              <Select id="pc-grupo" value={editando.grupo_dre ?? ""} onChange={(e) => setEditando({ ...editando, grupo_dre: e.target.value || null })}>
                <option value="">—</option>{GRUPOS_DRE.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativa (aparece para escolher nos lançamentos)</label>
          </div>
        )}
      </Dialogo>
      <Dialogo aberto={!!nova} titulo="Nova conta" aoFechar={() => setNova(null)}
        rodape={<><Button onClick={() => setNova(null)}>Voltar</Button><Button variante="primario" onClick={criar}>Criar</Button></>}>
        {nova && (
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="nc-tipo">Tipo</Label>
              <Select id="nc-tipo" value={nova.tipo} onChange={(e) => { const t = e.target.value as Conta["tipo"]; setNova({ ...nova, tipo: t, codigo: proximoCodigo(t), grupo_dre: t === "receita" ? "Outras receitas" : "Despesas administrativas" }); }}>
                <option value="despesa">Despesa</option><option value="receita">Receita</option>
              </Select></div>
            <div><Label htmlFor="nc-cod" obrigatorio>Código</Label><Input id="nc-cod" value={nova.codigo} onChange={(e) => setNova({ ...nova, codigo: e.target.value })} /></div>
            <div className="col-span-2"><Label htmlFor="nc-nome" obrigatorio>Nome</Label><Input id="nc-nome" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} /></div>
            <div className="col-span-2"><Label htmlFor="nc-grupo">Grupo na DRE</Label>
              <Select id="nc-grupo" value={nova.grupo_dre ?? ""} onChange={(e) => setNova({ ...nova, grupo_dre: e.target.value || null })}>
                <option value="">—</option>{GRUPOS_DRE.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select></div>
          </div>
        )}
      </Dialogo>
    </>
  );
}

// ---------------------------------------------------------------------
type Centro = { id: string; nome: string; ativo: boolean };
type Titulo = {
  id: string; tipo: "receber" | "pagar"; descricao: string; pessoa_nome: string | null; origem: string; origem_id: string | null; valor: number;
  data_vencimento: string; data_competencia: string; plano_conta_id: string | null; plano_conta_nome: string | null; centro_custo_id: string | null; centro_custo_nome: string | null;
  total_parcelas: number;
};
function Centros({ podeEditar, podeCriar, de, ate }: { podeEditar: boolean; podeCriar: boolean; de: string; ate: string }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const op = useOpcoesFinanceiro();
  const [centros, setCentros] = useState<Centro[] | null>(null);
  const [editando, setEditando] = useState<Centro | null>(null);
  const [titulos, setTitulos] = useState<Titulo[] | null>(null);
  const [soPendentes, setSoPendentes] = useState(true);
  const [classif, setClassif] = useState<Titulo | null>(null);
  const [cf, setCf] = useState({ plano: "", centro: "", competencia: "" });

  const carregar = useCallback(async () => {
    const [c, t] = await Promise.all([
      supabase.from("centros_custo").select("id, nome, ativo").order("nome"),
      (() => {
        let q = supabase.from("vw_lancamentos")
          .select("id, tipo, descricao, pessoa_nome, origem, origem_id, valor, data_vencimento, data_competencia, plano_conta_id, plano_conta_nome, centro_custo_id, centro_custo_nome, total_parcelas")
          .eq("ativo", true).gte("data_competencia", de).lte("data_competencia", ate);
        if (soPendentes) q = q.or("plano_conta_id.is.null,and(tipo.eq.pagar,centro_custo_id.is.null)");
        return q.order("data_competencia", { ascending: false }).limit(500);
      })(),
    ]);
    setCentros((c.data ?? []) as Centro[]);
    if (t.error) return toast.error("Não foi possível carregar os títulos", { description: mensagemErro(t.error) });
    // uma linha por pedido/compra (as parcelas são classificadas juntas)
    const vistos = new Set<string>();
    setTitulos(((t.data ?? []) as Titulo[]).filter((x) => {
      if (x.origem === "manual" || !x.origem_id) return true;
      const k = `${x.origem}:${x.origem_id}`; if (vistos.has(k)) return false; vistos.add(k); return true;
    }));
  }, [supabase, de, ate, soPendentes]);
  useEffect(() => { carregar(); }, [carregar]);

  async function salvarCentro() {
    if (!editando || !editando.nome.trim()) return toast.error("Informe o nome");
    const { error } = editando.id
      ? await supabase.from("centros_custo").update({ nome: editando.nome.trim(), ativo: editando.ativo }).eq("id", editando.id)
      : await supabase.from("centros_custo").insert({ nome: editando.nome.trim() });
    if (error) return toast.error("Não foi possível salvar", { description: mensagemErro(error) });
    toast.success("Centro de custo salvo"); setEditando(null); carregar();
  }
  async function classificar() {
    if (!classif) return;
    if (!cf.plano) return toast.error("Escolha a categoria");
    const { data, error } = await supabase.rpc("fin_classificar", {
      p_lancamento: classif.id, p_plano_conta: cf.plano, p_centro_custo: cf.centro || null,
      p_competencia: classif.tipo === "pagar" && cf.competencia ? cf.competencia : null, p_todas_parcelas: true,
    });
    if (error) return toast.error("Não foi possível classificar", { description: mensagemErro(error) });
    toast.success(`${data} ${Number(data) === 1 ? "título classificado" : "títulos classificados"}`);
    setClassif(null); carregar();
  }
  const ORIGEM: Record<string, string> = { pedido: "Venda", nota_entrada: "Compra", manual: "Manual", ofx: "Extrato" };

  return (
    <>
      {podeCriar && <Button variante="primario" className="mb-3" onClick={() => setEditando({ id: "", nome: "", ativo: true })}><Plus size={16} /> Centro de custo</Button>}
      <Card>
        {centros === null ? <div className="py-6 text-center text-sm text-muted">Carregando...</div> : centros.length === 0 ? <Vazio titulo="Nenhum centro de custo" texto="Ex.: Administrativo, Comercial, Logística." /> : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted uppercase"><tr><th className="px-3 py-2 font-medium">Centro de custo</th><th className="px-3 py-2 font-medium">Ativo</th><th /></tr></thead>
            <tbody className="divide-y divide-line/70">
              {centros.map((c) => (
                <tr key={c.id} className={cn(!c.ativo && "opacity-50")}>
                  <td className="px-3 py-2">{c.nome}</td><td className="px-3 py-2">{c.ativo ? "Sim" : "Não"}</td>
                  <td className="px-3 py-1.5 text-right">{podeEditar && <Button tamanho="p" onClick={() => setEditando({ ...c })}>Editar</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-5 mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Classificar títulos</h2>
          <p className="text-sm text-muted">A classificação de uma venda vale para todas as suas parcelas. Nas despesas, informe também a data de competência.</p>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> Só os sem classificação</label>
      </div>
      <Card>
        {titulos === null ? <div className="py-6 text-center text-sm text-muted">Carregando...</div> : titulos.length === 0 ? <Vazio titulo={soPendentes ? "Tudo classificado no período" : "Nenhum título no período"} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-muted uppercase">
                <tr><th className="px-3 py-2 font-medium">Origem</th><th className="px-3 py-2 font-medium">Descrição</th><th className="px-3 py-2 text-right font-medium">Valor</th><th className="px-3 py-2 font-medium">Categoria / centro</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {titulos.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{t.tipo === "receber" ? "A receber" : "A pagar"}<div className="text-muted">{ORIGEM[t.origem] ?? t.origem}</div></td>
                    <td className="px-3 py-2">{[t.pessoa_nome, t.descricao].filter(Boolean).join(" · ")}<div className="text-xs text-muted">competência {formatarData(t.data_competencia)}{t.total_parcelas > 1 ? ` · ${t.total_parcelas} parcelas` : ""}</div></td>
                    <td className="tabular px-3 py-2 text-right">{formatarMoeda(t.valor)}</td>
                    <td className="px-3 py-2 text-xs">
                      {t.plano_conta_nome ?? <span className="text-warn">Sem categoria</span>} · {t.centro_custo_nome ?? <span className={t.tipo === "pagar" ? "text-warn" : "text-muted"}>Sem centro definido</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">{podeEditar && <Button tamanho="p" onClick={() => { setClassif(t); setCf({ plano: t.plano_conta_id ?? "", centro: t.centro_custo_id ?? "", competencia: t.data_competencia }); }}>Classificar</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialogo aberto={!!editando} titulo={editando?.id ? "Editar centro de custo" : "Novo centro de custo"} aoFechar={() => setEditando(null)}
        rodape={<><Button onClick={() => setEditando(null)}>Voltar</Button><Button variante="primario" onClick={salvarCentro}>Salvar</Button></>}>
        {editando && (
          <div className="space-y-3">
            <div><Label htmlFor="cc-nome" obrigatorio>Nome</Label><Input id="cc-nome" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} /></div>
            {editando.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo</label>}
          </div>
        )}
      </Dialogo>
      <Dialogo aberto={!!classif} titulo="Classificar título" descricao={classif ? `${[classif.pessoa_nome, classif.descricao].filter(Boolean).join(" · ")} · ${formatarMoeda(classif.valor)}` : undefined}
        aoFechar={() => setClassif(null)}
        rodape={<><Button onClick={() => setClassif(null)}>Voltar</Button><Button variante="primario" onClick={classificar}>Salvar</Button></>}>
        {classif && (
          <div className="space-y-3">
            <div><Label htmlFor="cl-plano" obrigatorio>Categoria ({classif.tipo === "receber" ? "receita" : "despesa"})</Label>
              <Select id="cl-plano" value={cf.plano} onChange={(e) => setCf({ ...cf, plano: e.target.value })}>
                <option value="">—</option>{(classif.tipo === "receber" ? op.receitas : op.despesas).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </Select></div>
            <div><Label htmlFor="cl-centro">Centro de custo</Label>
              <Select id="cl-centro" value={cf.centro} onChange={(e) => setCf({ ...cf, centro: e.target.value })}>
                <option value="">—</option>{op.centros.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </Select></div>
            {classif.tipo === "pagar" && <div><Label htmlFor="cl-comp">Data de competência</Label><Input id="cl-comp" type="date" value={cf.competencia} onChange={(e) => setCf({ ...cf, competencia: e.target.value })} /></div>}
            {classif.origem !== "manual" && <p className="text-xs text-muted">Vale para todas as parcelas deste {classif.origem === "pedido" ? "pedido" : "documento"}.</p>}
          </div>
        )}
      </Dialogo>
    </>
  );
}

// ---------------------------------------------------------------------
