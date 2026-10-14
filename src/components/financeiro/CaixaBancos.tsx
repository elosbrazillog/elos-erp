"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Cabecalho, Card, Input, Vazio } from "@/components/ui";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";
import { exportarExcel } from "@/components/crud/exportar";

type Conta = { id: string; nome: string; banco_codigo: string | null; saldo_inicial: number; data_saldo_inicial: string; entradas: number; saidas: number; saldo_atual: number; ativo: boolean };
type Mov = { id: string; conta_bancaria_id: string; data: string; tipo: string; descricao: string; documento: string | null; pessoa_nome: string | null; pessoa_fantasia: string | null;
  plano_conta_nome: string | null; forma_nome: string | null; valor_sinal: number };

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** Saldo de cada conta e extrato com saldo acumulado */
export function CaixaBancos() {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [conta, setConta] = useState<string | null>(null);
  const [movs, setMovs] = useState<Mov[]>([]);
  const h = new Date();
  const [de, setDe] = useState(local(new Date(h.getFullYear(), h.getMonth(), 1)));
  const [ate, setAte] = useState(local(h));

  useEffect(() => {
    supabase.from("vw_contas_saldos").select("*").eq("ativo", true).order("nome").then(({ data, error }) => {
      if (error) return toast.error("Não foi possível carregar as contas", { description: mensagemErro(error) });
      const cs = (data ?? []) as Conta[];
      setContas(cs);
      setConta((c) => c ?? cs[0]?.id ?? null);
    });
  }, [supabase]);

  useEffect(() => {
    if (!conta) return;
    supabase.from("vw_extrato").select("*").eq("conta_bancaria_id", conta).order("data").order("descricao").limit(10000)
      .then(({ data }) => setMovs((data ?? []) as Mov[]));
  }, [supabase, conta]);

  const c = contas?.find((x) => x.id === conta);
  // saldo acumulado desde o saldo inicial; mostra só o período
  let acumulado = Number(c?.saldo_inicial ?? 0);
  const comSaldo = movs.map((m) => { acumulado += Number(m.valor_sinal); return { ...m, saldo: acumulado }; });
  const anteriores = comSaldo.filter((m) => m.data < de);
  const saldoAnterior = anteriores.length ? anteriores[anteriores.length - 1].saldo : Number(c?.saldo_inicial ?? 0);
  const doPeriodo = comSaldo.filter((m) => m.data >= de && m.data <= ate);
  const entradas = doPeriodo.filter((m) => m.valor_sinal > 0).reduce((a, m) => a + Number(m.valor_sinal), 0);
  const saidas = doPeriodo.filter((m) => m.valor_sinal < 0).reduce((a, m) => a - Number(m.valor_sinal), 0);

  async function exportar() {
    await exportarExcel(`Extrato ${c?.nome ?? ""}`, ["Data", "Descrição", "Documento", "Pessoa", "Plano de contas", "Forma", "Valor", "Saldo"],
      doPeriodo.map((m) => [formatarData(m.data), m.descricao, m.documento ?? "", m.pessoa_fantasia || m.pessoa_nome || "", m.plano_conta_nome ?? "", m.forma_nome ?? "", Number(m.valor_sinal), Number(m.saldo)]));
  }

  return (
    <>
      <Cabecalho trilha="Financeiro" titulo="Caixa e bancos" acoes={<Link href="/cadastros/contas-bancarias"><Button>Cadastro de contas</Button></Link>} />
      {contas === null && <div className="py-10 text-center text-sm text-muted">Carregando...</div>}
      {contas?.length === 0 && <Card><Vazio titulo="Nenhuma conta cadastrada" acao={<Link href="/cadastros/contas-bancarias/novo"><Button>Cadastrar conta</Button></Link>} /></Card>}
      {contas && contas.length > 0 && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {contas.map((x) => (
              <button key={x.id} onClick={() => setConta(x.id)}
                className={cn("rounded-lg border bg-surface p-4 text-left transition-colors", x.id === conta ? "border-accent ring-1 ring-accent" : "border-line hover:border-accent")}>
                <div className="text-xs text-muted">{x.nome}</div>
                <div className={cn("tabular mt-1 text-xl font-semibold", Number(x.saldo_atual) < 0 && "text-bad")}>{formatarMoeda(x.saldo_atual)}</div>
                <div className="tabular mt-1 text-xs text-muted">+{formatarMoeda(x.entradas)} · −{formatarMoeda(x.saidas)}</div>
              </button>
            ))}
            <div className="rounded-lg border border-dashed border-line p-4">
              <div className="text-xs text-muted">Total em contas</div>
              <div className="tabular mt-1 text-xl font-semibold">{formatarMoeda(contas.reduce((a, x) => a + Number(x.saldo_atual), 0))}</div>
            </div>
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <span className="mr-auto text-sm font-medium">Extrato · {c?.nome}</span>
              <label className="flex items-center gap-1.5 text-xs text-muted">De <Input type="date" className="w-auto" value={de} onChange={(e) => setDe(e.target.value)} /></label>
              <label className="flex items-center gap-1.5 text-xs text-muted">Até <Input type="date" className="w-auto" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
              <Button onClick={exportar}><Download size={16} /> Excel</Button>
            </div>
            <div className="grid grid-cols-2 gap-2 border-b border-line px-3 py-2 text-xs sm:grid-cols-4">
              <div><span className="text-muted">Saldo anterior </span><span className="tabular font-medium">{formatarMoeda(saldoAnterior)}</span></div>
              <div><span className="text-muted">Entradas </span><span className="tabular font-medium text-ok">{formatarMoeda(entradas)}</span></div>
              <div><span className="text-muted">Saídas </span><span className="tabular font-medium text-bad">{formatarMoeda(saidas)}</span></div>
              <div><span className="text-muted">Saldo no fim </span><span className="tabular font-medium">{formatarMoeda(saldoAnterior + entradas - saidas)}</span></div>
            </div>
            {doPeriodo.length === 0 ? <Vazio titulo="Nada entrou ou saiu desta conta no período" texto="As baixas de contas a receber e a pagar aparecem aqui." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Descrição</th>
                      <th className="hidden px-3 py-2 font-medium md:table-cell">Pessoa</th>
                      <th className="hidden px-3 py-2 font-medium lg:table-cell">Plano de contas</th>
                      <th className="px-3 py-2 text-right font-medium">Valor</th>
                      <th className="px-3 py-2 text-right font-medium">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doPeriodo.map((m) => (
                      <tr key={m.id} className="border-b border-line/70">
                        <td className="px-3 py-2 whitespace-nowrap">{formatarData(m.data)}</td>
                        <td className="max-w-72 px-3 py-2"><div className="truncate">{m.descricao}</div>{m.forma_nome && <div className="text-xs text-muted">{m.forma_nome}</div>}</td>
                        <td className="hidden max-w-56 truncate px-3 py-2 md:table-cell">{m.pessoa_fantasia || m.pessoa_nome || "—"}</td>
                        <td className="hidden px-3 py-2 text-muted lg:table-cell">{m.plano_conta_nome ?? "—"}</td>
                        <td className={cn("tabular px-3 py-2 text-right font-medium whitespace-nowrap", Number(m.valor_sinal) < 0 ? "text-bad" : "text-ok")}>
                          {Number(m.valor_sinal) < 0 ? "−" : "+"}{formatarMoeda(Math.abs(Number(m.valor_sinal)))}
                        </td>
                        <td className={cn("tabular px-3 py-2 text-right whitespace-nowrap", m.saldo < 0 && "text-bad")}>{formatarMoeda(m.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {c && <p className="mt-2 text-xs text-muted">Saldo inicial de {formatarMoeda(c.saldo_inicial)} em {formatarData(c.data_saldo_inicial)}. Ajuste no cadastro da conta.</p>}
        </>
      )}
    </>
  );
}
