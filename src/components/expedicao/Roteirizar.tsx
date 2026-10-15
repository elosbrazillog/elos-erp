"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { LocateFixed, MapPinned, Route } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";
import { CENTRO_CAMPO_GRANDE, geocodificar, percursoKm, roteirizar, type Ponto } from "@/lib/rota";
import { posicaoAtual } from "@/lib/offline";
import type { PontoMapa } from "@/components/expedicao/Mapa";

const Mapa = dynamic(() => import("@/components/expedicao/Mapa").then((m) => m.Mapa), { ssr: false, loading: () => <div className="h-[320px] animate-pulse rounded-lg bg-surface-2" /> });

type Parada = {
  id: string; pedido_id: string; ordem_entrega: number; cliente_nome: string; cliente_fantasia: string | null;
  logradouro: string | null; endereco_numero: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null;
  latitude: number | null; longitude: number | null; coordenada_fonte: string | null;
};

/** Ordena as entregas da carga pelo menor percurso a partir do ponto de saída */
export function Roteirizar({ cargaId, aberto, aoFechar, aoAplicar }: { cargaId: string; aberto: boolean; aoFechar: () => void; aoAplicar: () => void }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [paradas, setParadas] = useState<Parada[] | null>(null);
  const [origem, setOrigem] = useState<{ lat: number; lng: number } | null>(null);
  const [origemPadrao, setOrigemPadrao] = useState(false);
  const [localizando, setLocalizando] = useState<{ feitos: number; total: number } | null>(null);
  const [aplicando, setAplicando] = useState(false);

  async function carregar() {
    const [p, e] = await Promise.all([
      supabase.from("vw_expedicao_pedidos")
        .select("id, pedido_id, ordem_entrega, cliente_nome, cliente_fantasia, logradouro, endereco_numero, bairro, cidade, uf, cep, latitude, longitude, coordenada_fonte")
        .eq("expedicao_id", cargaId).order("ordem_entrega"),
      supabase.from("empresas").select("latitude, longitude").limit(1).maybeSingle(),
    ]);
    if (p.error) return toast.error("Não foi possível carregar as entregas", { description: mensagemErro(p.error) });
    setParadas((p.data ?? []) as Parada[]);
    const lat = e.data?.latitude, lng = e.data?.longitude;
    if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) { setOrigem({ lat: Number(lat), lng: Number(lng) }); setOrigemPadrao(false); }
    else { setOrigem(CENTRO_CAMPO_GRANDE); setOrigemPadrao(true); }
  }
  useEffect(() => { if (aberto) { setParadas(null); carregar(); } }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const comCoord = (paradas ?? []).filter((p) => p.latitude !== null && p.longitude !== null);
  const semCoord = (paradas ?? []).filter((p) => p.latitude === null || p.longitude === null);
  const pontos: Ponto[] = comCoord.map((p) => ({ id: p.pedido_id, lat: Number(p.latitude), lng: Number(p.longitude) }));
  const atual = [...pontos].sort((a, b) => ordemDe(a.id) - ordemDe(b.id));
  function ordemDe(pedidoId: string) { return paradas?.find((p) => p.pedido_id === pedidoId)?.ordem_entrega ?? 0; }
  const nova = origem ? roteirizar(origem, pontos) : [];
  const kmAtual = origem ? percursoKm(origem, atual) : 0;
  const kmNovo = origem ? percursoKm(origem, nova) : 0;

  async function localizar() {
    const faltam = semCoord;
    setLocalizando({ feitos: 0, total: faltam.length });
    let achados = 0;
    for (let i = 0; i < faltam.length; i++) {
      const p = faltam[i];
      if (i > 0) await new Promise((r) => setTimeout(r, 1100)); // limite do serviço gratuito
      const g = await geocodificar({ logradouro: p.logradouro, numero: p.endereco_numero, bairro: p.bairro, cidade: p.cidade, uf: p.uf, cep: p.cep });
      if (g) {
        const { error } = await supabase.rpc("endereco_coordenada_pedido", { p_pedido: p.pedido_id, p_lat: g.lat, p_lng: g.lng });
        if (!error) {
          achados++;
          setParadas((ps) => ps?.map((x) => (x.id === p.id ? { ...x, latitude: g.lat, longitude: g.lng, coordenada_fonte: "geocodificada" } : x)) ?? ps);
        }
      }
      setLocalizando({ feitos: i + 1, total: faltam.length });
    }
    setLocalizando(null);
    if (achados < faltam.length) toast.warning(`${faltam.length - achados} endereço(s) não encontrados. Eles ficam no fim da rota.`);
    else toast.success("Endereços localizados");
  }

  async function usarMinhaLocalizacao() {
    const pos = await posicaoAtual(8000);
    if (!pos) return toast.error("Não foi possível pegar sua localização. Permita o acesso no navegador.");
    const { error } = await supabase.rpc("empresa_definir_saida", { p_lat: pos.lat, p_lng: pos.lng });
    if (error) return toast.error("Não foi possível salvar o ponto de saída", { description: mensagemErro(error) });
    setOrigem({ lat: pos.lat, lng: pos.lng });
    setOrigemPadrao(false);
    toast.success("Ponto de saída salvo. Vale para as próximas roteirizações.");
  }

  async function aplicar() {
    const resto = [...semCoord].sort((a, b) => `${a.cidade}${a.bairro}`.localeCompare(`${b.cidade}${b.bairro}`) || a.ordem_entrega - b.ordem_entrega);
    const ids = [...nova.map((p) => p.id), ...resto.map((p) => p.pedido_id)];
    setAplicando(true);
    const { error } = await supabase.rpc("expedicao_ordenar", { p_expedicao: cargaId, p_pedidos: ids });
    setAplicando(false);
    if (error) return toast.error("Não foi possível aplicar a rota", { description: mensagemErro(error) });
    toast.success(`Rota aplicada${kmAtual > kmNovo + 0.05 ? `: ${formatarNumero(Math.round((kmAtual - kmNovo) * 10) / 10)} km a menos` : ""}`);
    aoAplicar();
    aoFechar();
  }

  const nome = (id: string) => { const p = paradas?.find((x) => x.pedido_id === id); return p ? p.cliente_fantasia || p.cliente_nome : ""; };
  const pontosMapa: PontoMapa[] = [
    ...(origem ? [{ lat: origem.lat, lng: origem.lng, cor: "#1f2937", titulo: origemPadrao ? "Saída (centro de Campo Grande)" : "Saída (depósito)", rotulo: "S" }] : []),
    ...nova.map((p, i) => ({ lat: p.lat, lng: p.lng, cor: "#d81f26", titulo: `${i + 1}. ${nome(p.id)}`, rotulo: i + 1 })),
  ];

  return (
    <Dialogo aberto={aberto} titulo="Roteirizar entregas" largo aoFechar={aoFechar}
      descricao="Ordena as paradas pelo menor percurso a partir do ponto de saída. Distâncias em linha reta, para comparar."
      rodape={<>
        <Button onClick={aoFechar}>Voltar</Button>
        <Button variante="primario" disabled={!paradas || aplicando || !!localizando || pontos.length < 1} onClick={aplicar}><Route size={16} /> Aplicar esta ordem</Button>
      </>}>
      {!paradas ? <div className="py-8 text-center text-sm text-muted">Carregando...</div> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Saída: {origemPadrao ? "centro de Campo Grande (ponto de saída ainda não definido)" : "depósito"}</span>
            <Button tamanho="p" onClick={usarMinhaLocalizacao}><LocateFixed size={14} /> {origemPadrao ? "Definir com minha localização" : "Atualizar com minha localização"}</Button>
          </div>
          {semCoord.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-warn/40 bg-warn/5 p-2">
              <span>{semCoord.length} {semCoord.length === 1 ? "cliente sem localização" : "clientes sem localização"}: {localizando ? `localizando ${localizando.feitos} de ${localizando.total}...` : "ficam no fim da rota."}</span>
              <Button tamanho="p" disabled={!!localizando} onClick={localizar}><MapPinned size={14} /> Localizar pelo endereço</Button>
            </div>
          )}
          {pontos.length > 0 && (
            <>
              <Mapa pontos={pontosMapa} trilhas={origem ? [{ pontos: [[origem.lat, origem.lng], ...nova.map((p) => [p.lat, p.lng] as [number, number])], cor: "#d81f26" }] : []} altura={320} tracejada />
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded border border-line p-2"><div className="text-xs text-muted">Ordem atual</div><div className="tabular font-semibold">{formatarNumero(Math.round(kmAtual * 10) / 10)} km</div></div>
                <div className="rounded border border-accent/40 bg-accent-soft/40 p-2"><div className="text-xs text-muted">Roteirizada</div><div className="tabular font-semibold">{formatarNumero(Math.round(kmNovo * 10) / 10)} km</div></div>
              </div>
              <ol className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
                {nova.map((p, i) => {
                  const x = paradas.find((y) => y.pedido_id === p.id)!;
                  return <li key={p.id}><b className="tabular">{i + 1}.</b> {nome(p.id)} <span className="text-muted">· {x.bairro ?? ""}{x.coordenada_fonte === "geocodificada" ? " · local aproximado" : ""}</span></li>;
                })}
                {semCoord.map((x, i) => <li key={x.id} className="text-muted"><b className="tabular">{nova.length + i + 1}.</b> {x.cliente_fantasia || x.cliente_nome} · sem localização</li>)}
              </ol>
            </>
          )}
          <p className="text-[11px] text-muted">Mapa © OpenStreetMap. A localização pelo endereço é aproximada; a primeira entrega registrada pelo motorista corrige o ponto do cliente.</p>
        </div>
      )}
    </Dialogo>
  );
}
