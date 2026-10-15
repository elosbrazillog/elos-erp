"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { BuscaRegistro, type Resultado } from "@/components/ui/BuscaRegistro";
import { carregarOpcoesRelacao } from "@/components/crud/CampoInput";
import { cn, formatarData, formatarNumero, dataLocal } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";
import type { Opcao } from "@/lib/entidades";

type ProdutoSimples = { id: string; codigo: string; nome: string; controla_lote: boolean; custo: number; validade_dias: number | null };

export function useDepositos() {
  const [depositos, setDepositos] = useState<Opcao[]>([]);
  const [padrao, setPadrao] = useState("");
  useEffect(() => {
    carregarOpcoesRelacao({ tabela: "depositos", rotulo: "nome" }).then(setDepositos);
    criarClienteNavegador().from("depositos").select("id").eq("padrao", true).eq("ativo", true).limit(1).maybeSingle()
      .then(({ data }) => data && setPadrao(data.id));
  }, []);
  return { depositos, padrao };
}

const somarDias = (d: number) => dataLocal(d);
const num = (v: string) => Number(String(v).replace(",", "."));

/** Entrada de mercadoria com lote e validade */
export function DialogoEntrada({ aberto, aoFechar, aoConcluir, produtoInicial }: {
  aberto: boolean; aoFechar: () => void; aoConcluir: () => void; produtoInicial?: string;
}) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const { depositos, padrao } = useDepositos();
  const [produtos, setProdutos] = useState<ProdutoSimples[]>([]);
  const [produto, setProduto] = useState<ProdutoSimples | null>(null);
  const [f, setF] = useState({ deposito: "", quantidade: "", lote: "", validade: "", fabricacao: "", custo: "", observacao: "" });
  const [salvando, setSalvando] = useState(false);
  const [continuar, setContinuar] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    supabase.from("produtos").select("id, codigo, nome, controla_lote, custo, validade_dias").eq("ativo", true).order("nome").limit(2000)
      .then(({ data }) => {
        const ps = (data ?? []) as ProdutoSimples[];
        setProdutos(ps);
        if (produtoInicial) escolher(ps.find((p) => p.id === produtoInicial) ?? null);
      });
  }, [aberto, supabase, produtoInicial]);

  useEffect(() => { if (padrao && !f.deposito) setF((x) => ({ ...x, deposito: padrao })); }, [padrao, f.deposito]);

  function escolher(p: ProdutoSimples | null) {
    setProduto(p);
    if (p) setF((x) => ({ ...x, custo: p.custo ? String(Number(p.custo)) : "", validade: x.validade || (p.validade_dias ? somarDias(p.validade_dias) : "") }));
  }

  const buscar = useCallback(async (t: string): Promise<Resultado[]> => {
    const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const partes = n(t).split(/\s+/).filter(Boolean);
    return produtos.filter((p) => partes.every((x) => n(`${p.codigo} ${p.nome}`).includes(x))).slice(0, 30)
      .map((p) => ({ id: p.id, rotulo: `${p.codigo} · ${p.nome}` }));
  }, [produtos]);

  async function salvar() {
    if (!produto) return toast.error("Escolha o produto");
    if (!(num(f.quantidade) > 0)) return toast.error("Informe a quantidade");
    if (produto.controla_lote && !f.validade && !f.lote) return toast.error("Informe a validade do lote");
    setSalvando(true);
    const { error } = await supabase.rpc("estoque_entrada", {
      p_produto: produto.id, p_deposito: f.deposito, p_quantidade: num(f.quantidade),
      p_lote: f.lote || null, p_validade: f.validade || null, p_fabricacao: f.fabricacao || null,
      p_custo: f.custo ? num(f.custo) : null, p_observacao: f.observacao || null,
    });
    setSalvando(false);
    if (error) return toast.error("Não foi possível lançar", { description: mensagemErro(error), duration: 8000 });
    toast.success(`Entrada de ${formatarNumero(num(f.quantidade))} ${produto.nome}`);
    aoConcluir();
    if (continuar && !produtoInicial) {
      setProduto(null);
      setF((x) => ({ ...x, quantidade: "", lote: "", validade: "", fabricacao: "", custo: "" }));
      setTimeout(() => document.getElementById("entrada-produto")?.focus(), 50);
    } else aoFechar();
  }

  return (
    <Dialogo
      aberto={aberto}
      titulo="Entrada de mercadoria"
      descricao="Cada entrada fica ligada a um lote com validade."
      aoFechar={aoFechar}
      rodape={<>
        {!produtoInicial && (
          <label className="mr-auto flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="accent-[var(--accent)]" checked={continuar} onChange={(e) => setContinuar(e.target.checked)} /> Lançar outra em seguida
          </label>
        )}
        <Button onClick={aoFechar}>Fechar</Button>
        <Button variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Lançando..." : "Lançar entrada"}</Button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label obrigatorio htmlFor="entrada-produto">Produto</Label>
          <BuscaRegistro id="entrada-produto" autoFocus buscar={buscar}
            selecionado={produto ? { id: produto.id, rotulo: `${produto.codigo} · ${produto.nome}` } : null}
            aoEscolher={(r) => escolher(produtos.find((p) => p.id === r.id) ?? null)}
            aoLimpar={produtoInicial ? undefined : () => setProduto(null)} placeholder="Código ou nome" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label obrigatorio htmlFor="entrada-dep">Depósito</Label>
          <Select id="entrada-dep" value={f.deposito} onChange={(e) => setF({ ...f, deposito: e.target.value })}>
            {depositos.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
          </Select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label obrigatorio htmlFor="entrada-qtd">Quantidade</Label>
          <Input id="entrada-qtd" type="number" min="0" step="any" inputMode="decimal" className="tabular text-right" value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="entrada-lote">Lote</Label>
          <Input id="entrada-lote" value={f.lote} placeholder="Opcional" onChange={(e) => setF({ ...f, lote: e.target.value })} />
        </div>
        <div>
          <Label obrigatorio={produto?.controla_lote ?? true} htmlFor="entrada-val">Validade</Label>
          <Input id="entrada-val" type="date" value={f.validade} onChange={(e) => setF({ ...f, validade: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="entrada-fab">Fabricação</Label>
          <Input id="entrada-fab" type="date" value={f.fabricacao} onChange={(e) => setF({ ...f, fabricacao: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="entrada-custo">Custo unitário (R$)</Label>
          <Input id="entrada-custo" type="number" min="0" step="0.0001" className="tabular text-right" value={f.custo} onChange={(e) => setF({ ...f, custo: e.target.value })} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="entrada-obs">Observação</Label>
          <Input id="entrada-obs" value={f.observacao} placeholder="Ex.: NF 1234 do fornecedor" onChange={(e) => setF({ ...f, observacao: e.target.value })} />
        </div>
        <p className="col-span-2 text-xs text-muted">Sem número de lote, o sistema cria um lote pela validade (ex.: V20270131). Mesmo lote e validade somam no saldo existente.</p>
      </div>
    </Dialogo>
  );
}

export type SaldoLote = {
  id: string; deposito_id: string; deposito_nome: string; produto_codigo: string; produto_nome: string;
  lote_numero: string | null; validade: string | null; quantidade: number; quantidade_reservada: number; disponivel: number;
};

const TIPOS = [
  { valor: "perda", rotulo: "Perda", ajuda: "Produto descongelado, avariado ou vencido que vai para o lixo." },
  { valor: "ajuste_saida", rotulo: "Ajuste para menos", ajuda: "Correção de contagem: há menos do que o sistema mostra." },
  { valor: "ajuste_entrada", rotulo: "Ajuste para mais", ajuda: "Correção de contagem: há mais do que o sistema mostra." },
  { valor: "transferencia", rotulo: "Transferir", ajuda: "Mover o lote para outro depósito (ex.: avarias)." },
] as const;

/** Perda, ajuste ou transferência de um saldo de lote */
export function DialogoMovimento({ saldo, aoFechar, aoConcluir }: { saldo: SaldoLote | null; aoFechar: () => void; aoConcluir: () => void }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const { depositos } = useDepositos();
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["valor"]>("perda");
  const [qtd, setQtd] = useState("");
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (saldo) { setTipo("perda"); setQtd(""); setMotivo(""); setDestino(""); } }, [saldo]);

  async function salvar() {
    if (!saldo) return;
    if (!(num(qtd) > 0)) return toast.error("Informe a quantidade");
    if (tipo === "transferencia" && !destino) return toast.error("Escolha o depósito de destino");
    if (tipo !== "transferencia" && !motivo.trim()) return toast.error("Informe o motivo");
    setSalvando(true);
    const { error } = await supabase.rpc("estoque_movimentar", {
      p_saldo: saldo.id, p_tipo: tipo, p_quantidade: num(qtd), p_observacao: motivo || null, p_deposito_destino: destino || null,
    });
    setSalvando(false);
    if (error) return toast.error("Não foi possível lançar", { description: mensagemErro(error), duration: 8000 });
    toast.success("Movimentação lançada");
    aoConcluir();
    aoFechar();
  }

  const t = TIPOS.find((x) => x.valor === tipo)!;
  return (
    <Dialogo
      aberto={!!saldo}
      titulo="Movimentar lote"
      descricao={saldo ? `${saldo.produto_codigo} · ${saldo.produto_nome}` : undefined}
      aoFechar={aoFechar}
      rodape={<><Button onClick={aoFechar}>Fechar</Button><Button variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Lançando..." : "Lançar"}</Button></>}
    >
      {saldo && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-md bg-surface-2/60 p-3 text-xs">
            <div><div className="text-muted">Lote</div><div className="font-medium">{saldo.lote_numero ?? "sem lote"}{saldo.validade ? ` · ${formatarData(saldo.validade)}` : ""}</div></div>
            <div><div className="text-muted">Depósito</div><div className="font-medium">{saldo.deposito_nome}</div></div>
            <div><div className="text-muted">Livre no lote</div><div className="tabular font-medium">{formatarNumero(Number(saldo.quantidade) - Number(saldo.quantidade_reservada))}{Number(saldo.quantidade_reservada) > 0 && <span className="text-muted"> ({formatarNumero(saldo.quantidade_reservada)} reserv.)</span>}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label="Tipo">
            {TIPOS.map((x) => (
              <button key={x.valor} role="radio" aria-checked={tipo === x.valor} onClick={() => setTipo(x.valor)}
                className={cn("rounded-md border px-2 py-1.5 text-sm", tipo === x.valor ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}>
                {x.rotulo}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{t.ajuda}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label obrigatorio htmlFor="mov-qtd">Quantidade</Label>
              <Input id="mov-qtd" autoFocus type="number" min="0" step="any" inputMode="decimal" className="tabular text-right" value={qtd} onChange={(e) => setQtd(e.target.value)} />
            </div>
            {tipo === "transferencia" && (
              <div>
                <Label obrigatorio htmlFor="mov-dest">Para o depósito</Label>
                <Select id="mov-dest" value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <option value="">Selecione...</option>
                  {depositos.filter((d) => d.valor !== saldo.deposito_id).map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
                </Select>
              </div>
            )}
          </div>
          <div>
            <Label obrigatorio={tipo !== "transferencia"} htmlFor="mov-motivo">Motivo</Label>
            <Textarea id="mov-motivo" className="min-h-16" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </div>
      )}
    </Dialogo>
  );
}
