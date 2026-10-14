"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { BuscaRegistro, type Resultado } from "@/components/ui/BuscaRegistro";
import { carregarOpcoesRelacao } from "@/components/crud/CampoInput";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { buscarPessoas } from "@/lib/buscas";
import { mensagemErro, type Tom } from "@/lib/pedidos";
import type { Opcao } from "@/lib/entidades";

export type Lancamento = {
  id: string; tipo: "receber" | "pagar"; situacao: "em_aberto" | "vence_hoje" | "atrasado" | "quitado" | "cancelado";
  pessoa_id: string | null; pessoa_nome: string | null; pessoa_fantasia: string | null; pessoa_codigo: number | null;
  descricao: string; documento: string | null; parcela: number; total_parcelas: number; valor: number;
  data_competencia: string; data_vencimento: string; data_quitacao: string | null; valor_pago: number | null;
  juros: number; multa: number; desconto: number; dias_atraso: number; origem: string; origem_id: string | null;
  plano_conta_id: string | null; plano_conta_nome: string | null; centro_custo_id: string | null; centro_custo_nome: string | null;
  conta_bancaria_id: string | null; conta_nome: string | null; forma_pagamento_id: string | null; forma_nome: string | null;
  observacao: string | null; motivo_cancelamento: string | null; ativo: boolean;
};

