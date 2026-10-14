"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, MapPin, MessageCircle, Phone, Undo2 } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Label, Select, Textarea, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, formatarData, formatarMoeda, formatarNumero, formatarTelefone } from "@/lib/utils";
import { STATUS_ENTREGA, enderecoTexto, linkMapa, mensagemErro } from "@/lib/pedidos";
import type { Carga } from "@/components/expedicao/ListaCargas";

type Entrega = {
  id: string; pedido_id: string; ordem_entrega: number; status_entrega: string; motivo_devolucao: string | null; entregue_em: string | null;
  pedido_numero: number; valor_total: number; peso_total_kg: number; observacao: string | null; condicao_nome: string | null; forma_nome: string | null;
  cliente_codigo: number; cliente_nome: string; cliente_fantasia: string | null; telefone: string | null; whatsapp: string | null;
  logradouro: string | null; endereco_numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null;
  referencia: string | null; latitude: number | null; longitude: number | null;
};
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

  useEffect(() => {
    let q = supabase.from("vw_expedicoes").select("*").eq("status", "em_rota").order("data").order("numero");
    if (motoristaId) q = q.eq("motorista_id", motoristaId);
    q.then(({ data, error }) => {
      if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
      const cs = (data ?? []) as Carga[];
      setCargas(cs);
      setCargaId((atual) => (atual && cs.some((c) => c.id === atual) ? atual : cs[0]?.id ?? null));
    });
  }, [supabase, motoristaId]);

  const carregar = useCallback(async () => {
    if (!cargaId) return;
    const [e, i] = await Promise.all([
      supabase.from("vw_expedicao_pedidos").select("*").eq("expedicao_id", cargaId).order("ordem_entrega"),
      supabase.from("vw_expedicao_itens").select("pedido_id, produto_codigo, produto_nome, unidade, quantidade").eq("expedicao_id", cargaId).order("ordem"),
    ]);
    const es = (e.data ?? []) as Entrega[];
    setEntregas(es);
    setItens((i.data ?? []) as Item[]);
    setAberta((a) => a ?? es.find((x) => x.status_entrega === "pendente")?.id ?? null);
  }, [supabase, cargaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function registrar(e: Entrega, resultado: "entregue" | "devolvido_total" | "ausente", m?: string) {
    setOcupado(true);
    const { data, error } = await supabase.rpc("expedicao_registrar_entrega", { p_expedicao_pedido: e.id, p_resultado: resultado, p_motivo: m || null });
    setOcupado(false);
    if (error) return toast.error("Não foi possível registrar", { description: mensagemErro(error), duration: 10000 });
    const nome = e.cliente_fantasia || e.cliente_nome;
    toast.success(resultado === "entregue" ? `${nome}: entregue` : resultado === "ausente" ? `${nome}: cliente ausente, volta para o estoque` : `${nome}: devolução registrada`);
    if ((data as { carga_concluida: boolean }).carga_concluida) toast.success("Todas as entregas registradas. Carga concluída.");
    setNaoEntregue(null);
    const proxima = entregas.find((x) => x.status_entrega === "pendente" && x.id !== e.id);
    setAberta(proxima?.id ?? null);
    carregar();
  }

  const carga = cargas?.find((c) => c.id === cargaId);
  const pendentes = entregas.filter((e) => e.status_entrega === "pendente").length;

  return (
    <>
      <Cabecalho trilha="Expedição" titulo="Entregas" />
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

          {entregas.map((e) => {
            const se = STATUS_ENTREGA[e.status_entrega];
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
                      {!pendente && <Badge tom={se.tom}>{se.rotulo}</Badge>}
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
                    {pendente && podeRegistrar && (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button variante="perigo" className="h-11" disabled={ocupado} onClick={() => { setTipo("devolvido_total"); setMotivo(""); setNaoEntregue(e); }}><Undo2 size={16} /> Não entregue</Button>
                        <Button variante="primario" className="h-11" disabled={ocupado} onClick={() => registrar(e, "entregue")}><Check size={16} /> Entregue</Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

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
