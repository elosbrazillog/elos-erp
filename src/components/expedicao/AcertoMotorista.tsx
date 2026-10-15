"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Plus, Printer, Trash2, Undo2, Wallet } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Textarea, Vazio } from "@/components/ui";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { STATUS_ENTREGA, mensagemErro } from "@/lib/pedidos";

type PedidoAcerto = { ordem: number; numero: number; cliente: string; valor: number; forma: string | null; recebe: string | null; status: string; dinheiro: number; pix: number; cartao: number };
export type Resumo = {
  carga: { id: string; numero: number; data: string; status: string; motorista: string | null };
  pendentes: number; entregues: number; nao_entregues: number;
  previsto_dinheiro: number; previsto_pix: number; previsto_cartao: number; a_prazo: number;
  recebido_dinheiro: number; recebido_pix: number; recebido_cartao: number; valor_devolvido: number;
  pedidos: PedidoAcerto[];
  acerto: {
    dinheiro_esperado: number; pix_recebido: number; cartao_recebido: number; dinheiro_entregue: number; despesas: { descricao: string; valor: number }[];
    total_despesas: number; diferenca: number; observacao: string | null; titulos_baixados: number; criado_em: string;
  } | null;
};
type Conta = { id: string; nome: string; emite_boleto: boolean };
type Despesa = { descricao: string; texto: string };

const lerValor = (t: string) => { const s = t.trim().replace(/\./g, "").replace(",", "."); const n = Number(s); return s && Number.isFinite(n) ? n : 0; };
const SUGESTOES = ["Combustível", "Pedágio", "Alimentação", "Ajudante", "Estacionamento"];