export const SITUACAO: Record<Lancamento["situacao"], { rotulo: string; tom: Tom }> = {
  em_aberto: { rotulo: "Em aberto", tom: "neutro" },
  vence_hoje: { rotulo: "Vence hoje", tom: "aviso" },
  atrasado: { rotulo: "Atrasado", tom: "erro" },
  quitado: { rotulo: "Quitado", tom: "ok" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};

const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const num = (v: string | number | null | undefined) => (v === "" || v === null || v === undefined ? 0 : Number(String(v).replace(",", ".")));
const r2 = (v: number) => Math.round(v * 100) / 100;

export function useOpcoesFinanceiro() {
  const [o, setO] = useState<{ contas: Opcao[]; formas: Opcao[]; receitas: Opcao[]; despesas: Opcao[]; centros: Opcao[] }>({ contas: [], formas: [], receitas: [], despesas: [], centros: [] });
  useEffect(() => {
    Promise.all([
      carregarOpcoesRelacao({ tabela: "contas_bancarias", rotulo: "nome" }),
      carregarOpcoesRelacao({ tabela: "formas_pagamento", rotulo: "nome" }),
      carregarOpcoesRelacao({ tabela: "plano_contas", rotulo: "nome", filtro: { tipo: "receita" }, ordem: "codigo" }),
      carregarOpcoesRelacao({ tabela: "plano_contas", rotulo: "nome", filtro: { tipo: "despesa" }, ordem: "codigo" }),
      carregarOpcoesRelacao({ tabela: "centros_custo", rotulo: "nome" }),
    ]).then(([contas, formas, receitas, despesas, centros]) => setO({ contas, formas, receitas, despesas, centros }));
  }, []);
  return o;
}

function SelectOp({ id, valor, ops, onChange, vazio = "—", desab }: { id?: string; valor: string; ops: Opcao[]; onChange: (v: string) => void; vazio?: string; desab?: boolean }) {
  return (
    <Select id={id} value={valor} disabled={desab} onChange={(e) => onChange(e.target.value)}>
      <option value="">{vazio}</option>
      {ops.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
    </Select>
  );
}

// ---------------------------------------------------------------------
/** Baixa de um título (com parcial, juros, multa e desconto) */
export function DialogoBaixa({ lancamento, aoFechar, aoConcluir }: { lancamento: Lancamento | null; aoFechar: () => void; aoConcluir: () => void }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const op = useOpcoesFinanceiro();
  const [f, setF] = useState({ data: hoje(), valor: "", juros: "", multa: "", desconto: "", conta: "", forma: "", obs: "" });
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (lancamento) setF({ data: hoje(), valor: String(Number(lancamento.valor)), juros: "", multa: "", desconto: "", conta: lancamento.conta_bancaria_id ?? "", forma: lancamento.forma_pagamento_id ?? "", obs: "" });
  }, [lancamento]);
  useEffect(() => { if (lancamento && !f.conta && op.contas.length) setF((x) => ({ ...x, conta: op.contas[0].valor })); }, [op.contas, lancamento, f.conta]);

  if (!lancamento) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar} />;
  const principal = r2(num(f.valor) - num(f.juros) - num(f.multa) + num(f.desconto));
  const saldo = r2(Number(lancamento.valor) - principal);
  const verbo = lancamento.tipo === "receber" ? "Recebido" : "Pago";

  async function baixar() {
    if (!f.conta) return toast.error("Escolha a conta");
    setOcupado(true);
    const { data, error } = await supabase.rpc("lancamento_baixar", {
      p_lancamento: lancamento!.id, p_data: f.data, p_valor_pago: num(f.valor), p_conta: f.conta,
      p_juros: num(f.juros), p_multa: num(f.multa), p_desconto: num(f.desconto), p_forma: f.forma || null, p_observacao: f.obs || null,
    });
    setOcupado(false);
    if (error) return toast.error("Não foi possível dar baixa", { description: mensagemErro(error), duration: 10000 });
    const s = Number((data as { saldo: number }).saldo);
    toast.success(s > 0 ? `Baixa parcial. Saldo de ${formatarMoeda(s)} ficou em aberto.` : "Baixa registrada");
    aoConcluir();
    aoFechar();
  }

  return (
    <Dialogo aberto titulo={lancamento.tipo === "receber" ? "Receber" : "Pagar"} descricao={`${lancamento.descricao} · ${lancamento.pessoa_fantasia || lancamento.pessoa_nome || "sem pessoa"}`} aoFechar={aoFechar}
      rodape={<><Button onClick={aoFechar}>Voltar</Button><Button variante="primario" disabled={ocupado} onClick={baixar}>{ocupado ? "Salvando..." : "Confirmar baixa"}</Button></>}>
      <div className="mb-3 flex justify-between rounded-md bg-surface-2/60 p-3 text-sm">
        <span>Vencimento {formatarData(lancamento.data_vencimento)}{lancamento.dias_atraso > 0 && <span className="text-bad"> · {lancamento.dias_atraso} dias de atraso</span>}</span>
        <span className="tabular font-semibold">{formatarMoeda(lancamento.valor)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label obrigatorio htmlFor="b-data">Data do pagamento</Label><Input id="b-data" type="date" max={hoje()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
        <div><Label obrigatorio htmlFor="b-valor">Valor {verbo.toLowerCase()} (R$)</Label><Input id="b-valor" type="number" step="0.01" min="0" className="tabular text-right" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></div>
        <div><Label htmlFor="b-juros">Juros (R$)</Label><Input id="b-juros" type="number" step="0.01" min="0" className="tabular text-right" value={f.juros} onChange={(e) => setF({ ...f, juros: e.target.value })} /></div>
        <div><Label htmlFor="b-multa">Multa (R$)</Label><Input id="b-multa" type="number" step="0.01" min="0" className="tabular text-right" value={f.multa} onChange={(e) => setF({ ...f, multa: e.target.value })} /></div>
        <div><Label htmlFor="b-desc">Desconto (R$)</Label><Input id="b-desc" type="number" step="0.01" min="0" className="tabular text-right" value={f.desconto} onChange={(e) => setF({ ...f, desconto: e.target.value })} /></div>
        <div><Label obrigatorio htmlFor="b-conta">Conta</Label><SelectOp id="b-conta" valor={f.conta} ops={op.contas} vazio="Selecione..." onChange={(v) => setF({ ...f, conta: v })} /></div>
        <div className="col-span-2"><Label htmlFor="b-forma">Forma de pagamento</Label><SelectOp id="b-forma" valor={f.forma} ops={op.formas} onChange={(v) => setF({ ...f, forma: v })} /></div>
        <div className="col-span-2"><Label htmlFor="b-obs">Observação</Label><Input id="b-obs" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></div>
      </div>
      <div className={cn("mt-3 rounded-md border p-3 text-sm", saldo < -0.009 ? "border-bad/40 bg-bad/5" : saldo > 0.009 ? "border-warn/40 bg-warn/5" : "border-line")}>
        {saldo < -0.009 ? <>O valor passa do título em {formatarMoeda(-saldo)}. Lance a diferença como juros ou multa.</>
          : saldo > 0.009 ? <>Baixa parcial: abate {formatarMoeda(principal)} e o saldo de <b>{formatarMoeda(saldo)}</b> vira um novo título com o mesmo vencimento.</>
          : <>Quita o título.</>}
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------
/** Baixa de vários títulos de uma vez, pelo valor de cada um */
export function DialogoBaixaLote({ lancamentos, aoFechar, aoConcluir }: { lancamentos: Lancamento[] | null; aoFechar: () => void; aoConcluir: () => void }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const op = useOpcoesFinanceiro();
  const [f, setF] = useState({ data: hoje(), conta: "", forma: "" });
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (lancamentos) setF({ data: hoje(), conta: "", forma: "" }); }, [lancamentos]);
  if (!lancamentos) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar} />;
  const total = lancamentos.reduce((a, l) => a + Number(l.valor), 0);

  async function baixar() {
    if (!f.conta) return toast.error("Escolha a conta");
    setOcupado(true);
    let ok = 0;
    for (const l of lancamentos!) {
      const { error } = await supabase.rpc("lancamento_baixar", { p_lancamento: l.id, p_data: f.data, p_valor_pago: Number(l.valor), p_conta: f.conta, p_forma: f.forma || null });
      if (error) { toast.error(`${l.descricao}: ${mensagemErro(error)}`); break; }
      ok++;
    }
    setOcupado(false);
    if (ok) toast.success(`${ok} ${ok === 1 ? "título baixado" : "títulos baixados"}`);
    aoConcluir();
    aoFechar();
  }

  return (
    <Dialogo aberto titulo={`Baixar ${lancamentos.length} títulos`} descricao={`Total ${formatarMoeda(total)}, pelo valor de cada título, sem juros nem desconto.`} aoFechar={aoFechar}
      rodape={<><Button onClick={aoFechar}>Voltar</Button><Button variante="primario" disabled={ocupado} onClick={baixar}>{ocupado ? "Baixando..." : "Confirmar baixa"}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div><Label obrigatorio htmlFor="bl-data">Data do pagamento</Label><Input id="bl-data" type="date" max={hoje()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
        <div><Label obrigatorio htmlFor="bl-conta">Conta</Label><SelectOp id="bl-conta" valor={f.conta} ops={op.contas} vazio="Selecione..." onChange={(v) => setF({ ...f, conta: v })} /></div>
        <div className="col-span-2"><Label htmlFor="bl-forma">Forma de pagamento</Label><SelectOp id="bl-forma" valor={f.forma} ops={op.formas} vazio="Manter a de cada título" onChange={(v) => setF({ ...f, forma: v })} /></div>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------
/** Novo lançamento, à vista ou parcelado */
export function DialogoNovo({ tipo, aberto, aoFechar, aoConcluir }: { tipo: "receber" | "pagar"; aberto: boolean; aoFechar: () => void; aoConcluir: () => void }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const op = useOpcoesFinanceiro();
  const vazio = { descricao: "", documento: "", valor: "", parcelas: "1", vencimento: hoje(), intervalo: "30", plano: "", centro: "", forma: "", conta: "", competencia: "", obs: "" };
  const [f, setF] = useState(vazio);
  const [pessoa, setPessoa] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const buscar = useCallback((t: string) => buscarPessoas(supabase, t), [supabase]);
  useEffect(() => { if (aberto) { setF(vazio); setPessoa(null); } }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Math.max(1, Math.min(120, parseInt(f.parcelas || "1", 10) || 1));
  const total = num(f.valor);
  const parcela = r2(total / n);
  const previa = Array.from({ length: Math.min(n, 12) }, (_, i) => {
    const d = new Date(`${f.vencimento}T12:00:00`);
    if (f.intervalo === "30") d.setMonth(d.getMonth() + i); else d.setDate(d.getDate() + i * (parseInt(f.intervalo, 10) || 30));
    // mês mais curto: último dia
    const alvo = new Date(`${f.vencimento}T12:00:00`);
    if (f.intervalo === "30" && d.getDate() !== alvo.getDate()) d.setDate(0);
    return { n: i + 1, data: d.toISOString().slice(0, 10), valor: i < n - 1 ? parcela : r2(total - parcela * (n - 1)) };
  });

  async function salvar() {
    if (!f.descricao.trim()) return toast.error("Informe a descrição");
    if (!(total > 0)) return toast.error("Informe o valor");
    setOcupado(true);
    const { error } = await supabase.rpc("lancamento_criar", {
      p_tipo: tipo, p_descricao: f.descricao, p_valor_total: total, p_primeiro_vencimento: f.vencimento, p_parcelas: n,
      p_intervalo_dias: parseInt(f.intervalo, 10) || 30, p_pessoa: pessoa?.id ?? null, p_documento: f.documento || null,
      p_plano_conta: f.plano || null, p_centro_custo: f.centro || null, p_forma: f.forma || null, p_conta: f.conta || null,
      p_competencia: f.competencia || null, p_observacao: f.obs || null,
    });
    setOcupado(false);
    if (error) return toast.error("Não foi possível lançar", { description: mensagemErro(error) });
    toast.success(n > 1 ? `${n} parcelas lançadas` : "Lançamento criado");
    aoConcluir();
    aoFechar();
  }

  return (
    <Dialogo aberto={aberto} largo titulo={tipo === "receber" ? "Nova conta a receber" : "Nova conta a pagar"} aoFechar={aoFechar}
      rodape={<><Button onClick={aoFechar}>Voltar</Button><Button variante="primario" disabled={ocupado} onClick={salvar}>{ocupado ? "Lançando..." : "Lançar"}</Button></>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-4">
          <Label>{tipo === "receber" ? "Cliente / pagador" : "Fornecedor / favorecido"}</Label>
          <BuscaRegistro buscar={buscar} selecionado={pessoa} aoEscolher={setPessoa} aoLimpar={() => setPessoa(null)} placeholder="Opcional: código, nome ou CNPJ" />
        </div>
        <div className="col-span-2 sm:col-span-3"><Label obrigatorio htmlFor="n-desc">Descrição</Label><Input id="n-desc" autoFocus value={f.descricao} placeholder={tipo === "pagar" ? "Ex.: Energia elétrica outubro" : "Ex.: Venda avulsa"} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
        <div><Label htmlFor="n-doc">Documento</Label><Input id="n-doc" value={f.documento} placeholder="NF, boleto..." onChange={(e) => setF({ ...f, documento: e.target.value })} /></div>
        <div><Label obrigatorio htmlFor="n-valor">Valor total (R$)</Label><Input id="n-valor" type="number" step="0.01" min="0" className="tabular text-right" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></div>
        <div><Label htmlFor="n-parc">Parcelas</Label><Input id="n-parc" type="number" min="1" max="120" className="tabular text-right" value={f.parcelas} onChange={(e) => setF({ ...f, parcelas: e.target.value })} /></div>
        <div><Label obrigatorio htmlFor="n-venc">{n > 1 ? "1º vencimento" : "Vencimento"}</Label><Input id="n-venc" type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} /></div>
        <div>
          <Label htmlFor="n-int">Intervalo</Label>
          <Select id="n-int" value={f.intervalo} disabled={n === 1} onChange={(e) => setF({ ...f, intervalo: e.target.value })}>
            <option value="30">Mensal</option><option value="7">Semanal</option><option value="14">Quinzenal</option><option value="28">28 dias</option>
          </Select>
        </div>
        <div className="col-span-2"><Label htmlFor="n-plano">Plano de contas</Label><SelectOp id="n-plano" valor={f.plano} ops={tipo === "receber" ? op.receitas : op.despesas} onChange={(v) => setF({ ...f, plano: v })} /></div>
        <div className="col-span-2"><Label htmlFor="n-cc">Centro de custo</Label><SelectOp id="n-cc" valor={f.centro} ops={op.centros} onChange={(v) => setF({ ...f, centro: v })} /></div>
        <div className="col-span-2"><Label htmlFor="n-forma">Forma de pagamento</Label><SelectOp id="n-forma" valor={f.forma} ops={op.formas} onChange={(v) => setF({ ...f, forma: v })} /></div>
        <div className="col-span-2"><Label htmlFor="n-conta">Conta prevista</Label><SelectOp id="n-conta" valor={f.conta} ops={op.contas} onChange={(v) => setF({ ...f, conta: v })} /></div>
        <div><Label htmlFor="n-comp">Competência</Label><Input id="n-comp" type="date" value={f.competencia} onChange={(e) => setF({ ...f, competencia: e.target.value })} /></div>
        <div className="col-span-2 sm:col-span-3"><Label htmlFor="n-obs">Observação</Label><Input id="n-obs" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></div>
      </div>
      {n > 1 && total > 0 && (
        <div className="mt-3 rounded-md bg-surface-2/60 p-3 text-xs">
          <div className="mb-1 font-medium">Parcelas</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-3">
            {previa.map((p) => <div key={p.n} className="tabular flex justify-between gap-2"><span>{p.n}. {formatarData(p.data)}</span><span>{formatarMoeda(p.valor)}</span></div>)}
            {n > 12 && <div className="text-muted">… mais {n - 12}</div>}
          </div>
        </div>
      )}
    </Dialogo>
  );
}

// ---------------------------------------------------------------------
/** Detalhe do lançamento: editar, estornar, cancelar */
export function DialogoDetalhe({ lancamento, podeEditar, aoFechar, aoConcluir, aoBaixar }: {
  lancamento: Lancamento | null; podeEditar: boolean; aoFechar: () => void; aoConcluir: () => void; aoBaixar: (l: Lancamento) => void;
}) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const op = useOpcoesFinanceiro();
  const [f, setF] = useState({ descricao: "", documento: "", vencimento: "", valor: "", plano: "", centro: "", forma: "", conta: "", obs: "" });
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!lancamento) return;
    const l = lancamento;
    setF({ descricao: l.descricao, documento: l.documento ?? "", vencimento: l.data_vencimento, valor: String(Number(l.valor)), plano: l.plano_conta_id ?? "",
      centro: l.centro_custo_id ?? "", forma: l.forma_pagamento_id ?? "", conta: l.conta_bancaria_id ?? "", obs: l.observacao ?? "" });
    setCancelando(false); setMotivo("");
  }, [lancamento]);

  if (!lancamento) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar} />;
  const l = lancamento;
  const aberto = l.ativo && !l.data_quitacao;
  const editavel = podeEditar && l.ativo;
  const st = SITUACAO[l.situacao];

  async function acao(fn: () => PromiseLike<{ error: { message?: string } | null }>, ok: string) {
    setOcupado(true);
    const { error } = await fn();
    setOcupado(false);
    if (error) return toast.error("Não foi possível concluir", { description: mensagemErro(error), duration: 10000 });
    toast.success(ok);
    aoConcluir();
    aoFechar();
  }

  const salvar = () => acao(() => supabase.from("lancamentos").update({
    descricao: f.descricao, documento: f.documento || null, observacao: f.obs || null, plano_conta_id: f.plano || null, centro_custo_id: f.centro || null,
    ...(aberto ? { data_vencimento: f.vencimento, forma_pagamento_id: f.forma || null, conta_bancaria_id: f.conta || null } : {}),
    ...(aberto && l.origem !== "pedido" ? { valor: num(f.valor) } : {}),
  }).eq("id", l.id), "Lançamento salvo");

  return (
    <Dialogo aberto largo titulo={l.descricao} descricao={[l.pessoa_codigo ? `${l.pessoa_codigo} · ${l.pessoa_fantasia || l.pessoa_nome}` : null, l.origem === "pedido" ? "gerado pelo pedido" : null].filter(Boolean).join(" · ") || undefined}
      aoFechar={aoFechar}
      rodape={cancelando ? <>
        <Button onClick={() => setCancelando(false)}>Voltar</Button>
        <Button variante="perigo" disabled={ocupado || !motivo.trim()} onClick={() => acao(() => supabase.rpc("lancamento_cancelar", { p_lancamento: l.id, p_motivo: motivo }), "Lançamento cancelado")}>Confirmar cancelamento</Button>
      </> : <>
        {editavel && aberto && <Button variante="perigo" className="mr-auto" onClick={() => setCancelando(true)}>Cancelar lançamento</Button>}
        {editavel && l.data_quitacao && <Button variante="perigo" className="mr-auto" disabled={ocupado} onClick={() => acao(() => supabase.rpc("lancamento_estornar", { p_lancamento: l.id }), "Baixa estornada")}>Estornar baixa</Button>}
        <Button onClick={aoFechar}>Fechar</Button>
        {editavel && <Button disabled={ocupado} onClick={salvar}>Salvar</Button>}
        {editavel && aberto && <Button variante="primario" onClick={() => aoBaixar(l)}>{l.tipo === "receber" ? "Receber" : "Pagar"}</Button>}
      </>}>
      {cancelando ? (
        <div><Label obrigatorio htmlFor="d-mot">Motivo do cancelamento</Label><Textarea id="d-mot" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tom={st.tom}>{st.rotulo}</Badge>
            <span className="text-muted">{l.tipo === "receber" ? "A receber" : "A pagar"} · parcela {l.parcela}/{l.total_parcelas} · competência {formatarData(l.data_competencia)}</span>
          </div>
          {l.data_quitacao && (
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-md bg-ok/5 p-3 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-muted">Pago em</div>{formatarData(l.data_quitacao)}</div>
              <div><div className="text-xs text-muted">Valor pago</div><span className="tabular font-medium">{formatarMoeda(l.valor_pago)}</span></div>
              <div><div className="text-xs text-muted">Juros + multa</div><span className="tabular">{formatarMoeda(Number(l.juros) + Number(l.multa))}</span></div>
              <div><div className="text-xs text-muted">Desconto</div><span className="tabular">{formatarMoeda(l.desconto)}</span></div>
            </div>
          )}
          {l.motivo_cancelamento && <p className="mb-3 text-sm text-muted">Cancelado: {l.motivo_cancelamento}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-3"><Label htmlFor="d-desc">Descrição</Label><Input id="d-desc" disabled={!editavel} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
            <div><Label htmlFor="d-doc">Documento</Label><Input id="d-doc" disabled={!editavel} value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} /></div>
            <div><Label htmlFor="d-valor">Valor (R$)</Label><Input id="d-valor" type="number" step="0.01" className="tabular text-right" disabled={!editavel || !aberto || l.origem === "pedido"} value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></div>
            <div><Label htmlFor="d-venc">Vencimento</Label><Input id="d-venc" type="date" disabled={!editavel || !aberto} value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} /></div>
            <div className="col-span-2"><Label htmlFor="d-forma">Forma</Label><SelectOp id="d-forma" desab={!editavel || !aberto} valor={f.forma} ops={op.formas} onChange={(v) => setF({ ...f, forma: v })} /></div>
            <div className="col-span-2"><Label htmlFor="d-plano">Plano de contas</Label><SelectOp id="d-plano" desab={!editavel} valor={f.plano} ops={l.tipo === "receber" ? op.receitas : op.despesas} onChange={(v) => setF({ ...f, plano: v })} /></div>
            <div><Label htmlFor="d-cc">Centro de custo</Label><SelectOp id="d-cc" desab={!editavel} valor={f.centro} ops={op.centros} onChange={(v) => setF({ ...f, centro: v })} /></div>
            <div><Label htmlFor="d-conta">Conta</Label><SelectOp id="d-conta" desab={!editavel || !aberto} valor={f.conta} ops={op.contas} onChange={(v) => setF({ ...f, conta: v })} /></div>
            <div className="col-span-2 sm:col-span-4"><Label htmlFor="d-obs">Observação</Label><Textarea id="d-obs" className="min-h-16" disabled={!editavel} value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></div>
          </div>
        </>
      )}
    </Dialogo>
  );
}
