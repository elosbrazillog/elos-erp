"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, CloudOff, LocateFixed, LocateOff, MapPin, MapPinCheck, MessageCircle, Navigation, Phone, Undo2 } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Textarea, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, formatarData, formatarMoeda, formatarNumero, formatarTelefone } from "@/lib/utils";
import { enderecoTexto, linkMapa, mensagemErro, situacaoEntrega } from "@/lib/pedidos";
import type { Carga } from "@/components/expedicao/ListaCargas";
import { filaPor, filaTodos, kvGet, kvSet, novoId, posicaoAtual, registrarServiceWorker, sincronizar } from "@/lib/offline";

type Entrega = {
  id: string; pedido_id: string; ordem_entrega: number; status_entrega: string; motivo_devolucao: string | null; entregue_em: string | null;
  pedido_numero: number; valor_total: number; peso_total_kg: number; observacao: string | null; condicao_nome: string | null; forma_nome: string | null;
  cliente_codigo: number; cliente_nome: string; cliente_fantasia: string | null; telefone: string | null; whatsapp: string | null;
  logradouro: string | null; endereco_numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null;
  referencia: string | null; latitude: number | null; longitude: number | null; etapa: string | null;
  recebe_na_entrega: TipoRec | null; recebido_dinheiro: number; recebido_pix: number; recebido_cartao: number;
};
type TipoRec = "dinheiro" | "pix" | "cartao";
type Recebimento = { tipo: TipoRec; valor: number; texto?: string };
const txt = (v: number) => v.toFixed(2).replace(".", ",");
const NOME_REC: Record<TipoRec, string> = { dinheiro: "Dinheiro", pix: "PIX", cartao: "Cartão" };
type Item = { pedido_id: string; produto_codigo: string; produto_nome: string; unidade: string | null; quantidade: number };

const MOTIVOS = ["Produto descongelado", "Avaria na embalagem", "Cliente recusou", "Pedido errado", "Sem dinheiro para pagar"];

