"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { toast } from "sonner";
import { Clock, MessageCircle, Phone, RefreshCw, Truck } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Vazio } from "@/components/ui";
import { cn, formatarMoeda } from "@/lib/utils";
import { STATUS_ENTREGA, enderecoTexto, mensagemErro } from "@/lib/pedidos";
import type { PontoMapa, Trilha } from "@/components/expedicao/Mapa";

const Mapa = dynamic(() => import("@/components/expedicao/Mapa").then((m) => m.Mapa), { ssr: false, loading: () => <div className="h-[420px] animate-pulse rounded-lg bg-surface-2" /> });

type Carga = {
  id: string; numero: number; status: string; saiu_em: string | null; concluida_em: string | null; rota_nome: string | null;
  motorista_nome: string | null; motorista_whatsapp: string | null; motorista_telefone: string | null; veiculo_placa: string | null;
  qtd_pedidos: number; entregues: number; pendentes: number; nao_entregues: number; ultima_entrega_em: string | null;
  ultima_latitude: number | null; ultima_longitude: number | null; ultima_posicao_em: string | null;
};
type Entrega = {
  id: string; expedicao_id: string; ordem_entrega: number; status_entrega: string; entregue_em: string | null; motivo_devolucao: string | null;
  pedido_numero: number; valor_total: number; cliente_nome: string; cliente_fantasia: string | null; telefone: string | null; whatsapp: string | null;
  logradouro: string | null; endereco_numero: string | null; bairro: string | null; cidade: string | null; uf: string | null;
  latitude: number | null; longitude: number | null; entrega_latitude: number | null; entrega_longitude: number | null;
};

