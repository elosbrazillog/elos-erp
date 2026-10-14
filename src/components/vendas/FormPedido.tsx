"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Ban, Check, CheckCircle2, Printer, RotateCcw, Trash2, Undo2, XCircle } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Textarea, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { BuscaRegistro, type Resultado } from "@/components/ui/BuscaRegistro";
import { carregarOpcoesRelacao } from "@/components/crud/CampoInput";
import { cn, formatarData, formatarDocumento, formatarMoeda, formatarNumero } from "@/lib/utils";
import { buscarClientes, carregarProdutosVenda, filtrarProdutos, type ProdutoVenda } from "@/lib/buscas";
import { STATUS_PEDIDO, mensagemErro, type StatusPedido } from "@/lib/pedidos";
import type { Opcao } from "@/lib/entidades";

type Pedido = {
  id: string; numero: number; tipo: "pedido" | "orcamento"; status: StatusPedido; data_emissao: string;
  cliente_id: string; cliente_codigo: number; cliente_nome: string; cliente_fantasia: string | null;
  vendedor_id: string | null; rota_id: string | null; tabela_preco_id: string | null; condicao_pagamento_id: string | null;
  forma_pagamento_id: string | null; deposito_id: string | null; data_entrega: string | null; validade: string | null;
  valor_produtos: number; valor_desconto: number; valor_frete: number; valor_total: number; peso_total_kg: number;
  motivo_trava: string | null; motivo_cancelamento: string | null; credito_liberado_em: string | null;
  pedido_cliente: string | null; observacao: string | null; observacao_nfe: string | null; qtd_itens: number;
};
type Item = {
  id: string; produto_id: string; quantidade: number; preco_unitario: number; desconto: number; valor_total: number; ordem: number;
  produtos: { codigo: string; nome: string; unidades: { sigla: string } | null } | null;
};
type Reserva = { pedido_item_id: string; quantidade: number; lotes: { numero: string; validade: string } | null; depositos: { nome: string } | null };
type Credito = { limite_credito: number; em_aberto: number; em_atraso: number; bloqueado: boolean };
type Cliente = { documento: string | null; telefone: string | null; whatsapp: string | null; bloqueado: boolean; motivo_bloqueio: string | null };

const CAMPOS_COMERCIAIS = ["vendedor_id", "tabela_preco_id", "condicao_pagamento_id", "forma_pagamento_id", "deposito_id", "valor_desconto", "valor_frete"] as const;
const CAMPOS_LIVRES = ["rota_id", "data_entrega", "validade", "pedido_cliente", "observacao", "observacao_nfe"] as const;
const ENCERRADOS: StatusPedido[] = ["faturado", "em_rota", "entregue", "devolvido", "cancelado"];

const hoje = () => new Date().toISOString().slice(0, 10);
const somarDias = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const num = (v: string | number | null | undefined) => (v === "" || v === null || v === undefined ? 0 : Number(String(v).replace(",", ".")));

export function FormPedido({
  id, podeCriar, podeEditar, podeExcluir, podeCredito,
}: { id?: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean; podeCredito: boolean }) {
  if (!id) return <NovoPedido podeCriar={podeCriar} />;
  return <EditarPedido id={id} podeEditar={podeEditar} podeExcluir={podeExcluir} podeCredito={podeCredito} />;
}