export function Entregas({ motoristaId, cargaInicial, podeRegistrar }: { motoristaId: string | null; cargaInicial: string | null; podeRegistrar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [cargas, setCargas] = useState<Carga[] | null>(null);
  const [cargaId, setCargaId] = useState<string | null>(cargaInicial);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [itens, setItens] = useState<Item[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [naoEntregue, setNaoEntregue] = useState<Entrega | null>(null);
  const [tipo, setTipo] = useState<"devolvido_total" | "ausente">("devolvido_total");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [online, setOnline] = useState(true);
  const [aEnviar, setAEnviar] = useState(0);
  const [gps, setGps] = useState<"ativo" | "negado" | "indisponivel" | null>(null);
  const [recebendo, setRecebendo] = useState<Entrega | null>(null);
  const [recs, setRecs] = useState<Recebimento[]>([]);
  const chaveCache = `entregas:${motoristaId ?? "todos"}`;

  // Carrega da rede; sem sinal, usa a última cópia guardada no aparelho
  useEffect(() => {
    registrarServiceWorker();
    setOnline(navigator.onLine);
    let q = supabase.from("vw_expedicoes").select("*").eq("status", "em_rota").order("data").order("numero");
    if (motoristaId) q = q.eq("motorista_id", motoristaId);
    q.then(async ({ data, error }) => {
      let cs = (data ?? []) as Carga[];
      if (error) {
        const salvo = await kvGet<{ cargas: Carga[] }>(chaveCache);
        if (!salvo) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
        cs = salvo.cargas;
        toast.info("Sem sinal: mostrando as entregas guardadas no aparelho.");
      } else {
        const salvo = (await kvGet<Record<string, unknown>>(chaveCache)) ?? {};
        await kvSet(chaveCache, { ...salvo, cargas: cs });
      }
      setCargas(cs);
      setCargaId((atual) => (atual && cs.some((c) => c.id === atual) ? atual : cs[0]?.id ?? null));
    });
  }, [supabase, motoristaId, chaveCache]);

  const carregar = useCallback(async () => {
    if (!cargaId) return;
    const [e, i] = await Promise.all([
      supabase.from("vw_expedicao_pedidos").select("*").eq("expedicao_id", cargaId).order("ordem_entrega"),
      supabase.from("vw_expedicao_itens").select("pedido_id, produto_codigo, produto_nome, unidade, quantidade").eq("expedicao_id", cargaId).order("ordem"),
    ]);
    let es = (e.data ?? []) as Entrega[];
    let its = (i.data ?? []) as Item[];
    const salvo = (await kvGet<Record<string, unknown>>(chaveCache)) ?? {};
    if (e.error) {
      const c = salvo[`carga:${cargaId}`] as { entregas: Entrega[]; itens: Item[] } | undefined;
      if (c) { es = c.entregas; its = c.itens; }
    } else {
      await kvSet(chaveCache, { ...salvo, [`carga:${cargaId}`]: { entregas: es, itens: its } });
    }
    // registros ainda na fila aparecem como feitos
    const fila = await filaTodos();
    setAEnviar(fila.filter((f) => f.tipo === "entrega").length);
    const daFila = fila.filter((f) => f.tipo === "entrega");
    const naFila = new Map(daFila.filter((f) => f.rpc === "expedicao_registrar_entrega").map((f) => [String(f.args.p_expedicao_pedido), String(f.args.p_resultado)]));
    const etapas = new Map(daFila.filter((f) => f.rpc === "expedicao_etapa").map((f) => [String(f.args.p_expedicao_pedido), String(f.args.p_etapa)]));
    const recFila = new Map(daFila.filter((f) => f.rpc === "expedicao_registrar_entrega" && Array.isArray(f.args.p_recebimentos))
      .map((f) => [String(f.args.p_expedicao_pedido), f.args.p_recebimentos as Recebimento[]]));
    es = es.map((x) => {
      const r = recFila.get(x.id);
      if (!r || x.status_entrega !== "pendente") return x;
      const s = (t: TipoRec) => r.filter((y) => y.tipo === t).reduce((a, y) => a + Number(y.valor), 0);
      return { ...x, recebido_dinheiro: s("dinheiro"), recebido_pix: s("pix"), recebido_cartao: s("cartao") };
    });
    es = es.map((x) => (naFila.has(x.id) && x.status_entrega === "pendente" ? { ...x, status_entrega: naFila.get(x.id)! }
      : etapas.has(x.id) && x.status_entrega === "pendente" ? { ...x, etapa: etapas.get(x.id)! } : x));
    setEntregas(es);
    setItens(its);
    setAberta((a) => a ?? es.find((x) => x.status_entrega === "pendente")?.id ?? null);
  }, [supabase, cargaId, chaveCache]);

  useEffect(() => { carregar(); }, [carregar]);

  // Envia o que ficou guardado quando o sinal volta
  const enviarFila = useCallback(async () => {
    const r = await sincronizar(supabase);
    if (r.enviados) { toast.success(`${r.enviados} registro(s) enviados`); carregar(); }
    if (r.erros) toast.error("Algum registro não foi aceito. Fale com o escritório.");
    setAEnviar((await filaTodos()).filter((f) => f.tipo === "entrega").length);
  }, [supabase, carregar]);
  useEffect(() => {
    if (navigator.onLine) enviarFila();
    const on = () => { setOnline(true); enviarFila(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [enviarFila]);

  // Posição do motorista para o acompanhamento (no máximo a cada minuto ou a cada 150 m)
  useEffect(() => {
    if (!cargaId || !podeRegistrar || !navigator.geolocation) { if (!navigator.geolocation) setGps("indisponivel"); return; }
    let ultimo: { t: number; lat: number; lng: number } | null = null;
    const dist = (a: number, b: number, c: number, d: number) => {
      const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
      return Math.sqrt(x * x + y * y) * 6371000;
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGps("ativo");
        const { latitude: lat, longitude: lng, accuracy } = p.coords;
        const agora = Date.now();
        if (ultimo && agora - ultimo.t < 60000 && dist(ultimo.lat, ultimo.lng, lat, lng) < 150) return;
        ultimo = { t: agora, lat, lng };
        if (navigator.onLine) supabase.rpc("app_posicao", { p_expedicao: cargaId, p_lat: lat, p_lng: lng, p_precisao: Math.round(accuracy) }).then(() => undefined);
      },
      (err) => setGps(err.code === err.PERMISSION_DENIED ? "negado" : "indisponivel"),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [supabase, cargaId, podeRegistrar]);

  function abrirRecebimento(e: Entrega) {
    setRecs([{ tipo: e.recebe_na_entrega ?? "dinheiro", valor: Number(e.valor_total) }]);
    setRecebendo(e);
  }

  async function registrar(e: Entrega, resultado: "entregue" | "devolvido_total" | "ausente", m?: string, recebimentos?: Recebimento[]) {
    setOcupado(true);
    const pos = await posicaoAtual(3000);
    const args: Record<string, unknown> = { p_expedicao_pedido: e.id, p_resultado: resultado, p_motivo: m || null, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null };
    if (recebimentos?.length) args.p_recebimentos = recebimentos.map((r) => ({ tipo: r.tipo, valor: Math.round(r.valor * 100) / 100 }));
    const nome = e.cliente_fantasia || e.cliente_nome;
    const { data, error } = navigator.onLine
      ? await supabase.rpc("expedicao_registrar_entrega", args)
      : { data: null, error: { message: "Failed to fetch" } };
    setOcupado(false);
    if (error && /Failed to fetch|NetworkError|Load failed|network/i.test(error.message)) {
      await filaPor({ id: novoId(), tipo: "entrega", rpc: "expedicao_registrar_entrega", args, criadoEm: new Date().toISOString(), tentativas: 0, resumo: { cliente: nome, resultado } });
      toast.info(`${nome}: guardado no aparelho. Sobe sozinho quando o sinal voltar.`);
    } else if (error) {
      return toast.error("Não foi possível registrar", { description: mensagemErro(error), duration: 10000 });
    } else {
      toast.success(resultado === "entregue" ? `${nome}: entregue` : resultado === "ausente" ? `${nome}: cliente ausente, volta para o estoque` : `${nome}: devolução registrada`);
      if ((data as { carga_concluida: boolean }).carga_concluida) toast.success("Todas as entregas registradas. Carga concluída.");
    }
    setNaoEntregue(null);
    setRecebendo(null);
    const proxima = entregas.find((x) => x.status_entrega === "pendente" && x.id !== e.id);
    setAberta(proxima?.id ?? null);
    carregar();
  }

  // A caminho / cheguei: avisa o escritório (e guarda no aparelho se estiver sem sinal)
  async function marcarEtapa(e: Entrega, etapa: "a_caminho" | "chegou") {
    setOcupado(true);
    const pos = await posicaoAtual(2500);
    const args = { p_expedicao_pedido: e.id, p_etapa: etapa, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null };
    const nome = e.cliente_fantasia || e.cliente_nome;
    const { error } = navigator.onLine ? await supabase.rpc("expedicao_etapa", args) : { error: { message: "Failed to fetch" } };
    setOcupado(false);
    if (error && /Failed to fetch|NetworkError|Load failed|network/i.test(error.message)) {
      await filaPor({ id: novoId(), tipo: "entrega", rpc: "expedicao_etapa", args, criadoEm: new Date().toISOString(), tentativas: 0, resumo: { cliente: nome, etapa } });
      toast.info(`${nome}: guardado no aparelho.`);
    } else if (error) {
      return toast.error("Não foi possível registrar", { description: mensagemErro(error) });
    } else {
      toast.success(etapa === "a_caminho" ? `A caminho de ${nome}` : `Chegou em ${nome}`);
    }
    setEntregas((es) => es.map((x) => (x.id === e.id ? { ...x, etapa } : etapa === "a_caminho" && x.etapa === "a_caminho" ? { ...x, etapa: "aguardando" } : x)));
  }

  function avisarCliente(e: Entrega) {
    const zap = (e.whatsapp || e.telefone || "").replace(/\D/g, "");
    if (!zap) return;
    const msg = `Olá, ${e.cliente_fantasia || e.cliente_nome}! Aqui é o entregador da Elos: estou a caminho com o seu pedido nº ${e.pedido_numero}.`;
    window.open(`https://wa.me/55${zap}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  }

  const carga = cargas?.find((c) => c.id === cargaId);
  const pendentes = entregas.filter((e) => e.status_entrega === "pendente").length;
  const recebido = (t: "recebido_dinheiro" | "recebido_pix" | "recebido_cartao") => entregas.reduce((a, e) => a + Number(e[t] ?? 0), 0);
  const aReceberDinheiro = entregas.filter((e) => e.status_entrega === "pendente" && e.recebe_na_entrega === "dinheiro").reduce((a, e) => a + Number(e.valor_total), 0);
  const somaRecs = recs.reduce((a, r) => a + (Number(r.valor) || 0), 0);
  const totalRec = Number(recebendo?.valor_total ?? 0);

  return (
    <>
      <Cabecalho trilha="Expedição" titulo="Entregas" />
      {(cargas?.length ?? 0) > 0 && (
        <div className="mx-auto mb-3 flex max-w-2xl flex-wrap gap-2 text-xs">
          {!online && <span className="flex items-center gap-1 rounded-full bg-warn/10 px-2 py-1 text-warn"><CloudOff size={13} /> Sem sinal: os registros ficam guardados</span>}
          {aEnviar > 0 && <span className="rounded-full bg-warn/10 px-2 py-1 text-warn">{aEnviar} registro(s) a enviar</span>}
          {gps === "ativo" && <span className="flex items-center gap-1 rounded-full bg-ok/10 px-2 py-1 text-ok"><LocateFixed size={13} /> Localização ativa</span>}
          {gps === "negado" && <span className="flex items-center gap-1 rounded-full bg-bad/10 px-2 py-1 text-bad"><LocateOff size={13} /> Permita a localização para o escritório acompanhar a rota</span>}
        </div>
      )}
      {cargas === null && <div className="py-10 text-center text-sm text-muted">Carregando...</div>}
      {cargas?.length === 0 && (
        <Card><Vazio titulo="Nenhuma carga em rota" texto={motoristaId ? "Quando uma carga sua sair para entrega, ela aparece aqui." : "Cargas aparecem aqui depois da saída para entrega."} /></Card>
      )}
      {carga && (
        <div className="mx-auto max-w-2xl space-y-3">
          {cargas!.length > 1 && (
            <Select value={cargaId ?? ""} onChange={(e) => { setAberta(null); setCargaId(e.target.value); }} aria-label="Carga">
              {cargas!.map((c) => <option key={c.id} value={c.id}>Carga {c.numero} · {formatarData(c.data)}{c.rota_nome ? ` · ${c.rota_nome}` : ""}{c.motorista_nome ? ` · ${c.motorista_nome}` : ""}</option>)}
            </Select>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Carga {carga.numero}{carga.rota_nome ? ` · ${carga.rota_nome}` : ""}</span>
            <span className="text-muted">{pendentes ? `${pendentes} de ${entregas.length} a entregar` : "Tudo registrado"}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full bg-ok" style={{ width: `${entregas.length ? ((entregas.length - pendentes) / entregas.length) * 100 : 0}%` }} />
          </div>
          <div className={cn("grid grid-cols-3 gap-2 rounded-lg border p-2.5 text-center", pendentes === 0 && entregas.length ? "border-accent bg-accent-soft/50" : "border-line bg-surface")}>
            <div><div className="text-[11px] text-muted">Dinheiro recebido</div><div className="tabular font-semibold">{formatarMoeda(recebido("recebido_dinheiro"))}</div></div>
            <div><div className="text-[11px] text-muted">PIX</div><div className="tabular font-semibold">{formatarMoeda(recebido("recebido_pix"))}</div></div>
            <div><div className="text-[11px] text-muted">Cartão</div><div className="tabular font-semibold">{formatarMoeda(recebido("recebido_cartao"))}</div></div>
            <div className="col-span-3 text-xs text-muted">
              {pendentes === 0 && entregas.length
                ? <>Rota encerrada. Entregue <b className="tabular text-ink">{formatarMoeda(recebido("recebido_dinheiro"))}</b> em dinheiro no escritório para o acerto.</>
                : aReceberDinheiro > 0 ? <>Ainda a receber em dinheiro: <span className="tabular">{formatarMoeda(aReceberDinheiro)}</span></> : null}
            </div>
          </div>

          {entregas.map((e) => {
            const se = situacaoEntrega(e.status_entrega, e.etapa);
            const pendente = e.status_entrega === "pendente";
            const expandida = aberta === e.id;
            const mapa = linkMapa(e);
            const zap = (e.whatsapp || e.telefone || "").replace(/\D/g, "");
            const meus = itens.filter((i) => i.pedido_id === e.pedido_id);
            return (
              <Card key={e.id} className={cn(!pendente && "opacity-70")}>
                <button className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setAberta(expandida ? null : e.id)} aria-expanded={expandida}>
                  <span className={cn("tabular flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                    pendente ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted")}>{e.ordem_entrega}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{e.cliente_fantasia || e.cliente_nome}</div>
                    <div className="text-sm text-muted">{enderecoTexto(e) || "Sem endereço cadastrado"}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className="tabular font-medium">{formatarMoeda(e.valor_total)}</span>
                      {e.forma_nome && <span className="text-muted">· {e.forma_nome}{e.condicao_nome ? ` ${e.condicao_nome}` : ""}</span>}
                      {(!pendente || (e.etapa && e.etapa !== "aguardando")) && <Badge tom={se.tom}>{se.rotulo}</Badge>}
                    </div>
                  </div>
                  <ChevronDown size={18} className={cn("mt-1 shrink-0 text-muted transition-transform", expandida && "rotate-180")} />
                </button>

                {expandida && (
                  <div className="space-y-3 border-t border-line px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {mapa && <a href={mapa} target="_blank" rel="noreferrer"><Button tamanho="p"><MapPin size={15} /> Mapa</Button></a>}
                      {e.telefone && <a href={`tel:${e.telefone.replace(/\D/g, "")}`}><Button tamanho="p"><Phone size={15} /> {formatarTelefone(e.telefone)}</Button></a>}
                      {zap && <a href={`https://wa.me/55${zap}`} target="_blank" rel="noreferrer"><Button tamanho="p"><MessageCircle size={15} /> WhatsApp</Button></a>}
                    </div>
                    {e.referencia && <p className="text-sm"><span className="text-muted">Referência:</span> {e.referencia}</p>}
                    {e.observacao && <p className="text-sm"><span className="text-muted">Obs. do pedido:</span> {e.observacao}</p>}
                    <div>
                      <div className="mb-1 text-xs text-muted">Pedido {e.pedido_numero} · {formatarNumero(e.peso_total_kg)} kg</div>
                      <ul className="divide-y divide-line/70 rounded-md border border-line text-sm">
                        {meus.map((i, k) => (
                          <li key={k} className="flex justify-between gap-3 px-3 py-1.5">
                            <span className="min-w-0 truncate">{i.produto_nome}</span>
                            <span className="tabular shrink-0 font-medium">{formatarNumero(i.quantidade)} {i.unidade}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {e.motivo_devolucao && <p className="text-sm text-warn">{e.motivo_devolucao}</p>}
                    {pendente && podeRegistrar && (e.etapa ?? "aguardando") === "aguardando" && (
                      <Button className="h-11 w-full" disabled={ocupado} onClick={() => marcarEtapa(e, "a_caminho")}><Navigation size={16} /> Ir para este cliente (a caminho)</Button>
                    )}
                    {pendente && podeRegistrar && e.etapa === "a_caminho" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button className="h-11" disabled={!zap} onClick={() => avisarCliente(e)}><MessageCircle size={16} /> Avisar cliente</Button>
                        <Button className="h-11" disabled={ocupado} onClick={() => marcarEtapa(e, "chegou")}><MapPinCheck size={16} /> Cheguei</Button>
                      </div>
                    )}
                    {pendente && podeRegistrar && (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button variante="perigo" className="h-11" disabled={ocupado} onClick={() => { setTipo("devolvido_total"); setMotivo(""); setNaoEntregue(e); }}><Undo2 size={16} /> Não entregue</Button>
                        <Button variante="primario" className="h-11" disabled={ocupado} onClick={() => (e.recebe_na_entrega ? abrirRecebimento(e) : registrar(e, "entregue"))}><Check size={16} /> Entregue</Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialogo aberto={!!recebendo} titulo="Recebimento" descricao={recebendo ? `${recebendo.cliente_fantasia || recebendo.cliente_nome} · pedido ${recebendo.pedido_numero} · ${formatarMoeda(totalRec)}` : undefined}
        aoFechar={() => setRecebendo(null)}
        rodape={<>
          <Button onClick={() => setRecebendo(null)}>Voltar</Button>
          <Button variante="primario" disabled={ocupado || Math.abs(somaRecs - totalRec) > 0.009 || recs.some((r) => !(Number(r.valor) > 0))}
            onClick={() => registrar(recebendo!, "entregue", undefined, recs)}><Check size={16} /> Confirmar entrega</Button>
        </>}>
        <div className="space-y-3">
          {recs.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_9rem] items-end gap-2">
              <div>
                <Label htmlFor={`rec-tipo-${i}`}>{i === 0 ? "Recebeu em" : "E o restante em"}</Label>
                <Select id={`rec-tipo-${i}`} value={r.tipo} onChange={(ev) => setRecs((rs) => rs.map((x, k) => (k === i ? { ...x, tipo: ev.target.value as TipoRec } : x)))}>
                  {(Object.keys(NOME_REC) as TipoRec[]).filter((t) => t === r.tipo || !recs.some((x) => x.tipo === t)).map((t) => <option key={t} value={t}>{NOME_REC[t]}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor={`rec-valor-${i}`}>Valor</Label>
                <Input id={`rec-valor-${i}`} inputMode="decimal" className="tabular h-11 text-right" value={r.texto ?? txt(r.valor)}
                  onChange={(ev) => {
                    const v = Number(ev.target.value.replace(/\./g, "").replace(",", ".")) || 0;
                    const resto = Math.max(0, Math.round((totalRec - v) * 100) / 100);
                    setRecs((rs) => rs.map((x, k) => (k === i ? { ...x, valor: v, texto: ev.target.value } : rs.length === 2 ? { ...x, valor: resto, texto: txt(resto) } : x)));
                  }} />
              </div>
            </div>
          ))}
          {recs.length === 1 ? (
            <Button className="w-full" onClick={() => {
              const outro: TipoRec = recs[0].tipo === "dinheiro" ? "pix" : "dinheiro";
              const metade = Math.round((totalRec / 2) * 100) / 100;
              setRecs([{ ...recs[0], valor: metade, texto: undefined }, { tipo: outro, valor: Math.round((totalRec - metade) * 100) / 100 }]);
            }}>Dividir em dois pagamentos (ex.: parte em dinheiro, parte no PIX)</Button>
          ) : (
            <Button variante="fantasma" className="w-full" onClick={() => setRecs([{ ...recs[0], valor: totalRec, texto: undefined }])}>Voltar para um pagamento só</Button>
          )}
          <div className={cn("flex justify-between rounded p-2 text-sm", Math.abs(somaRecs - totalRec) > 0.009 ? "bg-bad/10 text-bad" : "bg-surface-2")}>
            <span>Total recebido</span>
            <span className="tabular font-semibold">{formatarMoeda(somaRecs)}{Math.abs(somaRecs - totalRec) > 0.009 ? ` · falta fechar ${formatarMoeda(totalRec - somaRecs)}` : ""}</span>
          </div>
        </div>
      </Dialogo>

      <Dialogo aberto={!!naoEntregue} titulo="Não entregue" descricao={naoEntregue ? naoEntregue.cliente_fantasia || naoEntregue.cliente_nome : undefined} aoFechar={() => setNaoEntregue(null)}
        rodape={<>
          <Button onClick={() => setNaoEntregue(null)}>Voltar</Button>
          <Button variante="primario" disabled={ocupado} onClick={() => {
            if (tipo === "devolvido_total" && !motivo.trim()) return toast.error("Informe o motivo da devolução");
            registrar(naoEntregue!, tipo, motivo);
          }}>Registrar</Button>
        </>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="O que aconteceu">
            {([["ausente", "Cliente fechado / ausente", "O pedido volta e vai na próxima carga."], ["devolvido_total", "Cliente devolveu", "O pedido é encerrado como devolvido."]] as const).map(([v, r, a]) => (
              <button key={v} role="radio" aria-checked={tipo === v} onClick={() => setTipo(v)}
                className={cn("rounded-md border p-2.5 text-left text-sm", tipo === v ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2")}>
                <div className="font-medium">{r}</div><div className="text-xs text-muted">{a}</div>
              </button>
            ))}
          </div>
          <div>
            <Label obrigatorio={tipo === "devolvido_total"} htmlFor="motivo-dev">Motivo</Label>
            {tipo === "devolvido_total" && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {MOTIVOS.map((m) => (
                  <button key={m} onClick={() => setMotivo(m)} className={cn("rounded-full border px-2.5 py-1 text-xs", motivo === m ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>{m}</button>
                ))}
              </div>
            )}
            <Textarea id="motivo-dev" className="min-h-16" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
          </div>
          <p className="text-xs text-muted">A mercadoria volta para o estoque no mesmo lote.</p>
        </div>
      </Dialogo>
    </>
  );
}