const COR = { caminhao: "#0b6e8a", entregue: "#1d7f4e", problema: "#c0352b", pendente: "#8a97a6" };
const hora = (v: string | null) => (v ? new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
function haQuanto(v: string | null) {
  if (!v) return null;
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h ${min % 60} min`;
}

export function Acompanhamento() {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [cargas, setCargas] = useState<Carga[] | null>(null);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [trilhas, setTrilhas] = useState<Record<string, [number, number][]>>({});
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [atualizado, setAtualizado] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("vw_acompanhamento").select("*").order("status", { ascending: false }).order("numero");
    if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
    const cs = (data ?? []) as Carga[];
    setCargas(cs);
    const ids = cs.map((c) => c.id);
    if (ids.length) {
      const [e, t] = await Promise.all([
        supabase.from("vw_expedicao_pedidos").select("*").in("expedicao_id", ids).order("ordem_entrega"),
        supabase.from("rastreamento").select("expedicao_id, latitude, longitude, registrado_em").in("expedicao_id", ids)
          .gte("registrado_em", new Date(Date.now() - 18 * 3600e3).toISOString()).order("registrado_em").limit(5000),
      ]);
      setEntregas((e.data ?? []) as Entrega[]);
      const tr: Record<string, [number, number][]> = {};
      for (const p of (t.data ?? []) as { expedicao_id: string; latitude: number; longitude: number }[]) {
        (tr[p.expedicao_id] ??= []).push([Number(p.latitude), Number(p.longitude)]);
      }
      setTrilhas(tr);
    } else {
      setEntregas([]);
      setTrilhas({});
    }
    setAtualizado(new Date());
  }, [supabase]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60000);
    return () => clearInterval(t);
  }, [carregar]);

  const visiveis = (cargas ?? []).filter((c) => !selecionada || c.id === selecionada);
  const pontos: PontoMapa[] = [];
  for (const c of visiveis) {
    for (const e of entregas.filter((x) => x.expedicao_id === c.id)) {
      const lat = e.entrega_latitude ?? e.latitude, lng = e.entrega_longitude ?? e.longitude;
      if (lat === null || lng === null) continue;
      const cor = e.status_entrega === "entregue" ? COR.entregue : e.status_entrega === "pendente" ? COR.pendente : COR.problema;
      pontos.push({ lat: Number(lat), lng: Number(lng), cor, titulo: `${e.ordem_entrega}. ${e.cliente_fantasia || e.cliente_nome} · ${STATUS_ENTREGA[e.status_entrega].rotulo}` });
    }
    if (c.ultima_latitude !== null && c.ultima_longitude !== null && c.status === "em_rota") {
      pontos.push({ lat: Number(c.ultima_latitude), lng: Number(c.ultima_longitude), cor: COR.caminhao, raio: 10, destaque: true,
        titulo: `Carga ${c.numero} · ${c.motorista_nome ?? ""} · ${haQuanto(c.ultima_posicao_em)}` });
    }
  }
  const trilhasMapa: Trilha[] = visiveis.map((c) => ({ pontos: trilhas[c.id] ?? [], cor: COR.caminhao }));
  const semCoordenada = visiveis.reduce((a, c) => a + entregas.filter((e) => e.expedicao_id === c.id && e.latitude === null && e.entrega_latitude === null).length, 0);

  function avisar(e: Entrega, c: Carga) {
    const zap = (e.whatsapp || e.telefone || "").replace(/\D/g, "");
    if (!zap) return toast.error("Cliente sem telefone cadastrado");
    const antes = entregas.filter((x) => x.expedicao_id === c.id && x.status_entrega === "pendente" && x.ordem_entrega < e.ordem_entrega).length;
    const msg = `Olá, ${e.cliente_fantasia || e.cliente_nome}! Seu pedido nº ${e.pedido_numero} da Elos já saiu para entrega` +
      (antes > 0 ? ` e há ${antes} ${antes === 1 ? "entrega" : "entregas"} antes da sua.` : " e você é a próxima entrega.") +
      (c.motorista_nome ? ` Motorista: ${c.motorista_nome}.` : "");
    window.open(`https://wa.me/55${zap}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  }

  return (
    <>
      <Cabecalho trilha="Expedição" titulo="Acompanhamento de entregas"
        acoes={<>
          {atualizado && <span className="self-center text-xs text-muted">Atualiza sozinho a cada minuto · {hora(atualizado.toISOString())}</span>}
          <Button onClick={carregar}><RefreshCw size={16} /> Atualizar</Button>
        </>} />

      {cargas === null ? <div className="py-10 text-center text-sm text-muted">Carregando...</div>
        : cargas.length === 0 ? (
          <Card><Vazio titulo="Nenhuma carga em rota agora" texto="As cargas aparecem aqui quando saem para entrega, e ficam até o fim do dia depois de concluídas."
            acao={<Link href="/expedicao/cargas"><Button>Ir para cargas</Button></Link>} /></Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="space-y-3">
              <Mapa pontos={pontos} trilhas={trilhasMapa} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                {[["Caminhão (última posição)", COR.caminhao], ["Entregue", COR.entregue], ["Não entregue", COR.problema], ["A entregar", COR.pendente]].map(([r, c]) => (
                  <span key={r} className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full" style={{ background: c }} />{r}</span>
                ))}
                {semCoordenada > 0 && <span>· {semCoordenada} {semCoordenada === 1 ? "cliente ainda sem localização" : "clientes ainda sem localização"} (o sistema aprende na primeira entrega)</span>}
              </div>
            </div>

            <div className="space-y-3">
              {cargas.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setSelecionada(null)} className={cn("rounded-full border px-3 py-1 text-xs", !selecionada ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>Todas</button>
                  {cargas.map((c) => (
                    <button key={c.id} onClick={() => setSelecionada(c.id)} className={cn("rounded-full border px-3 py-1 text-xs", selecionada === c.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
                      Carga {c.numero}
                    </button>
                  ))}
                </div>
              )}
              {visiveis.map((c) => {
                const minhas = entregas.filter((e) => e.expedicao_id === c.id);
                const feitas = c.entregues + c.nao_entregues;
                const semSinal = c.status === "em_rota" && (!c.ultima_posicao_em || Date.now() - new Date(c.ultima_posicao_em).getTime() > 20 * 60000);
                const zapMot = (c.motorista_whatsapp || c.motorista_telefone || "").replace(/\D/g, "");
                return (
                  <Card key={c.id}>
                    <div className="border-b border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link href={`/expedicao/cargas/${c.id}`} className="font-medium hover:text-accent">Carga {c.numero}{c.rota_nome ? ` · ${c.rota_nome}` : ""}</Link>
                          <div className="text-xs text-muted">{[c.motorista_nome, c.veiculo_placa].filter(Boolean).join(" · ")}{c.saiu_em && ` · saiu ${hora(c.saiu_em)}`}</div>
                        </div>
                        {c.status === "concluida" ? <Badge tom="ok">Concluída {hora(c.concluida_em)}</Badge> : <Badge tom="aviso">Em rota</Badge>}
                      </div>
                      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={c.qtd_pedidos} aria-valuenow={feitas} aria-label="Entregas feitas">
                        <div className="h-full bg-ok" style={{ width: `${(c.entregues / Math.max(1, c.qtd_pedidos)) * 100}%` }} />
                        <div className="h-full bg-bad" style={{ width: `${(c.nao_entregues / Math.max(1, c.qtd_pedidos)) * 100}%` }} />
                      </div>
                      <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted">
                        <span>{c.entregues} entregues · {c.nao_entregues} não entregues · {c.pendentes} a entregar</span>
                        {c.status === "em_rota" && (
                          <span className={cn("flex items-center gap-1", semSinal && "text-warn")}>
                            <Truck size={12} /> {c.ultima_posicao_em ? `posição ${haQuanto(c.ultima_posicao_em)}` : "sem posição ainda"}
                          </span>
                        )}
                      </div>
                      {c.status === "em_rota" && zapMot && (
                        <div className="mt-2 flex gap-2">
                          <a href={`tel:${zapMot}`}><Button tamanho="p"><Phone size={14} /> Motorista</Button></a>
                          <a href={`https://wa.me/55${zapMot}`} target="_blank" rel="noreferrer"><Button tamanho="p"><MessageCircle size={14} /> WhatsApp</Button></a>
                        </div>
                      )}
                    </div>
                    <ol className="divide-y divide-line/70">
                      {minhas.map((e) => {
                        const st = STATUS_ENTREGA[e.status_entrega];
                        return (
                          <li key={e.id} className="flex items-start gap-2.5 px-3 py-2 text-sm">
                            <span className={cn("tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                              e.status_entrega === "entregue" ? "bg-ok/15 text-ok" : e.status_entrega === "pendente" ? "bg-surface-2 text-muted" : "bg-bad/10 text-bad")}>{e.ordem_entrega}</span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{e.cliente_fantasia || e.cliente_nome}</div>
                              <div className="truncate text-xs text-muted">{enderecoTexto(e) || "Sem endereço"}</div>
                              {e.motivo_devolucao && e.status_entrega !== "entregue" && <div className="text-xs text-bad">{e.motivo_devolucao}</div>}
                            </div>
                            <div className="shrink-0 text-right text-xs">
                              <div className="tabular text-sm">{formatarMoeda(e.valor_total)}</div>
                              {e.entregue_em ? <span className="flex items-center justify-end gap-1 text-muted"><Clock size={11} />{hora(e.entregue_em)}</span> : <Badge tom={st.tom}>{st.rotulo}</Badge>}
                              {e.status_entrega !== "pendente" && e.entregue_em && <div><Badge tom={st.tom}>{st.rotulo}</Badge></div>}
                            </div>
                            {e.status_entrega === "pendente" && c.status === "em_rota" && (
                              <Button tamanho="p" variante="fantasma" onClick={() => avisar(e, c)} aria-label={`Avisar ${e.cliente_fantasia || e.cliente_nome} pelo WhatsApp`} title="Avisar o cliente pelo WhatsApp">
                                <MessageCircle size={15} />
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
    </>
  );
}