// ---------------------------------------------------------------------
function NovoPedido({ podeCriar }: { podeCriar: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [tipo, setTipo] = useState<"pedido" | "orcamento">("pedido");
  const [cliente, setCliente] = useState<Resultado | null>(null);
  const [validade, setValidade] = useState(somarDias(7));
  const [salvando, setSalvando] = useState(false);
  const buscar = useCallback((t: string) => buscarClientes(supabase, t), [supabase]);

  async function criar() {
    if (!cliente) return toast.error("Escolha o cliente");
    setSalvando(true);
    const { data, error } = await supabase
      .from("pedidos")
      .insert({ cliente_id: cliente.id, tipo, validade: tipo === "orcamento" ? validade : null, origem: "web" })
      .select("id")
      .single();
    setSalvando(false);
    if (error) return toast.error("Não foi possível criar", { description: mensagemErro(error) });
    router.replace(`/vendas/pedidos/${data.id}`);
  }

  if (!podeCriar) return <Card><Vazio titulo="Seu perfil não pode lançar pedidos" /></Card>;

  return (
    <>
      <Cabecalho trilha="Vendas · Pedidos e orçamentos" titulo={tipo === "pedido" ? "Novo pedido" : "Novo orçamento"}
        acoes={<Button onClick={() => router.push("/vendas/pedidos")}><ArrowLeft size={16} /> Voltar</Button>} />
      <Card className="max-w-2xl p-5">
        <div className="mb-4 inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Tipo">
          {(["pedido", "orcamento"] as const).map((t) => (
            <button key={t} role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)}
              className={cn("rounded px-4 py-1.5 text-sm", tipo === t ? "bg-accent text-accent-ink" : "text-muted hover:text-ink")}>
              {t === "pedido" ? "Pedido" : "Orçamento"}
            </button>
          ))}
        </div>
        <div className="space-y-4">
          <div>
            <Label obrigatorio htmlFor="cliente">Cliente</Label>
            <BuscaRegistro id="cliente" autoFocus buscar={buscar} selecionado={cliente} aoEscolher={setCliente} aoLimpar={() => setCliente(null)}
              placeholder="Código, nome, fantasia ou CNPJ" />
            {cliente?.aviso && <p className="mt-1.5 text-xs text-bad">Cliente bloqueado: o pedido vai travar no crédito.</p>}
          </div>
          {tipo === "orcamento" && (
            <div className="max-w-48">
              <Label htmlFor="validade">Válido até</Label>
              <Input id="validade" type="date" value={validade} min={hoje()} onChange={(e) => setValidade(e.target.value)} />
            </div>
          )}
          <p className="text-sm text-muted">Vendedor, rota, tabela de preço e pagamento vêm do cadastro do cliente. Dá para trocar na próxima tela.</p>
          <Button variante="primario" disabled={!cliente || salvando} onClick={criar}>
            {salvando ? "Criando..." : "Criar e incluir itens"}
          </Button>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------
function EditarPedido({ id, podeEditar, podeExcluir, podeCredito }: { id: string; podeEditar: boolean; podeExcluir: boolean; podeCredito: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [itens, setItens] = useState<Item[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [credito, setCredito] = useState<Credito | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [produtos, setProdutos] = useState<ProdutoVenda[]>([]);
  const [opcoes, setOpcoes] = useState<Record<string, Opcao[]>>({});
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<null | "cancelar" | "recusar" | "excluir" | "trocarCliente">(null);
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    const { data: p } = await supabase.from("vw_pedidos").select("*").eq("id", id).maybeSingle();
    if (!p) return setNaoEncontrado(true);
    const ped = p as Pedido;
    const [its, res, cred, cli] = await Promise.all([
      supabase.from("pedidos_itens").select("id, produto_id, quantidade, preco_unitario, desconto, valor_total, ordem, produtos(codigo, nome, unidades(sigla))")
        .eq("pedido_id", id).eq("ativo", true).order("ordem").order("criado_em"),
      supabase.from("pedidos_reservas").select("pedido_item_id, quantidade, lotes(numero, validade), depositos(nome)").eq("pedido_id", id),
      supabase.from("vw_credito_clientes").select("limite_credito, em_aberto, em_atraso, bloqueado").eq("pessoa_id", ped.cliente_id).maybeSingle(),
      supabase.from("pessoas").select("documento, telefone, whatsapp, bloqueado, motivo_bloqueio").eq("id", ped.cliente_id).maybeSingle(),
    ]);
    setPedido(ped);
    setForm(Object.fromEntries([...CAMPOS_COMERCIAIS, ...CAMPOS_LIVRES].map((k) => [k, ped[k] === null || ped[k] === undefined ? "" : String(ped[k])])));
    setItens((its.data ?? []) as unknown as Item[]);
    setReservas((res.data ?? []) as unknown as Reserva[]);
    setCredito(cred.error ? null : ((cred.data as Credito) ?? null));
    setCliente((cli.data as Cliente) ?? null);
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    Promise.all([
      carregarOpcoesRelacao({ tabela: "pessoas", rotulo: "razao_social", filtro: { eh_vendedor: true } }),
      carregarOpcoesRelacao({ tabela: "rotas", rotulo: "nome" }),
      carregarOpcoesRelacao({ tabela: "tabelas_preco", rotulo: "nome" }),
      carregarOpcoesRelacao({ tabela: "condicoes_pagamento", rotulo: "nome" }),
      carregarOpcoesRelacao({ tabela: "formas_pagamento", rotulo: "nome" }),
      carregarOpcoesRelacao({ tabela: "depositos", rotulo: "nome" }),
    ]).then(([vendedores, rotas, tabelas, condicoes, formas, depositos]) => setOpcoes({ vendedores, rotas, tabelas, condicoes, formas, depositos }));
  }, []);

  const tabelaId = pedido?.tabela_preco_id ?? null;
  const depositoId = pedido?.deposito_id ?? null;
  const qtdItens = itens.length;
  useEffect(() => {
    carregarProdutosVenda(supabase, tabelaId, depositoId).then(setProdutos);
  }, [supabase, tabelaId, depositoId, qtdItens, pedido?.status]);

  const buscarCliente = useCallback((t: string) => buscarClientes(supabase, t), [supabase]);

  if (naoEncontrado) return <Card><Vazio titulo="Pedido não encontrado" texto="Ele pode ter sido excluído, ou seu perfil não tem acesso." acao={<Link href="/vendas/pedidos"><Button>Voltar aos pedidos</Button></Link>} /></Card>;
  if (!pedido) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;

  const rascunho = pedido.status === "rascunho";
  const encerrado = ENCERRADOS.includes(pedido.status);
  const editaComercial = podeEditar && rascunho;
  const editaLivre = podeEditar && !encerrado;
  const st = STATUS_PEDIDO[pedido.status];
  const nome = pedido.tipo === "orcamento" ? "Orçamento" : "Pedido";
  const alterado = [...CAMPOS_COMERCIAIS, ...CAMPOS_LIVRES].some((k) => form[k] !== (pedido[k] === null || pedido[k] === undefined ? "" : String(pedido[k])));
  const prodPorId = new Map(produtos.map((p) => [p.id, p]));

  async function executar(acao: () => PromiseLike<{ error: { message?: string } | null; data?: unknown }>, sucesso: string | ((d: unknown) => string)) {
    setOcupado(true);
    const { error, data } = await acao();
    setOcupado(false);
    if (error) {
      toast.error("Não foi possível concluir", { description: mensagemErro(error), duration: 10000 });
      return false;
    }
    if (sucesso) toast.success(typeof sucesso === "function" ? sucesso(data) : sucesso);
    await carregar();
    router.refresh();
    return true;
  }

  async function salvarDados() {
    const campos = editaComercial ? [...CAMPOS_COMERCIAIS, ...CAMPOS_LIVRES] : [...CAMPOS_LIVRES];
    const dados: Record<string, unknown> = {};
    for (const k of campos) {
      const v = form[k];
      dados[k] = k === "valor_desconto" || k === "valor_frete" ? num(v) : v === "" ? null : v;
    }
    const tabelaMudou = editaComercial && form.tabela_preco_id !== (pedido!.tabela_preco_id ?? "");
    const ok = await executar(() => supabase.from("pedidos").update(dados).eq("id", id), "Dados salvos");
    if (ok && tabelaMudou && itens.length) toast.info("Tabela de preço trocada", { description: "Use 'Aplicar preços da tabela' nos itens para atualizar os valores." });
  }

  async function trocarCliente(r: Resultado) {
    setDialogo(null);
    const { data: c } = await supabase.from("pessoas")
      .select("vendedor_id, rota_id, tabela_preco_id, condicao_pagamento_id, forma_pagamento_id").eq("id", r.id).single();
    const dados: Record<string, unknown> = { cliente_id: r.id };
    if (c) for (const [k, v] of Object.entries(c)) if (v) dados[k] = v;
    await executar(() => supabase.from("pedidos").update(dados).eq("id", id), "Cliente trocado");
  }

  async function confirmar() {
    await executar(() => supabase.rpc("pedido_confirmar", { p_pedido: id }), (d) => {
      const r = d as { status: string; motivo: string | null };
      return r.status === "aprovado" ? "Pedido aprovado e estoque reservado" : `Pedido travado no crédito: ${r.motivo}`;
    });
  }

  async function excluir() {
    setDialogo(null);
    setOcupado(true);
    const { error } = await supabase.from("pedidos").delete().eq("id", id);
    setOcupado(false);
    if (error) return toast.error("Não foi possível excluir", { description: mensagemErro(error) });
    toast.success(`${nome} excluído`);
    router.replace("/vendas/pedidos");
  }

  async function comMotivo(tipo: "cancelar" | "recusar") {
    if (!motivo.trim()) return toast.error("Informe o motivo");
    const ok = await executar(
      () => supabase.rpc(tipo === "cancelar" ? "pedido_cancelar" : "pedido_recusar_credito", { p_pedido: id, p_motivo: motivo }),
      tipo === "cancelar" ? `${nome} cancelado` : "Crédito recusado e pedido cancelado",
    );
    if (ok) { setDialogo(null); setMotivo(""); }
  }

  async function aplicarPrecosTabela() {
    const mudancas = itens.filter((i) => prodPorId.get(i.produto_id) && prodPorId.get(i.produto_id)!.preco !== Number(i.preco_unitario));
    if (!mudancas.length) return toast.info("Os preços já estão iguais aos da tabela");
    setOcupado(true);
    for (const i of mudancas) {
      const { error } = await supabase.from("pedidos_itens").update({ preco_unitario: prodPorId.get(i.produto_id)!.preco }).eq("id", i.id);
      if (error) { setOcupado(false); return toast.error("Não foi possível atualizar", { description: mensagemErro(error) }); }
    }
    setOcupado(false);
    toast.success(`${mudancas.length} ${mudancas.length === 1 ? "preço atualizado" : "preços atualizados"}`);
    carregar();
  }

  // ---- ações disponíveis
  const acoes: React.ReactNode[] = [];
  if (pedido.tipo === "pedido" && rascunho && podeEditar)
    acoes.push(<Button key="conf" variante="primario" disabled={ocupado || !itens.length || alterado} title={alterado ? "Salve os dados antes" : undefined} onClick={confirmar}><Check size={16} /> Confirmar pedido</Button>);
  if (pedido.tipo === "orcamento" && rascunho && podeEditar)
    acoes.push(<Button key="conv" variante="primario" disabled={ocupado || !itens.length} onClick={() => executar(() => supabase.rpc("orcamento_converter", { p_pedido: id }), "Orçamento convertido em pedido. Confira e confirme.")}><RotateCcw size={16} /> Converter em pedido</Button>);
  if (pedido.status === "aguardando_credito" && podeCredito) {
    acoes.push(<Button key="lib" variante="primario" disabled={ocupado} onClick={() => executar(() => supabase.rpc("pedido_liberar_credito", { p_pedido: id }), "Crédito liberado, pedido aprovado")}><CheckCircle2 size={16} /> Liberar crédito</Button>);
    acoes.push(<Button key="rec" variante="perigo" disabled={ocupado} onClick={() => { setMotivo(""); setDialogo("recusar"); }}><XCircle size={16} /> Recusar</Button>);
  }
  if ((pedido.status === "aguardando_credito" || pedido.status === "aprovado") && podeEditar)
    acoes.push(<Button key="reab" disabled={ocupado} onClick={() => executar(() => supabase.rpc("pedido_reabrir", { p_pedido: id }), "Pedido reaberto. A reserva de estoque foi devolvida.")}><Undo2 size={16} /> Reabrir</Button>);
  if (["rascunho", "aguardando_credito", "aprovado", "em_separacao"].includes(pedido.status) && podeEditar && !(rascunho && pedido.tipo === "orcamento"))
    acoes.push(<Button key="canc" variante="perigo" disabled={ocupado} onClick={() => { setMotivo(""); setDialogo("cancelar"); }}><Ban size={16} /> Cancelar</Button>);
  if (rascunho && podeExcluir)
    acoes.push(<Button key="exc" variante="fantasma" disabled={ocupado} onClick={() => setDialogo("excluir")} aria-label="Excluir"><Trash2 size={16} /></Button>);

  const disponivelCredito = credito && Number(credito.limite_credito) > 0 ? Number(credito.limite_credito) - Number(credito.em_aberto) : null;

  return (
    <>
      <Cabecalho
        trilha="Vendas · Pedidos e orçamentos"
        titulo={`${nome} ${pedido.numero}`}
        acoes={
          <>
            <Button onClick={() => router.push("/vendas/pedidos")}><ArrowLeft size={16} /> Voltar</Button>
            <a href={`/imprimir/pedido/${id}`} target="_blank" rel="noreferrer"><Button><Printer size={16} /> Imprimir</Button></a>
            {acoes}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tom={st.tom}>{st.rotulo}</Badge>
        <span className="text-muted">Emitido em {formatarData(pedido.data_emissao)}</span>
        {pedido.credito_liberado_em && <span className="text-muted">· crédito liberado em {formatarData(pedido.credito_liberado_em)}</span>}
      </div>

      {pedido.status === "aguardando_credito" && pedido.motivo_trava && (
        <Aviso tom="aviso" titulo="Aguardando liberação do financeiro">{pedido.motivo_trava}. O estoque já está reservado.</Aviso>
      )}
      {pedido.status === "cancelado" && <Aviso tom="erro" titulo="Cancelado">{pedido.motivo_cancelamento}</Aviso>}
      {pedido.tipo === "orcamento" && pedido.validade && pedido.validade < hoje() && rascunho && (
        <Aviso tom="aviso" titulo="Orçamento vencido">Altere a data de validade para converter em pedido.</Aviso>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Cliente */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted">Cliente · código {pedido.cliente_codigo}</div>
                <Link href={`/cadastros/pessoas/${pedido.cliente_id}`} className="font-medium hover:text-accent">{pedido.cliente_fantasia || pedido.cliente_nome}</Link>
                <div className="text-xs text-muted">
                  {[pedido.cliente_fantasia ? pedido.cliente_nome : null, cliente?.documento ? formatarDocumento(cliente.documento) : null].filter(Boolean).join(" · ")}
                </div>
                {cliente?.bloqueado && <div className="mt-1 text-xs text-bad">Bloqueado{cliente.motivo_bloqueio ? `: ${cliente.motivo_bloqueio}` : ""}</div>}
              </div>
              {editaComercial && <Button tamanho="p" onClick={() => setDialogo("trocarCliente")}>Trocar cliente</Button>}
            </div>
            {credito && (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs sm:grid-cols-4">
                <Info rotulo="Limite" valor={Number(credito.limite_credito) > 0 ? formatarMoeda(credito.limite_credito) : "Sem limite"} />
                <Info rotulo="Em aberto" valor={formatarMoeda(credito.em_aberto)} />
                <Info rotulo="Em atraso" valor={formatarMoeda(credito.em_atraso)} alerta={Number(credito.em_atraso) > 0} />
                <Info rotulo="Disponível" valor={disponivelCredito === null ? "—" : formatarMoeda(disponivelCredito)} alerta={disponivelCredito !== null && disponivelCredito < Number(pedido.valor_total)} />
              </div>
            )}
          </Card>

          <Itens
            pedidoId={id}
            itens={itens}
            reservas={reservas}
            produtos={produtos}
            editavel={editaComercial}
            mostrarReservas={!rascunho}
            aoMudar={carregar}
            aoAplicarTabela={aplicarPrecosTabela}
            ocupado={ocupado}
          />
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 text-sm font-medium">Totais</div>
            <dl className="space-y-1.5 text-sm">
              <Linha rotulo={`Produtos (${itens.length} ${itens.length === 1 ? "item" : "itens"})`} valor={formatarMoeda(pedido.valor_produtos)} />
              {Number(pedido.valor_desconto) > 0 && <Linha rotulo="Desconto" valor={`− ${formatarMoeda(pedido.valor_desconto)}`} />}
              {Number(pedido.valor_frete) > 0 && <Linha rotulo="Frete" valor={formatarMoeda(pedido.valor_frete)} />}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{formatarMoeda(pedido.valor_total)}</dd></div>
              <Linha rotulo="Peso bruto" valor={`${formatarNumero(pedido.peso_total_kg)} kg`} />
            </dl>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">Dados do {nome.toLowerCase()}</span>
              {alterado && (editaComercial || editaLivre) && <Button tamanho="p" variante="primario" disabled={ocupado} onClick={salvarDados}>Salvar</Button>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Vendedor" largo><SelectOp valor={form.vendedor_id} ops={opcoes.vendedores} desab={!editaComercial} onChange={(v) => setForm({ ...form, vendedor_id: v })} /></Campo>
              <Campo rotulo="Tabela de preço" largo><SelectOp valor={form.tabela_preco_id} ops={opcoes.tabelas} desab={!editaComercial} onChange={(v) => setForm({ ...form, tabela_preco_id: v })} /></Campo>
              <Campo rotulo="Condição de pagamento"><SelectOp valor={form.condicao_pagamento_id} ops={opcoes.condicoes} desab={!editaComercial} onChange={(v) => setForm({ ...form, condicao_pagamento_id: v })} /></Campo>
              <Campo rotulo="Forma de pagamento"><SelectOp valor={form.forma_pagamento_id} ops={opcoes.formas} desab={!editaComercial} onChange={(v) => setForm({ ...form, forma_pagamento_id: v })} /></Campo>
              <Campo rotulo="Desconto no total (R$)"><Input type="number" step="0.01" min="0" className="tabular text-right" value={form.valor_desconto} disabled={!editaComercial} onChange={(e) => setForm({ ...form, valor_desconto: e.target.value })} /></Campo>
              <Campo rotulo="Frete (R$)"><Input type="number" step="0.01" min="0" className="tabular text-right" value={form.valor_frete} disabled={!editaComercial} onChange={(e) => setForm({ ...form, valor_frete: e.target.value })} /></Campo>
              <Campo rotulo="Depósito de saída" largo><SelectOp valor={form.deposito_id} ops={opcoes.depositos} desab={!editaComercial} onChange={(v) => setForm({ ...form, deposito_id: v })} /></Campo>
              <Campo rotulo="Rota"><SelectOp valor={form.rota_id} ops={opcoes.rotas} desab={!editaLivre} onChange={(v) => setForm({ ...form, rota_id: v })} /></Campo>
              <Campo rotulo="Data de entrega"><Input type="date" value={form.data_entrega} disabled={!editaLivre} onChange={(e) => setForm({ ...form, data_entrega: e.target.value })} /></Campo>
              {pedido.tipo === "orcamento" && (
                <Campo rotulo="Orçamento válido até"><Input type="date" value={form.validade} disabled={!editaLivre} onChange={(e) => setForm({ ...form, validade: e.target.value })} /></Campo>
              )}
              <Campo rotulo="Pedido do cliente"><Input value={form.pedido_cliente} disabled={!editaLivre} placeholder="Nº de compra do cliente" onChange={(e) => setForm({ ...form, pedido_cliente: e.target.value })} /></Campo>
              <Campo rotulo="Observação" largo><Textarea value={form.observacao} disabled={!editaLivre} rows={2} className="min-h-16" onChange={(e) => setForm({ ...form, observacao: e.target.value })} /></Campo>
              <Campo rotulo="Observação na nota fiscal" largo><Textarea value={form.observacao_nfe} disabled={!editaLivre} rows={2} className="min-h-16" onChange={(e) => setForm({ ...form, observacao_nfe: e.target.value })} /></Campo>
            </div>
            {!rascunho && !encerrado && podeEditar && (
              <p className="mt-3 text-xs text-muted">Para trocar valores, pagamento ou itens, use Reabrir.</p>
            )}
          </Card>
        </div>
      </div>

      <Dialogo aberto={dialogo === "trocarCliente"} titulo="Trocar cliente" descricao="Vendedor, tabela e pagamento passam a ser os do novo cliente." aoFechar={() => setDialogo(null)}>
        <BuscaRegistro autoFocus buscar={buscarCliente} aoEscolher={trocarCliente} placeholder="Código, nome, fantasia ou CNPJ" />
        <div className="h-64" />
      </Dialogo>

      <Dialogo
        aberto={dialogo === "cancelar" || dialogo === "recusar"}
        titulo={dialogo === "recusar" ? "Recusar crédito" : `Cancelar ${nome.toLowerCase()} ${pedido.numero}`}
        descricao={dialogo === "recusar" ? "O pedido será cancelado e o estoque reservado volta a ficar disponível." : "O estoque reservado volta a ficar disponível. Não dá para desfazer."}
        aoFechar={() => setDialogo(null)}
        rodape={<>
          <Button onClick={() => setDialogo(null)}>Voltar</Button>
          <Button variante="perigo" disabled={ocupado} onClick={() => comMotivo(dialogo === "recusar" ? "recusar" : "cancelar")}>{dialogo === "recusar" ? "Recusar" : "Cancelar pedido"}</Button>
        </>}
      >
        <Label obrigatorio htmlFor="motivo">Motivo</Label>
        <Textarea id="motivo" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Dialogo>

      <Dialogo aberto={dialogo === "excluir"} titulo={`Excluir ${nome.toLowerCase()} ${pedido.numero}?`} descricao="A exclusão não pode ser desfeita." aoFechar={() => setDialogo(null)}
        rodape={<><Button onClick={() => setDialogo(null)}>Voltar</Button><Button variante="perigo" onClick={excluir}>Excluir</Button></>} />
    </>
  );
}

// ---------------------------------------------------------------------
function Itens({
  pedidoId, itens, reservas, produtos, editavel, mostrarReservas, aoMudar, aoAplicarTabela, ocupado,
}: {
  pedidoId: string; itens: Item[]; reservas: Reserva[]; produtos: ProdutoVenda[]; editavel: boolean; mostrarReservas: boolean;
  aoMudar: () => void; aoAplicarTabela: () => void; ocupado: boolean;
}) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [novo, setNovo] = useState<ProdutoVenda | null>(null);
  const [qtd, setQtd] = useState("");
  const [preco, setPreco] = useState("");
  const [edicao, setEdicao] = useState<Record<string, { quantidade: string; preco_unitario: string; desconto: string }>>({});
  const [salvando, setSalvando] = useState(false);
  const prodPorId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const buscar = useCallback(async (t: string) => filtrarProdutos(produtos, t), [produtos]);

  useEffect(() => {
    setEdicao(Object.fromEntries(itens.map((i) => [i.id, { quantidade: String(Number(i.quantidade)), preco_unitario: String(Number(i.preco_unitario)), desconto: String(Number(i.desconto)) }])));
  }, [itens]);

  async function incluir() {
    if (!novo) return;
    const q = num(qtd);
    if (q <= 0) return toast.error("Informe a quantidade");
    const jaTem = itens.find((i) => i.produto_id === novo.id);
    setSalvando(true);
    const { error } = jaTem
      ? await supabase.from("pedidos_itens").update({ quantidade: Number(jaTem.quantidade) + q }).eq("id", jaTem.id)
      : await supabase.from("pedidos_itens").insert({
          pedido_id: pedidoId, produto_id: novo.id, quantidade: q, preco_unitario: num(preco || novo.preco),
          ordem: (itens.at(-1)?.ordem ?? 0) + 1,
        });
    setSalvando(false);
    if (error) return toast.error("Não foi possível incluir", { description: mensagemErro(error) });
    if (jaTem) toast.info(`${novo.nome}: quantidade somada ao item que já estava no pedido`);
    setNovo(null); setQtd(""); setPreco("");
    aoMudar();
    setTimeout(() => document.getElementById("busca-produto")?.focus(), 50);
  }

  async function salvarLinha(i: Item) {
    const e = edicao[i.id];
    if (!e) return;
    const dados = { quantidade: num(e.quantidade), preco_unitario: num(e.preco_unitario), desconto: num(e.desconto) };
    if (dados.quantidade === Number(i.quantidade) && dados.preco_unitario === Number(i.preco_unitario) && dados.desconto === Number(i.desconto)) return;
    if (dados.quantidade <= 0) return toast.error("Quantidade deve ser maior que zero. Para tirar o item, use a lixeira.");
    const { error } = await supabase.from("pedidos_itens").update(dados).eq("id", i.id);
    if (error) return toast.error("Não foi possível salvar o item", { description: mensagemErro(error) });
    aoMudar();
  }

  async function remover(i: Item) {
    const { error } = await supabase.from("pedidos_itens").delete().eq("id", i.id);
    if (error) return toast.error("Não foi possível remover", { description: mensagemErro(error) });
    aoMudar();
  }

  const reservasDo = (itemId: string) => reservas.filter((r) => r.pedido_item_id === itemId);
  const precoNovo = num(preco || novo?.preco);
  const abaixoMinimoNovo = novo?.preco_minimo && precoNovo < Number(novo.preco_minimo);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <span className="text-sm font-medium">Itens</span>
        {editavel && itens.length > 0 && <Button tamanho="p" variante="fantasma" disabled={ocupado} onClick={aoAplicarTabela}>Aplicar preços da tabela</Button>}
      </div>

      {editavel && (
        <div className="grid grid-cols-2 gap-2 border-b border-line bg-surface-2/40 p-3 sm:grid-cols-[1fr_96px_120px_auto]">
          <div className="col-span-2 sm:col-span-1">
            <BuscaRegistro id="busca-produto" buscar={buscar} selecionado={novo ? { id: novo.id, rotulo: `${novo.codigo} · ${novo.nome}` } : null}
              aoEscolher={(r) => { const p = prodPorId.get(r.id)!; setNovo(p); setPreco(String(p.preco)); setTimeout(() => document.getElementById("qtd-novo")?.focus(), 30); }}
              aoLimpar={() => { setNovo(null); setPreco(""); }} placeholder="Incluir produto: código ou nome" />
          </div>
          <Input id="qtd-novo" type="number" min="0" step="any" inputMode="decimal" placeholder="Qtd" className="tabular text-right" value={qtd}
            onChange={(e) => setQtd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && incluir()} aria-label="Quantidade" />
          <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Preço" className="tabular text-right" value={preco}
            onChange={(e) => setPreco(e.target.value)} onKeyDown={(e) => e.key === "Enter" && incluir()} aria-label="Preço unitário" />
          <Button variante="primario" disabled={!novo || salvando} onClick={incluir} className="col-span-2 sm:col-span-1">Incluir</Button>
          {novo && (
            <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted sm:col-span-4">
              <span>Tabela: {formatarMoeda(novo.preco)}</span>
              {novo.preco_minimo ? <span className={cn(abaixoMinimoNovo && "font-medium text-bad")}>Mínimo: {formatarMoeda(novo.preco_minimo)}</span> : null}
              {novo.disponivel !== null && <span className={cn(num(qtd) > novo.disponivel && "font-medium text-warn")}>Disponível: {formatarNumero(novo.disponivel)}{novo.unidade ? ` ${novo.unidade}` : ""}</span>}
              {num(qtd) > 0 && <span className="text-ink">Total: {formatarMoeda(num(qtd) * precoNovo)}</span>}
            </div>
          )}
        </div>
      )}

      {itens.length === 0 ? (
        <Vazio titulo="Nenhum item" texto={editavel ? "Busque o produto acima, informe a quantidade e tecle Enter." : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Produto</th>
                <th className="px-3 py-2 text-right font-medium">Qtd</th>
                <th className="px-3 py-2 text-right font-medium">Preço</th>
                <th className="px-3 py-2 text-right font-medium">Desconto</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                {editavel && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => {
                const p = prodPorId.get(i.produto_id);
                const e = edicao[i.id];
                const abaixo = p?.preco_minimo && Number(i.preco_unitario) < Number(p.preco_minimo);
                const falta = editavel && p?.disponivel !== null && p?.disponivel !== undefined && Number(i.quantidade) > p.disponivel;
                const res = reservasDo(i.id);
                return (
                  <tr key={i.id} className="border-b border-line/70 align-top">
                    <td className="px-3 py-2">
                      <div><span className="text-muted">{i.produtos?.codigo}</span> {i.produtos?.nome}</div>
                      {abaixo && <div className="text-xs text-bad">Abaixo do preço mínimo ({formatarMoeda(p!.preco_minimo)})</div>}
                      {falta && <div className="text-xs text-warn">Disponível hoje: {formatarNumero(p!.disponivel)}</div>}
                      {mostrarReservas && res.length > 0 && (
                        <div className="mt-0.5 text-xs text-muted">
                          {res.map((r, k) => (
                            <span key={k} className="mr-3 whitespace-nowrap">
                              Lote {r.lotes?.numero ?? "sem lote"}{r.lotes?.validade ? ` · val. ${formatarData(r.lotes.validade)}` : ""} · {formatarNumero(r.quantidade)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    {editavel && e ? (
                      <>
                        <td className="px-2 py-1.5"><Input type="number" step="any" min="0" className="h-8 w-20 text-right tabular" value={e.quantidade} aria-label="Quantidade"
                          onChange={(ev) => setEdicao({ ...edicao, [i.id]: { ...e, quantidade: ev.target.value } })} onBlur={() => salvarLinha(i)} /></td>
                        <td className="px-2 py-1.5"><Input type="number" step="0.01" min="0" className="h-8 w-24 text-right tabular" value={e.preco_unitario} aria-label="Preço"
                          onChange={(ev) => setEdicao({ ...edicao, [i.id]: { ...e, preco_unitario: ev.target.value } })} onBlur={() => salvarLinha(i)} /></td>
                        <td className="px-2 py-1.5"><Input type="number" step="0.01" min="0" className="h-8 w-20 text-right tabular" value={e.desconto} aria-label="Desconto"
                          onChange={(ev) => setEdicao({ ...edicao, [i.id]: { ...e, desconto: ev.target.value } })} onBlur={() => salvarLinha(i)} /></td>
                      </>
                    ) : (
                      <>
                        <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatarNumero(i.quantidade)} {i.produtos?.unidades?.sigla}</td>
                        <td className="tabular px-3 py-2 text-right">{formatarMoeda(i.preco_unitario)}</td>
                        <td className="tabular px-3 py-2 text-right">{Number(i.desconto) ? formatarMoeda(i.desconto) : <span className="text-muted/50">—</span>}</td>
                      </>
                    )}
                    <td className="tabular px-3 py-2 text-right font-medium whitespace-nowrap">{formatarMoeda(i.valor_total)}</td>
                    {editavel && (
                      <td className="px-1 py-1.5">
                        <Button tamanho="p" variante="fantasma" onClick={() => remover(i)} aria-label={`Remover ${i.produtos?.nome}`}><Trash2 size={15} /></Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
function Aviso({ tom, titulo, children }: { tom: "aviso" | "erro"; titulo: string; children: React.ReactNode }) {
  return (
    <div className={cn("mb-4 flex gap-2.5 rounded-lg border px-4 py-3 text-sm", tom === "aviso" ? "border-warn/40 bg-warn/5" : "border-bad/40 bg-bad/5")} role="status">
      <AlertTriangle size={18} className={cn("mt-0.5 shrink-0", tom === "aviso" ? "text-warn" : "text-bad")} />
      <div><div className="font-medium">{titulo}</div><div className="text-muted">{children}</div></div>
    </div>
  );
}

function Info({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <div className="text-muted">{rotulo}</div>
      <div className={cn("tabular text-sm font-medium", alerta && "text-bad")}>{valor}</div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted">{rotulo}</dt><dd className="tabular">{valor}</dd></div>;
}

function Campo({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: React.ReactNode }) {
  return <div className={cn(largo && "col-span-2")}><Label>{rotulo}</Label>{children}</div>;
}

function SelectOp({ valor, ops, desab, onChange }: { valor: string; ops?: Opcao[]; desab: boolean; onChange: (v: string) => void }) {
  return (
    <Select value={valor} disabled={desab} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {(ops ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
    </Select>
  );
}