export function AcertoMotorista({ id, podeEditar, podeBaixar }: { id: string; podeEditar: boolean; podeBaixar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState(false);
  const [contas, setContas] = useState<Conta[]>([]);
  const [entregue, setEntregue] = useState("");
  const [despesas, setDespesas] = useState<Despesa[]>([]);
  const [obs, setObs] = useState("");
  const [baixar, setBaixar] = useState(podeBaixar);
  const [contaDinheiro, setContaDinheiro] = useState("");
  const [contaPix, setContaPix] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("acerto_resumo", { p_expedicao: id });
    if (error) { setErro(true); return toast.error("Não foi possível carregar", { description: mensagemErro(error) }); }
    const x = data as Resumo;
    setR(x);
    setEntregue((v) => v || Number(x.recebido_dinheiro).toFixed(2).replace(".", ","));
  }, [supabase, id]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!podeBaixar) return;
    supabase.from("contas_bancarias").select("id, nome, emite_boleto").eq("ativo", true).order("nome").then(({ data }) => {
      const cs = (data ?? []) as Conta[];
      setContas(cs);
      setContaDinheiro((v) => v || cs.find((c) => /caixa/i.test(c.nome))?.id || cs[0]?.id || "");
      setContaPix((v) => v || cs.find((c) => !/caixa/i.test(c.nome))?.id || cs[0]?.id || "");
    });
  }, [supabase, podeBaixar]);

  if (erro) return <Card><Vazio titulo="Carga não encontrada" acao={<Link href="/expedicao/cargas"><Button>Voltar</Button></Link>} /></Card>;
  if (!r) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;

  const esperado = Number(r.recebido_dinheiro);
  const totalDesp = despesas.reduce((a, d) => a + lerValor(d.texto), 0);
  const dif = Math.round((lerValor(entregue) + totalDesp - esperado) * 100) / 100;
  const a = r.acerto;
  const concluida = r.carga.status === "concluida";

  async function salvar() {
    if (despesas.some((d) => !d.descricao.trim() || lerValor(d.texto) <= 0)) return toast.error("Preencha descrição e valor de cada despesa");
    if (Math.abs(dif) > 0.009 && !obs.trim()) return toast.error("Há diferença no acerto: explique na observação");
    setSalvando(true);
    const { error } = await supabase.rpc("acerto_registrar", {
      p_expedicao: id, p_dinheiro_entregue: lerValor(entregue),
      p_despesas: despesas.map((d) => ({ descricao: d.descricao.trim(), valor: Math.round(lerValor(d.texto) * 100) / 100 })),
      p_observacao: obs || null, p_baixar: baixar, p_conta_dinheiro: baixar ? contaDinheiro || null : null, p_conta_pix: baixar ? contaPix || null : null,
    });
    setSalvando(false);
    if (error) return toast.error("Não foi possível registrar o acerto", { description: mensagemErro(error), duration: 10000 });
    toast.success("Acerto registrado");
    carregar();
  }

  async function excluir() {
    if (!confirm("Desfazer este acerto?")) return;
    const { error } = await supabase.rpc("acerto_excluir", { p_expedicao: id });
    if (error) return toast.error("Não foi possível desfazer", { description: mensagemErro(error) });
    toast.success("Acerto desfeito");
    carregar();
  }

  return (
    <>
      <Cabecalho trilha={`Expedição · Carga ${r.carga.numero}`} titulo="Acerto do motorista"
        acoes={<>
          <Link href={`/expedicao/cargas/${id}`}><Button><ArrowLeft size={16} /> Carga</Button></Link>
          {a && <a href={`/imprimir/acerto/${id}`} target="_blank" rel="noreferrer"><Button><Printer size={16} /> Imprimir</Button></a>}
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{r.carga.motorista ?? "Sem motorista"} · saída {formatarData(r.carga.data)}</span>
        <span>· {r.entregues} entregues · {r.nao_entregues} não entregues{r.pendentes ? ` · ${r.pendentes} pendentes` : ""}</span>
        {a ? <Badge tom="ok">Acerto feito</Badge> : concluida ? <Badge tom="aviso">Aguardando acerto</Badge> : <Badge>Carga ainda em rota</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <div className="border-b border-line px-3 py-2 text-sm font-medium">Entregas e recebimentos</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th><th className="px-2 py-2 font-medium">Cliente</th><th className="px-2 py-2 font-medium">Forma</th>
                  <th className="px-2 py-2 text-right font-medium">Valor</th><th className="px-2 py-2 text-right font-medium">Dinheiro</th>
                  <th className="px-2 py-2 text-right font-medium">PIX</th><th className="px-2 py-2 text-right font-medium">Cartão</th><th className="px-2 py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {r.pedidos.map((p) => {
                  const st = STATUS_ENTREGA[p.status] ?? { rotulo: p.status, tom: "neutro" as const };
                  const z = (v: number) => (Number(v) ? formatarMoeda(v) : <span className="text-muted/40">—</span>);
                  return (
                    <tr key={p.numero}>
                      <td className="tabular px-3 py-2 text-muted">{p.ordem}</td>
                      <td className="max-w-56 px-2 py-2"><div className="truncate">{p.cliente}</div><div className="text-xs text-muted">pedido {p.numero}</div></td>
                      <td className="px-2 py-2 text-xs">{p.forma ?? "—"}{!p.recebe && <div className="text-muted">não recebe</div>}</td>
                      <td className="tabular px-2 py-2 text-right">{formatarMoeda(p.valor)}</td>
                      <td className="tabular px-2 py-2 text-right">{z(p.dinheiro)}</td>
                      <td className="tabular px-2 py-2 text-right">{z(p.pix)}</td>
                      <td className="tabular px-2 py-2 text-right">{z(p.cartao)}</td>
                      <td className="px-2 py-2"><Badge tom={st.tom}>{st.rotulo}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-line font-medium">
                <tr>
                  <td colSpan={4} className="px-3 py-2">Recebido</td>
                  <td className="tabular px-2 py-2 text-right">{formatarMoeda(r.recebido_dinheiro)}</td>
                  <td className="tabular px-2 py-2 text-right">{formatarMoeda(r.recebido_pix)}</td>
                  <td className="tabular px-2 py-2 text-right">{formatarMoeda(r.recebido_cartao)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-muted sm:grid-cols-4">
            <span>Previsto em dinheiro <b className="tabular text-ink">{formatarMoeda(r.previsto_dinheiro)}</b></span>
            <span>Previsto PIX <b className="tabular text-ink">{formatarMoeda(r.previsto_pix)}</b></span>
            <span>A prazo / boleto <b className="tabular text-ink">{formatarMoeda(r.a_prazo)}</b></span>
            <span>Voltou (não entregue) <b className="tabular text-ink">{formatarMoeda(r.valor_devolvido)}</b></span>
          </div>
        </Card>

        <Card className="p-4">
          {a ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 font-medium"><Wallet size={16} /> Acerto de {formatarData(a.criado_em)}</div>
              <Linha r="Dinheiro recebido nas entregas" v={a.dinheiro_esperado} />
              <Linha r="Despesas do motorista" v={a.total_despesas} />
              {a.despesas.map((d, i) => <Linha key={i} r={`· ${d.descricao}`} v={d.valor} fraco />)}
              <Linha r="Dinheiro entregue" v={a.dinheiro_entregue} forte />
              <div className={cn("flex justify-between rounded p-2 font-semibold", Math.abs(Number(a.diferenca)) < 0.01 ? "bg-ok/10 text-ok" : Number(a.diferenca) < 0 ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn")}>
                <span>{Math.abs(Number(a.diferenca)) < 0.01 ? "Acerto fechado" : Number(a.diferenca) < 0 ? "Faltou" : "Sobrou"}</span>
                <span className="tabular">{formatarMoeda(Math.abs(Number(a.diferenca)))}</span>
              </div>
              <Linha r="PIX recebido" v={a.pix_recebido} fraco />
              <Linha r="Cartão recebido" v={a.cartao_recebido} fraco />
              {a.observacao && <p className="text-xs text-muted">Obs.: {a.observacao}</p>}
              <p className="text-xs text-muted">{a.titulos_baixados ? `${a.titulos_baixados} título(s) baixados no financeiro.` : "Títulos não baixados no financeiro."}</p>
              {podeEditar && !a.titulos_baixados && <Button tamanho="p" variante="fantasma" onClick={excluir}><Undo2 size={14} /> Desfazer acerto</Button>}
            </div>
          ) : !concluida ? (
            <p className="text-sm text-muted">O acerto fica disponível quando todas as entregas da carga forem registradas. Até lá, a tabela mostra o que já foi recebido.</p>
          ) : !podeEditar ? (
            <p className="text-sm text-muted">Aguardando o acerto pelo escritório.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between"><span>Dinheiro que deve voltar</span><b className="tabular text-lg">{formatarMoeda(esperado)}</b></div>
              <div>
                <Label htmlFor="ac-entregue" obrigatorio>Dinheiro entregue pelo motorista</Label>
                <Input id="ac-entregue" inputMode="decimal" className="tabular h-11 text-right text-base" value={entregue} onChange={(e) => setEntregue(e.target.value)} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between"><Label>Despesas pagas com o dinheiro</Label>
                  <Button tamanho="p" variante="fantasma" onClick={() => setDespesas((d) => [...d, { descricao: "", texto: "" }])}><Plus size={14} /> Despesa</Button></div>
                {despesas.map((d, i) => (
                  <div key={i} className="mb-1.5 grid grid-cols-[1fr_6.5rem_auto] gap-1.5">
                    <Input list="sug-despesas" value={d.descricao} placeholder="Descrição" aria-label={`Descrição da despesa ${i + 1}`}
                      onChange={(e) => setDespesas((ds) => ds.map((x, k) => (k === i ? { ...x, descricao: e.target.value } : x)))} />
                    <Input inputMode="decimal" className="tabular text-right" value={d.texto} placeholder="0,00" aria-label={`Valor da despesa ${i + 1}`}
                      onChange={(e) => setDespesas((ds) => ds.map((x, k) => (k === i ? { ...x, texto: e.target.value } : x)))} />
                    <button className="rounded p-1 text-muted hover:text-bad" onClick={() => setDespesas((ds) => ds.filter((_, k) => k !== i))} aria-label="Tirar despesa"><Trash2 size={14} /></button>
                  </div>
                ))}
                <datalist id="sug-despesas">{SUGESTOES.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div className={cn("flex justify-between rounded p-2 font-semibold", Math.abs(dif) < 0.01 ? "bg-ok/10 text-ok" : dif < 0 ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn")}>
                <span>{Math.abs(dif) < 0.01 ? "Fecha certinho" : dif < 0 ? "Faltando" : "Sobrando"}</span>
                <span className="tabular">{formatarMoeda(Math.abs(dif))}</span>
              </div>
              <div><Label htmlFor="ac-obs" obrigatorio={Math.abs(dif) >= 0.01}>Observação</Label><Textarea id="ac-obs" className="min-h-14" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
              {podeBaixar && (
                <div className="space-y-2 rounded border border-line p-2.5">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={baixar} onChange={(e) => setBaixar(e.target.checked)} />
                    <span>Baixar no financeiro os títulos pagos na entrega<span className="block text-xs text-muted">Dinheiro entra no caixa e PIX/cartão na conta escolhida.</span></span>
                  </label>
                  {baixar && (
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label htmlFor="ac-cdin">Dinheiro entra em</Label>
                        <Select id="ac-cdin" value={contaDinheiro} onChange={(e) => setContaDinheiro(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></div>
                      <div><Label htmlFor="ac-cpix">PIX e cartão entram em</Label>
                        <Select id="ac-cpix" value={contaPix} onChange={(e) => setContaPix(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></div>
                    </div>
                  )}
                </div>
              )}
              <Button variante="primario" className="h-11 w-full" disabled={salvando} onClick={salvar}><Wallet size={16} /> {salvando ? "Registrando..." : "Registrar acerto"}</Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Linha({ r, v, forte, fraco }: { r: string; v: number; forte?: boolean; fraco?: boolean }) {
  return (
    <div className={cn("flex justify-between", forte && "font-semibold", fraco && "text-xs text-muted")}>
      <span>{r}</span><span className="tabular">{formatarMoeda(v)}</span>
    </div>
  );
}
