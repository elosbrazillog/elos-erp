"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, CalendarDays, Check, ClipboardList, CloudOff, MapPin, MessageCircle, Minus, Phone, Plus, RefreshCw,
  Repeat, Search, ShoppingCart, Target, Trash2, Users, X,
} from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Input, Label, Textarea } from "@/components/ui";
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
};
type Produto = { id: string; codigo: string; nome: string; unidade: string | null; categoria: string | null; foto_url: string | null;
  preco_venda: number; preco_minimo: number | null; disponivel: number; unidades_por_caixa: number | null };
type Preco = { tabela_preco_id: string; produto_id: string; preco: number; preco_minimo: number | null };
type PedidoResumo = { id: string; numero: number; status: StatusPedido; data_emissao: string; cliente_nome: string; cliente_fantasia: string | null;
  valor_total: number; motivo_trava: string | null; origem: string };
type Resumo = { vendedor: string | null; vendido: number; pedidos: number; clientes_positivados: number; carteira: number; meta: number | null;
  comissao_percentual: number | null; comissao_prevista: number | null; visitas_sem_pedido: number; dias_uteis_mes: number; dias_uteis_passados: number;
  meta_da_empresa?: boolean; vendedores?: { nome: string; meta: number | null; vendido: number; pedidos: number }[] | null };
type Dados = { carteira: Cliente[]; produtos: Produto[]; precos: Preco[]; pedidos: PedidoResumo[]; resumo: Resumo | null; atualizadoEm: string };
type Carrinho = { clienteId: string | null; itens: Record<string, { qtd: number; preco: number }>; obs: string; entrega: string };

