"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, CalendarDays, Check, ClipboardList, CloudOff, MapPin, MessageCircle, Minus, Phone, Plus, RefreshCw,
  ChevronRight, Home, Repeat, Search, ShoppingCart, Trash2, Users, X,
} from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { STATUS_PEDIDO, type StatusPedido } from "@/lib/pedidos";
import { filaPor, filaTirar, filaTodos, kvGet, kvSet, novoId, posicaoAtual, registrarServiceWorker, sincronizar, type ItemFila } from "@/lib/offline";

// ---------------------------------------------------------------------
type Cliente = {
  id: string; codigo: number; nome: string; razao_social: string; documento: string | null; telefone: string | null; whatsapp: string | null;
  endereco: string | null; bairro: string | null; cidade: string | null; latitude: number | null; longitude: number | null;
  rota_id: string | null; rota_nome: string | null; dias_semana: number[] | null; ordem_visita: number | null; tabela_preco_id: string | null;
  condicao_nome: string | null; forma_nome: string | null; bloqueado: boolean; motivo_bloqueio: string | null;
  limite_credito: number; em_aberto: number; em_atraso: number;
  ultimo_pedido_data: string | null; ultimo_pedido_numero: number | null; ultimo_pedido_valor: number | null;
  ultimo_itens: { produto_id: string; quantidade: number }[] | null; visita_hoje: "pedido" | "sem_pedido" | null;
  condicao_pagamento_id?: string | null; forma_pagamento_id?: string | null;
};
type Produto = { id: string; codigo: string; nome: string; unidade: string | null; categoria: string | null; foto_url: string | null;
  preco_venda: number; preco_minimo: number | null; disponivel: number; unidades_por_caixa: number | null };
type Preco = { tabela_preco_id: string; produto_id: string; preco: number; preco_minimo: number | null };
type PedidoResumo = { id: string; numero: number; status: StatusPedido; data_emissao: string; cliente_nome: string; cliente_fantasia: string | null;
  valor_total: number; motivo_trava: string | null; origem: string; faturado_em?: string | null; forma_nome?: string | null; condicao_nome?: string | null };
type Pagamentos = { condicoes: { id: string; nome: string }[]; formas: { id: string; nome: string; gera_boleto: boolean }[] };
type DetalhePedido = {
  id: string; numero: number; status: StatusPedido; data_emissao: string; data_entrega: string | null; cliente_id: string; cliente_nome: string;
  condicao_pagamento_id: string | null; condicao_nome: string | null; forma_pagamento_id: string | null; forma_nome: string | null;
  observacao: string | null; motivo_trava: string | null; valor_total: number; faturado_em: string | null; origem: string; pode_alterar: boolean;
  itens: { produto_id: string; codigo: string; nome: string; quantidade: number; preco: number; total: number }[];
  titulos: { parcela: number; total_parcelas: number; valor: number; vencimento: string; quitado: boolean }[];
};
type Resumo = { vendedor: string | null; vendido: number; pedidos: number; clientes_positivados: number; carteira: number; meta: number | null;
  comissao_percentual: number | null; comissao_prevista: number | null; visitas_sem_pedido: number; dias_uteis_mes: number; dias_uteis_passados: number;
  meta_da_empresa?: boolean; vendedores?: { nome: string; meta: number | null; vendido: number; pedidos: number }[] | null;
  mes_inicio: string; hoje?: string; vendido_hoje?: number; pedidos_hoje?: number; faturado?: number; faturado_hoje?: number;
  comissao_mes?: number | null; comissao_hoje?: number | null; diario?: Diario[] };
type Diario = { dia: string; util: boolean; vendido: number; pedidos: number };
type Dados = { carteira: Cliente[]; produtos: Produto[]; precos: Preco[]; pedidos: PedidoResumo[]; resumo: Resumo | null; pagamentos?: Pagamentos; atualizadoEm: string };
type Carrinho = {
  clienteId: string | null; itens: Record<string, { qtd: number; preco: number }>; obs: string; entrega: string;
  condicaoId?: string | null; formaId?: string | null; editando?: { pedidoId: string; numero: number } | null;
};