type Aba = "rota" | "clientes" | "pedido" | "pedidos" | "meta";
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
  const [aba, setAba] = useState<Aba>("rota");
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
    const desde = new Date(Date.now() - 45 * 864e5).toISOString();
    const [c, p, pr, pe, re] = await Promise.all([
      supabase.rpc("app_carteira"),
      supabase.rpc("app_produtos"),
      supabase.from("tabelas_preco_itens").select("tabela_preco_id, produto_id, preco, preco_minimo").eq("ativo", true).limit(20000),
      supabase.from("vw_pedidos").select("id, numero, status, data_emissao, cliente_nome, cliente_fantasia, valor_total, motivo_trava, origem")
        .eq("tipo", "pedido").eq("ativo", true).gte("data_emissao", desde).order("numero", { ascending: false }).limit(300),
      supabase.rpc("app_resumo"),
    ]);
    setBaixando(false);
    const erro = c.error ?? p.error ?? pr.error ?? pe.error ?? re.error;
    if (erro) { if (!silencioso) toast.error("Não foi possível atualizar", { description: erro.message }); return; }
    const novo: Dados = {
      carteira: (c.data ?? []) as Cliente[], produtos: (p.data ?? []) as Produto[], precos: (pr.data ?? []) as Preco[],
      pedidos: (pe.data ?? []) as PedidoResumo[], resumo: (re.data ?? null) as Resumo | null, atualizadoEm: new Date().toISOString(),
    };
    setDados(novo);
    await kvSet("dados", novo);
    if (!silencioso) toast.success("Dados atualizados");
  }, [supabase]);

  const enviarFila = useCallback(async () => {
    const r = await sincronizar(supabase, (item, resp) => {
      if (item.tipo === "pedido") {
        const x = resp as { numero: number; status: string; motivo: string | null };
        const nomeCli = String(item.resumo.cliente ?? "");
        if (x?.status === "aprovado") toast.success(`Pedido ${x.numero} de ${nomeCli} aprovado`);
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
    const pos = await posicaoAtual(2500);
    const idLocal = novoId();
    const total = itens.reduce((a, [, i]) => a + i.qtd * i.preco, 0);
    await filaPor({
      id: idLocal, tipo: "pedido", rpc: "app_enviar_pedido", criadoEm: new Date().toISOString(), tentativas: 0,
      args: {
        p_id_local: idLocal, p_cliente: cliente.id, p_observacao: carrinho.obs || null, p_data_entrega: carrinho.entrega || null,
        p_itens: itens.map(([produto_id, i]) => ({ produto_id, quantidade: i.qtd, preco: i.preco })),
        p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null,
      },
      resumo: { cliente: cliente.nome, total: r2(total), itens: itens.length },
    });
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
            {aba === "pedidos" && <AbaPedidos dados={dados} fila={fila} onTentar={enviarFila} recarregar={recarregarFila} />}
            {aba === "meta" && <AbaMeta dados={dados} />}
            <p className="mt-6 text-center text-[11px] text-muted">Atualizado em {new Date(dados.atualizadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
          </>
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {([
            ["rota", "Rota", CalendarDays], ["clientes", "Clientes", Users], ["pedido", "Pedido", ShoppingCart],
            ["pedidos", "Pedidos", ClipboardList], ["meta", "Meta", Target],
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
      <div className="mb-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium">{cliente.nome}</div>
            <div className="text-xs text-muted">{[cliente.condicao_nome, cliente.forma_nome].filter(Boolean).join(" · ") || "Pagamento padrão"}</div>
          </div>
          <button onClick={() => setCarrinho(VAZIO)} className="rounded p-1 text-muted hover:text-ink" aria-label="Trocar cliente"><X size={18} /></button>
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

      <Dialogo aberto={revisando} titulo={`Pedido · ${cliente.nome}`} aoFechar={() => setRevisando(false)}
        rodape={<>
          <Button onClick={() => setRevisando(false)}>Voltar</Button>
          <Button variante="primario" disabled={enviando || !itens.length} onClick={async () => { setEnviando(true); await onEnviar(); setEnviando(false); setRevisando(false); }}>
            <Check size={16} /> {enviando ? "Enviando..." : "Enviar pedido"}
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
          <div><Label htmlFor="ped-entrega">Entrega desejada</Label><Input id="ped-entrega" type="date" min={hojeIso()} value={carrinho.entrega} onChange={(e) => setCarrinho((c) => ({ ...c, entrega: e.target.value }))} /></div>
          <div><Label htmlFor="ped-obs">Observação</Label><Textarea id="ped-obs" className="min-h-16" value={carrinho.obs} onChange={(e) => setCarrinho((c) => ({ ...c, obs: e.target.value }))} /></div>
        </div>
      </Dialogo>
    </>
  );
}

// ---------------------------------------------------------------------
function AbaPedidos({ dados, fila, onTentar, recarregar }: { dados: Dados; fila: ItemFila[]; onTentar: () => Promise<unknown>; recarregar: () => Promise<void> }) {
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
                    <div className="font-medium">{f.tipo === "pedido" ? "Pedido" : "Visita"} · {String(f.resumo.cliente ?? "")}</div>
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
      <h2 className="mb-2 text-sm font-semibold">Pedidos dos últimos 45 dias</h2>
      {dados.pedidos.length === 0 ? <p className="py-8 text-center text-sm text-muted">Nenhum pedido ainda.</p> : (
        <ul className="divide-y divide-line/70 rounded-lg border border-line bg-surface">
          {dados.pedidos.map((p) => {
            const st = STATUS_PEDIDO[p.status];
            return (
              <li key={p.id} className="px-3 py-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.cliente_fantasia || p.cliente_nome}</div>
                    <div className="text-xs text-muted">Nº {p.numero} · {formatarData(p.data_emissao)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular">{formatarMoeda(p.valor_total)}</div>
                    <Badge tom={st.tom}>{st.rotulo}</Badge>
                  </div>
                </div>
                {p.motivo_trava && ["rascunho", "aguardando_credito"].includes(p.status) && <p className="mt-1 text-xs text-warn">{p.motivo_trava}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function AbaMeta({ dados }: { dados: Dados }) {
  const r = dados.resumo;
  if (!r) return <p className="py-8 text-center text-sm text-muted">Sem resumo. Atualize com internet.</p>;
  const vendido = Number(r.vendido);
  const meta = r.meta ? Number(r.meta) : null;
  const projecao = r.dias_uteis_passados > 0 ? (vendido / r.dias_uteis_passados) * r.dias_uteis_mes : vendido;
  const falta = meta ? Math.max(0, meta - vendido) : null;
  const diasRestantes = Math.max(0, r.dias_uteis_mes - r.dias_uteis_passados);
  const mes = new Date().toLocaleDateString("pt-BR", { month: "long" });
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Resultado de {mes}</h1>
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="text-xs text-muted">{r.meta_da_empresa ? "Vendido no mês · empresa toda" : "Vendido no mês"}</div>
        <div className="tabular text-2xl font-semibold">{formatarMoeda(vendido)}</div>
        {meta ? (
          <>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={meta} aria-valuenow={vendido} aria-label="Meta do mês">
              <div className={cn("h-full rounded-full", vendido >= meta ? "bg-ok" : "bg-accent")} style={{ width: `${Math.min(100, (vendido / meta) * 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>{Math.round((vendido / meta) * 100)}% da meta {r.meta_da_empresa ? "da empresa" : ""} de {formatarMoeda(meta)}</span>
              {falta! > 0 && <span>faltam {formatarMoeda(falta)}</span>}
            </div>
            {falta! > 0 && diasRestantes > 0 && <p className="mt-2 text-sm">Para bater a meta: <b className="tabular">{formatarMoeda(falta! / diasRestantes)}</b> por dia útil nos {diasRestantes} dias que restam.</p>}
          </>
        ) : <p className="mt-1 text-xs text-muted">{r.meta_da_empresa ? "Sem meta para o mês. Lance em Vendas › Metas no sistema." : "Sem meta para o mês. Peça ao escritório para lançar."}</p>}
        <p className="mt-2 text-xs text-muted">No ritmo atual, o mês fecha em <span className="tabular font-medium text-ink">{formatarMoeda(projecao)}</span>.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Pedidos", String(r.pedidos)],
          ["Clientes que compraram", `${r.clientes_positivados} de ${r.carteira}`],
          ["Ticket médio", r.pedidos ? formatarMoeda(vendido / r.pedidos) : "—"],
          ["Visitas sem pedido", String(r.visitas_sem_pedido)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="tabular text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {!!r.vendedores?.length && (
        <div className="rounded-lg border border-line bg-surface">
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
        </div>
      )}
      {r.comissao_prevista !== null && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-muted">Comissão prevista ({formatarNumero(r.comissao_percentual ?? 0)}%)</div>
          <div className="tabular text-xl font-semibold text-ok">{formatarMoeda(r.comissao_prevista)}</div>
          <p className="text-xs text-muted">Sobre pedidos confirmados no mês. O valor final depende das entregas.</p>
        </div>
      )}
    </div>
  );
}