type Aba = "inicio" | "rota" | "clientes" | "pedido" | "pedidos";
const VAZIO: Carrinho = { clienteId: null, itens: {}, obs: "", entrega: "" };
const MOTIVOS = ["Estoque ainda cheio", "Fechado", "Responsável ausente", "Sem dinheiro", "Comprou do concorrente", "Preço"];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function ForcaVendas({ nome, podeCriar }: { nome: string; podeCriar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [dados, setDados] = useState<Dados | null>(null);
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [online, setOnline] = useState(true);
  const [baixando, setBaixando] = useState(false);
  const [aba, setAba] = useState<Aba>("inicio");
  const [carrinho, setCarrinhoEstado] = useState<Carrinho>(VAZIO);
  const [naoComprou, setNaoComprou] = useState<Cliente | null>(null);

  const setCarrinho = useCallback((c: Carrinho | ((x: Carrinho) => Carrinho)) => {
    setCarrinhoEstado((atual) => {
      const novo = typeof c === "function" ? c(atual) : c;
      kvSet("carrinho", novo);
      return novo;
    });
  }, []);

  const recarregarFila = useCallback(async () => setFila(await filaTodos()), []);

  const baixar = useCallback(async (silencioso = false) => {
    if (!navigator.onLine) { if (!silencioso) toast.info("Sem sinal. Usando os dados guardados no aparelho."); return; }
    setBaixando(true);
    const desde = new Date(Date.now() - 90 * 864e5).toISOString();
    const [c, p, pr, pe, re, pg] = await Promise.all([
      supabase.rpc("app_carteira"),
      supabase.rpc("app_produtos"),
      supabase.from("tabelas_preco_itens").select("tabela_preco_id, produto_id, preco, preco_minimo").eq("ativo", true).limit(20000),
      supabase.from("vw_pedidos").select("id, numero, status, data_emissao, cliente_nome, cliente_fantasia, valor_total, motivo_trava, origem, faturado_em, forma_nome, condicao_nome")
        .eq("tipo", "pedido").eq("ativo", true).gte("data_emissao", desde).order("numero", { ascending: false }).limit(500),
      supabase.rpc("app_resumo"),
      supabase.rpc("app_pagamentos"),
    ]);
    setBaixando(false);
    const erro = c.error ?? p.error ?? pr.error ?? pe.error ?? re.error ?? pg.error;
    if (erro) { if (!silencioso) toast.error("Não foi possível atualizar", { description: erro.message }); return; }
    const novo: Dados = {
      carteira: (c.data ?? []) as Cliente[], produtos: (p.data ?? []) as Produto[], precos: (pr.data ?? []) as Preco[],
      pedidos: (pe.data ?? []) as PedidoResumo[], resumo: (re.data ?? null) as Resumo | null,
      pagamentos: (pg.data ?? { condicoes: [], formas: [] }) as Pagamentos, atualizadoEm: new Date().toISOString(),
    };
    setDados(novo);
    await kvSet("dados", novo);
    if (!silencioso) toast.success("Dados atualizados");
  }, [supabase]);

  const enviarFila = useCallback(async () => {
    const r = await sincronizar(supabase, (item, resp) => {
      if (item.tipo === "pedido") {
        const x = resp as { numero: number; status: string; motivo: string | null; saiu_da_carga?: boolean };
        const nomeCli = String(item.resumo.cliente ?? "");
        if (item.rpc === "app_alterar_pedido" && x?.status === "aprovado") {
          toast.success(`Pedido ${x.numero} de ${nomeCli} alterado e aprovado`,
            { description: x.saiu_da_carga ? "Ele estava numa carga em montagem e saiu dela: a expedição precisa incluí-lo de novo." : undefined, duration: x.saiu_da_carga ? 10000 : 4000 });
        } else if (x?.status === "aprovado") toast.success(`Pedido ${x.numero} de ${nomeCli} aprovado`);
        else if (x?.status === "aguardando_credito") toast.warning(`Pedido ${x.numero} de ${nomeCli} aguardando crédito`, { description: x.motivo ?? undefined });
        else toast.warning(`Pedido ${x?.numero} de ${nomeCli} ficou para o escritório`, { description: x?.motivo ?? undefined, duration: 10000 });
      }
    });
    await recarregarFila();
    if (r.enviados) await baixar(true);
    if (r.erros) toast.error(`${r.erros} envio(s) com problema. Veja em Pedidos.`);
    return r;
  }, [supabase, recarregarFila, baixar]);

  useEffect(() => {
    registrarServiceWorker();
    (async () => {
      const [d, c] = await Promise.all([kvGet<Dados>("dados"), kvGet<Carrinho>("carrinho")]);
      if (d) setDados(d);
      if (c) setCarrinhoEstado(c);
      await recarregarFila();
      setOnline(navigator.onLine);
      if (navigator.onLine) { await enviarFila(); await baixar(true); }
    })();
    const on = () => { setOnline(true); enviarFila(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [baixar, enviarFila, recarregarFila]);

  const produtoPorId = useMemo(() => new Map((dados?.produtos ?? []).map((p) => [p.id, p])), [dados]);
  const precoMapa = useMemo(() => new Map((dados?.precos ?? []).map((p) => [`${p.tabela_preco_id}:${p.produto_id}`, p])), [dados]);
  const cliente = dados?.carteira.find((c) => c.id === carrinho.clienteId) ?? null;
  const precoDe = useCallback((p: Produto, cli: Cliente | null) => {
    const t = cli?.tabela_preco_id ? precoMapa.get(`${cli.tabela_preco_id}:${p.id}`) : undefined;
    return { preco: Number(t?.preco ?? p.preco_venda), minimo: t?.preco_minimo ?? p.preco_minimo };
  }, [precoMapa]);

  const qtdItens = Object.values(carrinho.itens).filter((i) => i.qtd > 0).length;
  const pendentes = fila.length;

  function iniciarPedido(c: Cliente) {
    if (carrinho.clienteId && carrinho.clienteId !== c.id && qtdItens > 0) {
      if (!confirm(`Há um pedido em andamento para outro cliente. Descartar e começar para ${c.nome}?`)) return;
    }
    if (carrinho.clienteId !== c.id) setCarrinho({ ...VAZIO, clienteId: c.id });
    setAba("pedido");
  }

  async function registrarNaoComprou(c: Cliente, motivo: string) {
    const pos = await posicaoAtual(2500);
    await filaPor({
      id: novoId(), tipo: "visita", rpc: "app_registrar_visita", criadoEm: new Date().toISOString(), tentativas: 0,
      args: { p_id_local: novoId(), p_cliente: c.id, p_motivo: motivo, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null },
      resumo: { cliente: c.nome, motivo },
    });
    setDados((d) => d && { ...d, carteira: d.carteira.map((x) => (x.id === c.id && !x.visita_hoje ? { ...x, visita_hoje: "sem_pedido" } : x)) });
    setNaoComprou(null);
    await recarregarFila();
    toast.success(`Visita registrada: ${c.nome}`);
    if (navigator.onLine) enviarFila();
  }

  async function enviarPedido() {
    if (!cliente) return;
    const itens = Object.entries(carrinho.itens).filter(([, i]) => i.qtd > 0);
    if (!itens.length) return toast.error("Inclua ao menos um produto");
    const idLocal = novoId();
    const total = itens.reduce((a, [, i]) => a + i.qtd * i.preco, 0);
    const pItens = itens.map(([produto_id, i]) => ({ produto_id, quantidade: i.qtd, preco: i.preco }));
    if (carrinho.editando) {
      await filaPor({
        id: idLocal, tipo: "pedido", rpc: "app_alterar_pedido", criadoEm: new Date().toISOString(), tentativas: 0,
        args: {
          p_pedido: carrinho.editando.pedidoId, p_id_envio: idLocal, p_itens: pItens,
          p_condicao: carrinho.condicaoId ?? null, p_forma: carrinho.formaId ?? null,
          p_observacao: carrinho.obs || null, p_data_entrega: carrinho.entrega || null,
        },
        resumo: { cliente: cliente.nome, total: r2(total), itens: itens.length, alteracao: carrinho.editando.numero },
      });
    } else {
      const pos = await posicaoAtual(2500);
      await filaPor({
        id: idLocal, tipo: "pedido", rpc: "app_enviar_pedido", criadoEm: new Date().toISOString(), tentativas: 0,
        args: {
          p_id_local: idLocal, p_cliente: cliente.id, p_observacao: carrinho.obs || null, p_data_entrega: carrinho.entrega || null,
          p_itens: pItens, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null,
          p_condicao: carrinho.condicaoId ?? null, p_forma: carrinho.formaId ?? null,
        },
        resumo: { cliente: cliente.nome, total: r2(total), itens: itens.length },
      });
    }
    setDados((d) => d && { ...d, carteira: d.carteira.map((x) => (x.id === cliente.id ? { ...x, visita_hoje: "pedido" } : x)) });
    setCarrinho(VAZIO);
    await recarregarFila();
    setAba("pedidos");
    if (navigator.onLine) {
      const r = await enviarFila();
      if (r.semRede) toast.info("Pedido guardado no aparelho. Sobe sozinho quando o sinal voltar.");
    } else {
      toast.info("Sem sinal: pedido guardado no aparelho. Sobe sozinho quando o sinal voltar.");
    }
  }

  function alterarPedido(d: DetalhePedido) {
    if (!dados?.carteira.some((c) => c.id === d.cliente_id)) return toast.error("Este cliente não está na sua carteira");
    if (qtdItens > 0 && !confirm("Há um pedido em andamento. Descartar e alterar o pedido nº " + d.numero + "?")) return;
    const itens: Carrinho["itens"] = {};
    for (const i of d.itens) itens[i.produto_id] = { qtd: Number(i.quantidade), preco: Number(i.preco) };
    setCarrinho({
      clienteId: d.cliente_id, itens, obs: d.observacao ?? "", entrega: d.data_entrega ?? "",
      condicaoId: d.condicao_pagamento_id, formaId: d.forma_pagamento_id, editando: { pedidoId: d.id, numero: d.numero },
    });
    setAba("pedido");
    toast.info(`Alterando o pedido nº ${d.numero}. Mude o que precisar e envie.`);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-side px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 text-white">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Elos Vendas</div>
          <div className="truncate text-xs text-side-ink">{dados?.resumo?.vendedor ?? nome}</div>
        </div>
        {!online && <span className="flex items-center gap-1 rounded-full bg-warn/20 px-2 py-0.5 text-xs text-[#ffd28a]"><CloudOff size={13} /> Sem sinal</span>}
        {pendentes > 0 && (
          <button onClick={() => setAba("pedidos")} className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{pendentes} a enviar</button>
        )}
        <button onClick={async () => { await enviarFila(); await baixar(); }} disabled={baixando} className="rounded p-1.5 hover:bg-white/10 disabled:opacity-50" aria-label="Atualizar">
          <RefreshCw size={18} className={cn(baixando && "animate-spin")} />
        </button>
      </header>

      <main className="flex-1 px-3 pt-3 pb-24">
        {!dados ? (
          <div className="py-16 text-center text-sm text-muted">{online ? "Baixando sua carteira..." : "Sem sinal e sem dados guardados. Abra com internet uma vez."}</div>
        ) : (
          <>
            {aba === "rota" && <AbaRota dados={dados} onPedido={iniciarPedido} onNaoComprou={setNaoComprou} />}
            {aba === "clientes" && <AbaClientes dados={dados} onPedido={iniciarPedido} onNaoComprou={setNaoComprou} />}
            {aba === "pedido" && (
              <AbaPedido dados={dados} cliente={cliente} carrinho={carrinho} setCarrinho={setCarrinho} produtoPorId={produtoPorId}
                precoDe={precoDe} podeCriar={podeCriar} onEscolherCliente={() => setAba("clientes")} onEnviar={async () => { await enviarPedido(); }} />
            )}
            {aba === "pedidos" && <AbaPedidos dados={dados} fila={fila} onTentar={enviarFila} recarregar={recarregarFila} onAlterar={alterarPedido} />}
            {aba === "inicio" && <AbaInicio dados={dados} onNovoPedido={() => setAba(carrinho.clienteId ? "pedido" : "clientes")} />}
            <p className="mt-6 text-center text-[11px] text-muted">Atualizado em {new Date(dados.atualizadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
          </>
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {([
            ["inicio", "Início", Home], ["rota", "Rota", CalendarDays], ["clientes", "Clientes", Users], ["pedido", "Pedido", ShoppingCart],
            ["pedidos", "Pedidos", ClipboardList],
          ] as const).map(([k, r, I]) => (
            <button key={k} onClick={() => setAba(k)} aria-current={aba === k ? "page" : undefined}
              className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", aba === k ? "text-accent" : "text-muted")}>
              <I size={20} />
              {r}
              {k === "pedido" && qtdItens > 0 && <span className="absolute top-1 right-[calc(50%-18px)] rounded-full bg-accent px-1.5 text-[10px] text-white">{qtdItens}</span>}
              {k === "pedidos" && pendentes > 0 && <span className="absolute top-1 right-[calc(50%-18px)] rounded-full bg-warn px-1.5 text-[10px] text-white">{pendentes}</span>}
            </button>
          ))}
        </div>
      </nav>

      <Dialogo aberto={!!naoComprou} titulo="Não comprou" descricao={naoComprou?.nome} aoFechar={() => setNaoComprou(null)}>
        <MotivoVisita aoEscolher={(m) => naoComprou && registrarNaoComprou(naoComprou, m)} />
      </Dialogo>
    </div>
  );
}

// ---------------------------------------------------------------------
function MotivoVisita({ aoEscolher }: { aoEscolher: (m: string) => void }) {
  const [outro, setOutro] = useState("");
  return (
    <div className="space-y-2">
      {MOTIVOS.map((m) => (
        <button key={m} onClick={() => aoEscolher(m)} className="block w-full rounded-md border border-line px-3 py-2.5 text-left text-sm hover:bg-surface-2">{m}</button>
      ))}
      <div className="flex gap-2 pt-1">
        <Input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Outro motivo" aria-label="Outro motivo" />
        <Button variante="primario" disabled={!outro.trim()} onClick={() => aoEscolher(outro.trim())}>Ok</Button>
      </div>
    </div>
  );
}

function CartaoCliente({ c, onPedido, onNaoComprou }: { c: Cliente; onPedido: (c: Cliente) => void; onNaoComprou: (c: Cliente) => void }) {
  const zap = (c.whatsapp || c.telefone || "").replace(/\D/g, "");
  const mapa = c.latitude && c.longitude ? `${c.latitude},${c.longitude}` : [c.endereco, c.bairro, c.cidade].filter(Boolean).join(", ");
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        {c.ordem_visita !== null && <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted">{c.ordem_visita}</span>}
        <div className="min-w-0 flex-1">
          <div className="font-medium">{c.nome}</div>
          <div className="truncate text-xs text-muted">{[c.endereco, c.bairro].filter(Boolean).join(" · ") || "Sem endereço"}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {c.visita_hoje === "pedido" && <Badge tom="ok">Pedido feito hoje</Badge>}
            {c.visita_hoje === "sem_pedido" && <Badge>Visitado sem pedido</Badge>}
            {c.bloqueado && <Badge tom="erro">Bloqueado</Badge>}
            {Number(c.em_atraso) > 0 && <Badge tom="erro">Atraso {formatarMoeda(c.em_atraso)}</Badge>}
            {c.ultimo_pedido_data && <span className="text-xs text-muted">Último: {formatarData(c.ultimo_pedido_data)} · {formatarMoeda(c.ultimo_pedido_valor)}</span>}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <Button tamanho="p" variante="primario" className="flex-1" onClick={() => onPedido(c)}><ShoppingCart size={15} /> Pedido</Button>
        <Button tamanho="p" onClick={() => onNaoComprou(c)}>Não comprou</Button>
        {c.telefone && <a href={`tel:${c.telefone.replace(/\D/g, "")}`} aria-label="Ligar"><Button tamanho="p" variante="fantasma"><Phone size={16} /></Button></a>}
        {zap && <a href={`https://wa.me/55${zap}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"><Button tamanho="p" variante="fantasma"><MessageCircle size={16} /></Button></a>}
        {mapa && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapa)}`} target="_blank" rel="noreferrer" aria-label="Mapa"><Button tamanho="p" variante="fantasma"><MapPin size={16} /></Button></a>}
      </div>
    </li>
  );
}

function AbaRota({ dados, onPedido, onNaoComprou }: { dados: Dados; onPedido: (c: Cliente) => void; onNaoComprou: (c: Cliente) => void }) {
  const dia = new Date().getDay();
  const doDia = dados.carteira.filter((c) => (c.dias_semana ?? []).includes(dia))
    .sort((a, b) => (a.rota_nome ?? "").localeCompare(b.rota_nome ?? "") || (a.ordem_visita ?? 999) - (b.ordem_visita ?? 999));
  const visitados = doDia.filter((c) => c.visita_hoje).length;
  const comPedido = doDia.filter((c) => c.visita_hoje === "pedido").length;
  return (
    <>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">Rota de {["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][dia]}</h1>
          <p className="text-xs text-muted">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        {doDia.length > 0 && <div className="text-right text-xs text-muted"><div className="tabular text-base font-semibold text-ink">{visitados}/{doDia.length}</div>visitados · {comPedido} com pedido</div>}
      </div>
      {doDia.length > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full bg-ok" style={{ width: `${(visitados / doDia.length) * 100}%` }} />
        </div>
      )}
      {doDia.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
          Nenhum cliente com visita marcada para hoje. Os dias de visita vêm do cadastro de rotas. Veja todos os clientes na aba Clientes.
        </div>
      ) : (
        <ul className="space-y-2">{doDia.map((c) => <CartaoCliente key={c.id} c={c} onPedido={onPedido} onNaoComprou={onNaoComprou} />)}</ul>
      )}
    </>
  );
}

function AbaClientes({ dados, onPedido, onNaoComprou }: { dados: Dados; onPedido: (c: Cliente) => void; onNaoComprou: (c: Cliente) => void }) {
  const [busca, setBusca] = useState("");
  const t = norm(busca.trim());
  const lista = dados.carteira.filter((c) => !t || t.split(/\s+/).every((p) =>
    norm(`${c.codigo} ${c.nome} ${c.razao_social} ${c.documento ?? ""} ${c.bairro ?? ""} ${c.rota_nome ?? ""}`).includes(p)));
  return (
    <>
      <div className="relative mb-3">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar em ${dados.carteira.length} clientes`} className="h-11 pl-8" aria-label="Buscar cliente" />
      </div>
      <ul className="space-y-2">{lista.slice(0, 80).map((c) => <CartaoCliente key={c.id} c={c} onPedido={onPedido} onNaoComprou={onNaoComprou} />)}</ul>
      {lista.length > 80 && <p className="mt-3 text-center text-xs text-muted">Mostrando 80 de {lista.length}. Refine a busca.</p>}
      {lista.length === 0 && <p className="py-10 text-center text-sm text-muted">Nenhum cliente encontrado.</p>}
    </>
  );
}

// ---------------------------------------------------------------------
function AbaPedido({ dados, cliente, carrinho, setCarrinho, produtoPorId, precoDe, podeCriar, onEscolherCliente, onEnviar }: {
  dados: Dados; cliente: Cliente | null; carrinho: Carrinho; setCarrinho: (c: Carrinho | ((x: Carrinho) => Carrinho)) => void;
  produtoPorId: Map<string, Produto>; precoDe: (p: Produto, c: Cliente | null) => { preco: number; minimo: number | null };
  podeCriar: boolean; onEscolherCliente: () => void; onEnviar: () => Promise<void>;
}) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  if (!cliente) {
    return (
      <div className="rounded-lg border border-dashed border-line p-8 text-center">
        <ShoppingCart size={28} className="mx-auto mb-2 text-muted" />
        <p className="mb-3 text-sm text-muted">Escolha o cliente para começar o pedido.</p>
        <Button variante="primario" onClick={onEscolherCliente}>Escolher cliente</Button>
      </div>
    );
  }

  const categorias = [...new Set(dados.produtos.map((p) => p.categoria).filter(Boolean))] as string[];
  const t = norm(busca.trim());
  const lista = dados.produtos.filter((p) => (!categoria || p.categoria === categoria) && (!t || t.split(/\s+/).every((x) => norm(`${p.codigo} ${p.nome}`).includes(x))));
  const itens = Object.entries(carrinho.itens).filter(([, i]) => i.qtd > 0);
  const total = itens.reduce((a, [, i]) => a + i.qtd * i.preco, 0);
  const pg = dados.pagamentos ?? { condicoes: [], formas: [] };
  const condId = carrinho.condicaoId ?? cliente.condicao_pagamento_id ?? null;
  const formaId = carrinho.formaId ?? cliente.forma_pagamento_id ?? null;
  const condNome = pg.condicoes.find((c) => c.id === condId)?.nome ?? cliente.condicao_nome;
  const formaNome = pg.formas.find((f) => f.id === formaId)?.nome ?? cliente.forma_nome;
  const pagamentoTexto = [condNome, formaNome].filter(Boolean).join(" · ") || "Pagamento padrão do cliente";

  function mudar(p: Produto, qtd: number) {
    const q = Math.max(0, Math.round(qtd * 1000) / 1000);
    setCarrinho((c) => {
      const atual = c.itens[p.id];
      const itensNovos = { ...c.itens, [p.id]: { qtd: q, preco: atual?.preco ?? precoDe(p, cliente).preco } };
      if (q === 0) delete itensNovos[p.id];
      return { ...c, itens: itensNovos };
    });
  }
  function repetirUltimo() {
    const ult = cliente!.ultimo_itens ?? [];
    if (!ult.length) return toast.info("Este cliente ainda não tem pedido anterior");
    setCarrinho((c) => {
      const novos = { ...c.itens };
      for (const u of ult) {
        const p = produtoPorId.get(u.produto_id);
        if (p) novos[p.id] = { qtd: Number(u.quantidade), preco: precoDe(p, cliente).preco };
      }
      return { ...c, itens: novos };
    });
    toast.success("Itens do último pedido incluídos. Confira as quantidades.");
  }

  return (
    <>
      {carrinho.editando && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          <span>Alterando o pedido <b>nº {carrinho.editando.numero}</b></span>
          <Button tamanho="p" variante="fantasma" onClick={() => { if (confirm("Desistir da alteração? O pedido fica como estava.")) setCarrinho(VAZIO); }}>Desistir</Button>
        </div>
      )}
      <div className="mb-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium">{cliente.nome}</div>
            <div className="text-xs text-muted">{pagamentoTexto}</div>
          </div>
          {!carrinho.editando && <button onClick={() => setCarrinho(VAZIO)} className="rounded p-1 text-muted hover:text-ink" aria-label="Trocar cliente"><X size={18} /></button>}
        </div>
        {(cliente.bloqueado || Number(cliente.em_atraso) > 0) && (
          <div className="mt-2 flex items-start gap-1.5 rounded bg-bad/5 p-2 text-xs text-bad">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {cliente.bloqueado ? `Cliente bloqueado${cliente.motivo_bloqueio ? `: ${cliente.motivo_bloqueio}` : ""}.` : `Títulos em atraso: ${formatarMoeda(cliente.em_atraso)}.`} O pedido vai para aprovação do financeiro.
          </div>
        )}
        {cliente.ultimo_itens?.length ? (
          <Button tamanho="p" className="mt-2" onClick={repetirUltimo}><Repeat size={14} /> Repetir último pedido ({formatarData(cliente.ultimo_pedido_data)})</Button>
        ) : null}
      </div>

      <div className="relative mb-2">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto" className="h-11 pl-8" aria-label="Buscar produto" />
      </div>
      {categorias.length > 1 && (
        <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 pb-1">
          {[null, ...categorias].map((c) => (
            <button key={c ?? "todas"} onClick={() => setCategoria(c)}
              className={cn("shrink-0 rounded-full border px-3 py-1 text-xs", categoria === c ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted")}>
              {c ?? "Todas"}
            </button>
          ))}
        </div>
      )}

      <ul className="divide-y divide-line/70 rounded-lg border border-line bg-surface">
        {lista.map((p) => {
          const { preco, minimo } = precoDe(p, cliente);
          const q = carrinho.itens[p.id]?.qtd ?? 0;
          const falta = q > Number(p.disponivel);
          return (
            <li key={p.id} className={cn("flex items-center gap-2 px-3 py-2", q > 0 && "bg-accent-soft/40")}>
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-tight">{p.nome}</div>
                <div className="text-xs text-muted">
                  <span className="tabular font-medium text-ink">{formatarMoeda(preco)}</span>{p.unidade ? ` /${p.unidade}` : ""}
                  {minimo ? ` · mín ${formatarMoeda(minimo)}` : ""}
                  <span className={cn(" ", Number(p.disponivel) <= 0 || falta ? "text-bad" : "")}> · disp. {formatarNumero(p.disponivel)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <button onClick={() => mudar(p, q - 1)} disabled={q <= 0} className="flex size-9 items-center justify-center rounded-l-md border border-line disabled:opacity-40" aria-label={`Menos ${p.nome}`}><Minus size={16} /></button>
                <input inputMode="decimal" value={q || ""} placeholder="0" onChange={(e) => mudar(p, Number(e.target.value.replace(",", ".")) || 0)}
                  className="tabular h-9 w-12 border-y border-line bg-surface text-center text-sm focus:outline-none" aria-label={`Quantidade ${p.nome}`} />
                <button onClick={() => mudar(p, q + 1)} className="flex size-9 items-center justify-center rounded-r-md border border-line" aria-label={`Mais ${p.nome}`}><Plus size={16} /></button>
              </div>
            </li>
          );
        })}
        {lista.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Nenhum produto encontrado.</li>}
      </ul>

      {itens.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-10 px-3">
          <div className="mx-auto flex max-w-xl items-center gap-3 rounded-lg bg-side px-4 py-2.5 text-white shadow-lg">
            <div className="flex-1 text-sm"><span className="tabular font-semibold">{formatarMoeda(total)}</span><span className="text-side-ink"> · {itens.length} {itens.length === 1 ? "item" : "itens"}</span></div>
            <Button variante="primario" onClick={() => setRevisando(true)} disabled={!podeCriar}>Revisar</Button>
          </div>
        </div>
      )}

      <Dialogo aberto={revisando} titulo={carrinho.editando ? `Alterar pedido nº ${carrinho.editando.numero}` : `Pedido · ${cliente.nome}`} descricao={carrinho.editando ? cliente.nome : undefined} aoFechar={() => setRevisando(false)}
        rodape={<>
          <Button onClick={() => setRevisando(false)}>Voltar</Button>
          <Button variante="primario" disabled={enviando || !itens.length} onClick={async () => { setEnviando(true); await onEnviar(); setEnviando(false); setRevisando(false); }}>
            <Check size={16} /> {enviando ? "Enviando..." : carrinho.editando ? "Salvar alteração" : "Enviar pedido"}
          </Button>
        </>}>
        <ul className="mb-3 divide-y divide-line/70">
          {itens.map(([id, i]) => {
            const p = produtoPorId.get(id);
            if (!p) return null;
            const { minimo } = precoDe(p, cliente);
            const abaixo = minimo !== null && minimo !== undefined && i.preco < Number(minimo);
            return (
              <li key={id} className="py-2">
                <div className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0">{p.nome}</span>
                  <button onClick={() => mudar(p, 0)} className="text-muted" aria-label={`Tirar ${p.nome}`}><Trash2 size={15} /></button>
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="tabular">{formatarNumero(i.qtd)} ×</span>
                  <Input type="number" step="0.01" inputMode="decimal" className={cn("h-8 w-24 text-right tabular", abaixo && "border-bad")} value={i.preco}
                    onChange={(e) => setCarrinho((c) => ({ ...c, itens: { ...c.itens, [id]: { ...i, preco: Number(e.target.value) || 0 } } }))} aria-label={`Preço ${p.nome}`} />
                  <span className="tabular ml-auto font-medium">{formatarMoeda(i.qtd * i.preco)}</span>
                </div>
                {abaixo && <div className="text-xs text-bad">Abaixo do preço mínimo ({formatarMoeda(minimo)})</div>}
              </li>
            );
          })}
        </ul>
        <div className="mb-3 flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total</span><span className="tabular">{formatarMoeda(total)}</span></div>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="ped-cond">Condição</Label>
              <Select id="ped-cond" value={condId ?? ""} onChange={(e) => setCarrinho((c) => ({ ...c, condicaoId: e.target.value || null }))}>
                {!condId && <option value="">Padrão do cliente</option>}
                {pg.condicoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="ped-forma">Forma de pagamento</Label>
              <Select id="ped-forma" value={formaId ?? ""} onChange={(e) => setCarrinho((c) => ({ ...c, formaId: e.target.value || null }))}>
                {!formaId && <option value="">Padrão do cliente</option>}
                {pg.formas.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </Select>
            </div>
          </div>
          {(condId !== (cliente.condicao_pagamento_id ?? null) || formaId !== (cliente.forma_pagamento_id ?? null)) && (cliente.condicao_nome || cliente.forma_nome) && (
            <p className="text-xs text-muted">Padrão do cliente: {[cliente.condicao_nome, cliente.forma_nome].filter(Boolean).join(" · ")}. Prazo maior pode mandar o pedido para aprovação de crédito.</p>
          )}
          <div><Label htmlFor="ped-entrega">Entrega desejada</Label><Input id="ped-entrega" type="date" min={hojeIso()} value={carrinho.entrega} onChange={(e) => setCarrinho((c) => ({ ...c, entrega: e.target.value }))} /></div>
          <div><Label htmlFor="ped-obs">Observação</Label><Textarea id="ped-obs" className="min-h-16" value={carrinho.obs} onChange={(e) => setCarrinho((c) => ({ ...c, obs: e.target.value }))} /></div>
        </div>
      </Dialogo>
    </>
  );
}

// ---------------------------------------------------------------------
const FILTROS_PEDIDO = [
  ["todos", "Todos"], ["abertos", "Em aberto"], ["faturados", "Faturados"], ["entregues", "Entregues"], ["problema", "Com pendência"],
] as const;
type FiltroPedido = (typeof FILTROS_PEDIDO)[number][0];

function AbaPedidos({ dados, fila, onTentar, recarregar, onAlterar }: {
  dados: Dados; fila: ItemFila[]; onTentar: () => Promise<unknown>; recarregar: () => Promise<void>; onAlterar: (d: DetalhePedido) => void;
}) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroPedido>("todos");
  const [aberto, setAberto] = useState<PedidoResumo | null>(null);
  const [detalhe, setDetalhe] = useState<DetalhePedido | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function abrir(p: PedidoResumo) {
    setAberto(p);
    setDetalhe(null);
    if (!navigator.onLine) return;
    setCarregando(true);
    const { data, error } = await supabase.rpc("app_pedido", { p_pedido: p.id });
    setCarregando(false);
    if (error) return toast.error("Não foi possível abrir o pedido", { description: error.message });
    setDetalhe(data as DetalhePedido);
  }

  const t = norm(busca.trim());
  const lista = dados.pedidos.filter((p) => {
    if (t && !t.split(/\s+/).every((x) => norm(`${p.numero} ${p.cliente_nome} ${p.cliente_fantasia ?? ""}`).includes(x))) return false;
    if (filtro === "abertos") return ["rascunho", "aguardando_credito", "aprovado", "em_separacao"].includes(p.status) && !p.faturado_em;
    if (filtro === "faturados") return !!p.faturado_em;
    if (filtro === "entregues") return p.status === "entregue";
    if (filtro === "problema") return ["rascunho", "aguardando_credito", "devolvido"].includes(p.status);
    return true;
  });
  const totalLista = lista.reduce((a, p) => a + Number(p.valor_total), 0);
  const st = aberto ? STATUS_PEDIDO[detalhe?.status ?? aberto.status] : null;

  return (
    <>
      {fila.length > 0 && (
        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Guardados no aparelho</h2>
            <Button tamanho="p" onClick={() => onTentar()}><RefreshCw size={14} /> Enviar agora</Button>
          </div>
          <ul className="space-y-2">
            {fila.map((f) => (
              <li key={f.id} className={cn("rounded-lg border bg-surface p-3 text-sm", f.erro ? "border-bad/40" : "border-warn/40")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {f.tipo === "pedido" ? (f.resumo.alteracao ? `Alteração do pedido ${f.resumo.alteracao}` : "Pedido") : "Visita"} · {String(f.resumo.cliente ?? "")}
                    </div>
                    <div className="text-xs text-muted">
                      {f.tipo === "pedido" ? `${f.resumo.itens} itens · ${formatarMoeda(f.resumo.total)}` : String(f.resumo.motivo ?? "")}
                      {" · "}{new Date(f.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  </div>
                  {f.erro ? <Badge tom="erro">Não aceito</Badge> : <Badge tom="aviso">Aguardando sinal</Badge>}
                </div>
                {f.erro && (
                  <>
                    <p className="mt-1.5 text-xs text-bad">{f.erro}</p>
                    <div className="mt-2 flex gap-2">
                      <Button tamanho="p" onClick={async () => { await filaPor({ ...f, erro: undefined }); await recarregar(); await onTentar(); }}>Tentar de novo</Button>
                      <Button tamanho="p" variante="perigo" onClick={async () => { if (confirm("Descartar este envio?")) { await filaTirar(f.id); await recarregar(); } }}>Descartar</Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="relative mb-2">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por número ou cliente" className="h-11 pl-8" aria-label="Buscar pedido" />
      </div>
      <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 pb-1">
        {FILTROS_PEDIDO.map(([k, r]) => (
          <button key={k} onClick={() => setFiltro(k)}
            className={cn("shrink-0 rounded-full border px-3 py-1 text-xs", filtro === k ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted")}>{r}</button>
        ))}
      </div>
      <div className="mb-2 flex justify-between text-xs text-muted">
        <span>{lista.length} {lista.length === 1 ? "pedido" : "pedidos"} · últimos 90 dias</span>
        <span className="tabular">{formatarMoeda(totalLista)}</span>
      </div>
      {lista.length === 0 ? <p className="py-8 text-center text-sm text-muted">Nenhum pedido encontrado.</p> : (
        <ul className="divide-y divide-line/70 rounded-lg border border-line bg-surface">
          {lista.map((p) => {
            const s = STATUS_PEDIDO[p.status];
            return (
              <li key={p.id}>
                <button onClick={() => abrir(p)} className="w-full px-3 py-2.5 text-left text-sm hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.cliente_fantasia || p.cliente_nome}</div>
                      <div className="text-xs text-muted">Nº {p.numero} · {formatarData(p.data_emissao)}{p.forma_nome ? ` · ${p.forma_nome}` : ""}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular">{formatarMoeda(p.valor_total)}</div>
                      <div className="flex justify-end gap-1">
                        {p.faturado_em && <Badge tom="acento">Faturado</Badge>}
                        <Badge tom={s.tom}>{s.rotulo}</Badge>
                      </div>
                    </div>
                  </div>
                  {p.motivo_trava && ["rascunho", "aguardando_credito"].includes(p.status) && <p className="mt-1 text-xs text-warn">{p.motivo_trava}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialogo aberto={!!aberto} titulo={aberto ? `Pedido nº ${aberto.numero}` : ""} descricao={aberto ? (aberto.cliente_fantasia || aberto.cliente_nome) : undefined}
        aoFechar={() => setAberto(null)}
        rodape={<>
          <Button onClick={() => setAberto(null)}>Fechar</Button>
          {detalhe?.pode_alterar && <Button variante="primario" onClick={() => { onAlterar(detalhe); setAberto(null); }}>Alterar pedido</Button>}
        </>}>
        {aberto && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {st && <Badge tom={st.tom}>{st.rotulo}</Badge>}
              {(detalhe?.faturado_em ?? aberto.faturado_em) && <Badge tom="acento">Faturado em {formatarData(detalhe?.faturado_em ?? aberto.faturado_em)}</Badge>}
              <span className="text-xs text-muted">Emitido em {formatarData(aberto.data_emissao)}</span>
            </div>
            {!navigator.onLine && !detalhe && <p className="rounded bg-surface-2 p-2 text-xs text-muted">Sem sinal: abra com internet para ver os itens e alterar.</p>}
            {carregando && <p className="text-xs text-muted">Carregando...</p>}
            {detalhe && (
              <>
                <ul className="divide-y divide-line/70 rounded border border-line">
                  {detalhe.itens.map((i) => (
                    <li key={i.produto_id} className="flex items-start justify-between gap-2 px-2.5 py-1.5">
                      <div className="min-w-0"><div className="leading-tight">{i.nome}</div><div className="tabular text-xs text-muted">{formatarNumero(i.quantidade)} × {formatarMoeda(i.preco)}</div></div>
                      <span className="tabular shrink-0">{formatarMoeda(i.total)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular">{formatarMoeda(detalhe.valor_total)}</span></div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">Pagamento</dt><dd>{[detalhe.condicao_nome, detalhe.forma_nome].filter(Boolean).join(" · ") || "—"}</dd>
                  {detalhe.data_entrega && <><dt className="text-muted">Entrega</dt><dd>{formatarData(detalhe.data_entrega)}</dd></>}
                  {detalhe.observacao && <><dt className="text-muted">Observação</dt><dd>{detalhe.observacao}</dd></>}
                </dl>
                {detalhe.motivo_trava && ["rascunho", "aguardando_credito"].includes(detalhe.status) && <p className="rounded bg-warn/10 p-2 text-xs text-warn">{detalhe.motivo_trava}</p>}
                {detalhe.titulos.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted">Parcelas</div>
                    <ul className="space-y-0.5 text-xs">
                      {detalhe.titulos.map((x) => (
                        <li key={x.parcela} className="flex justify-between">
                          <span>{x.parcela}/{x.total_parcelas} · vence {formatarData(x.vencimento)}</span>
                          <span className="tabular">{formatarMoeda(x.valor)}{x.quitado ? " · pago" : ""}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!detalhe.pode_alterar && (
                  <p className="text-xs text-muted">
                    {detalhe.faturado_em ? "Pedido faturado: não pode mais ser alterado pelo app. Fale com o escritório."
                      : ["cancelado", "devolvido", "entregue", "em_rota"].includes(detalhe.status) ? "Este pedido já foi encerrado ou saiu para entrega."
                      : "O pedido já está em separação. Peça à expedição para tirá-lo da carga se precisar alterar."}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Dialogo>
    </>
  );
}

// ---------------------------------------------------------------------
function Anel({ pct }: { pct: number | null }) {
  const r = 34, c = 2 * Math.PI * r;
  const p = pct === null ? 0 : Math.min(1, pct / 100);
  return (
    <div className="relative size-[88px] shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        {p > 0 && <circle cx="40" cy="40" r={r} fill="none" stroke={p >= 1 ? "var(--ok)" : "var(--accent)"} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-lg leading-none font-semibold">{pct === null ? "—" : pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`}</span>
        <span className="mt-0.5 text-[10px] text-muted">da meta</span>
      </div>
    </div>
  );
}

function GraficoDiario({ dias, porDia, hoje }: { dias: Diario[]; porDia: number | null; hoje: string }) {
  const [ativo, setAtivo] = useState<string | null>(null);
  const max = Math.max(1, porDia ?? 0, ...dias.map((d) => Number(d.vendido))) * 1.1;
  const W = 300, H = 96, gap = 2, bw = (W - gap * (dias.length - 1)) / dias.length;
  const sel = dias.find((d) => d.dia === (ativo ?? hoje)) ?? dias[dias.length - 1];
  const yMeta = porDia ? H - (porDia / max) * H : null;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-muted">{sel ? `${new Date(sel.dia + "T12:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}${sel.dia === hoje ? " · hoje" : ""}` : ""}</span>
        <span><b className="tabular">{formatarMoeda(sel?.vendido ?? 0)}</b> <span className="text-muted">· {sel?.pedidos ?? 0} {sel?.pedidos === 1 ? "pedido" : "pedidos"}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full touch-none select-none" role="img"
        aria-label={`Vendas por dia no mês${porDia ? `, com a linha do necessário por dia útil (${formatarMoeda(porDia)})` : ""}`}
        onPointerLeave={() => setAtivo(null)}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--line)" />
        {dias.map((d, i) => {
          const v = Number(d.vendido);
          const h = v > 0 ? Math.max(2, (v / max) * H) : 0;
          const x = i * (bw + gap);
          const futuro = d.dia > hoje;
          const destaque = d.dia === (ativo ?? hoje);
          return (
            <g key={d.dia} onPointerEnter={() => setAtivo(d.dia)} onPointerDown={() => setAtivo(d.dia)}>
              <rect x={x} y={0} width={bw + gap} height={H + 14} fill="transparent" />
              {!futuro && !d.util && v === 0 ? null : (
                <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(2, bw / 2)}
                  fill="var(--accent)" opacity={destaque ? 1 : 0.45} />
              )}
              {futuro && d.util && <rect x={x} y={H - 1.5} width={bw} height={1.5} fill="var(--line)" />}
              {(i === 0 || Number(d.dia.slice(8)) % 5 === 0) && (
                <text x={x + bw / 2} y={H + 11} textAnchor="middle" fontSize="8" fill="var(--muted)">{Number(d.dia.slice(8))}</text>
              )}
            </g>
          );
        })}
        {yMeta !== null && <line x1="0" x2={W} y1={yMeta} y2={yMeta} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth="1" opacity="0.8" />}
      </svg>
      {porDia ? (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <svg width="16" height="4" aria-hidden><line x1="0" x2="16" y1="2" y2="2" stroke="var(--muted)" strokeDasharray="3 3" /></svg>
          meta por dia útil · {formatarMoeda(porDia)}
        </div>
      ) : null}
    </div>
  );
}

function AbaInicio({ dados, onNovoPedido }: { dados: Dados; onNovoPedido: () => void }) {
  const r = dados.resumo;
  const [diario, setDiario] = useState(false);
  if (!r) return <p className="py-8 text-center text-sm text-muted">Sem resumo. Atualize com internet.</p>;
  const vendido = Number(r.vendido);
  const meta = r.meta ? Number(r.meta) : null;
  const pct = meta ? (vendido / meta) * 100 : null;
  const projecao = r.dias_uteis_passados > 0 ? (vendido / r.dias_uteis_passados) * r.dias_uteis_mes : vendido;
  const restantes = Math.max(0, r.dias_uteis_mes - r.dias_uteis_passados);
  const falta = meta ? Math.max(0, meta - vendido) : 0;
  const porDia = meta ? meta / Math.max(1, r.dias_uteis_mes) : null;
  const mesAno = new Date(r.mes_inicio + "T12:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
  const temComissao = r.comissao_percentual !== null && r.comissao_percentual !== undefined;
  const hoje = r.hoje ?? hojeIso();
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="font-semibold">{temComissao ? "Meta e comissão" : r.meta_da_empresa ? "Meta da empresa" : "Meta"} · {mesAno}</h1>
          {r.vendedor && <span className="truncate text-xs text-muted">{r.vendedor}</span>}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <Anel pct={pct} />
          <div className="min-w-0">
            <div className="tabular text-2xl leading-tight font-semibold">{formatarMoeda(vendido)}</div>
            <div className="text-xs text-muted">{meta ? <>de {formatarMoeda(meta)} no mês</> : "vendido no mês"}</div>
            {meta ? (
              falta > 0
                ? <div className="mt-1 text-xs">Faltam <b className="tabular">{formatarMoeda(falta)}</b>{restantes > 0 && <> · <span className="tabular">{formatarMoeda(falta / restantes)}</span>/dia útil</>}</div>
                : <div className="mt-1 text-xs font-medium text-ok">Meta batida</div>
            ) : <div className="mt-1 text-xs text-muted">Meta ainda não configurada.</div>}
            <div className="mt-0.5 text-xs text-muted">No ritmo atual fecha em <span className="tabular text-ink">{formatarMoeda(projecao)}</span></div>
          </div>
        </div>
        {temComissao && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div><div className="text-xs text-muted">Comissão de hoje</div><div className="tabular text-lg font-semibold">{formatarMoeda(r.comissao_hoje ?? 0)}</div></div>
            <div><div className="text-xs text-muted">Comissão no mês</div><div className="tabular text-lg font-semibold">{formatarMoeda(r.comissao_mes ?? 0)}</div></div>
            <p className="col-span-2 -mt-1 text-[11px] text-muted">
              {formatarNumero(r.comissao_percentual ?? 0)}% sobre vendas faturadas ({formatarMoeda(r.faturado ?? 0)} no mês).
              {r.comissao_prevista ? <> Se tudo o que foi vendido for faturado: {formatarMoeda(r.comissao_prevista)}.</> : null}
            </p>
          </div>
        )}
        {!!r.diario?.length && (
          <div className="mt-3 border-t border-line pt-2">
            <button onClick={() => setDiario((v) => !v)} aria-expanded={diario} className="flex w-full items-center gap-1.5 py-1 text-sm font-medium">
              <ChevronRight size={16} className={cn("transition-transform", diario && "rotate-90")} /> Acompanhamento diário
            </button>
            {diario && <div className="pt-2"><GraficoDiario dias={r.diario} porDia={porDia} hoje={hoje} /></div>}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="text-xs text-muted">Vendido hoje</div>
          <div className="tabular text-xl font-semibold">{formatarMoeda(r.vendido_hoje ?? 0)}</div>
          <div className="text-xs text-muted">{r.pedidos_hoje ?? 0} {r.pedidos_hoje === 1 ? "pedido" : "pedidos"}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="text-xs text-muted">No mês</div>
          <div className="tabular text-xl font-semibold">{formatarMoeda(vendido)}</div>
          <div className="text-xs text-muted">{r.pedidos} {r.pedidos === 1 ? "pedido" : "pedidos"}</div>
        </div>
      </div>

      <Button variante="primario" className="h-12 w-full text-base" onClick={onNovoPedido}><ShoppingCart size={18} /> Novo pedido</Button>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Positivados", `${r.clientes_positivados}/${r.carteira}`],
          ["Ticket médio", r.pedidos ? formatarMoeda(vendido / r.pedidos) : "—"],
          ["Sem pedido", String(r.visitas_sem_pedido)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface px-2 py-2.5">
            <div className="tabular text-sm font-semibold">{v}</div>
            <div className="text-[11px] text-muted">{k}</div>
          </div>
        ))}
      </div>

      {!!r.vendedores?.length && (
        <section className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-2 text-xs font-medium text-muted">Por vendedor</div>
          <ul className="divide-y divide-line/70">
            {r.vendedores.map((v) => {
              const m = v.meta ? Number(v.meta) : null, x = Number(v.vendido);
              return (
                <li key={v.nome} className="px-4 py-2.5">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate">{v.nome}</span>
                    <span className="tabular shrink-0">{formatarMoeda(x)}</span>
                  </div>
                  {m ? (
                    <>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className={cn("h-full rounded-full", x >= m ? "bg-ok" : "bg-accent")} style={{ width: `${Math.min(100, (x / m) * 100)}%` }} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted">{Math.round((x / m) * 100)}% de {formatarMoeda(m)} · {v.pedidos} pedidos</div>
                    </>
                  ) : <div className="text-xs text-muted">Sem meta · {v.pedidos} pedidos</div>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="text-center text-[11px] text-muted">Vendido conta pedidos confirmados (aprovados em diante). Comissão conta o que já foi faturado.</p>
    </div>
  );
}
