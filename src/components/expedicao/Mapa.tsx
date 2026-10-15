"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type * as L from "leaflet";

export type PontoMapa = { lat: number; lng: number; cor: string; raio?: number; titulo: string; destaque?: boolean; rotulo?: string | number };
export type Trilha = { pontos: [number, number][]; cor: string };

const CENTRO_CAMPO_GRANDE: [number, number] = [-20.4697, -54.6201];

/** Mapa (OpenStreetMap) com pontos coloridos e trilhas; ajusta o enquadramento quando os pontos mudam */
export function Mapa({ pontos, trilhas, altura = 420, tracejada }: { pontos: PontoMapa[]; trilhas: Trilha[]; altura?: number; tracejada?: boolean }) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const lib = useRef<typeof L | null>(null);
  const assinatura = JSON.stringify(pontos.map((p) => [p.lat, p.lng])) + JSON.stringify(trilhas.map((t) => t.pontos.length));
  const ultimaAssinatura = useRef("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const Lf = await import("leaflet");
      if (!vivo || !div.current || mapa.current) return;
      lib.current = Lf;
      mapa.current = Lf.map(div.current, { zoomControl: true, attributionControl: true }).setView(CENTRO_CAMPO_GRANDE, 12);
      Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(mapa.current);
      camada.current = Lf.layerGroup().addTo(mapa.current);
      const m = mapa.current;
      new ResizeObserver(() => { m.invalidateSize(); ultimaAssinatura.current = ""; desenhar(); }).observe(div.current);
      desenhar();
    })();
    return () => { vivo = false; mapa.current?.remove(); mapa.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function desenhar() {
    const Lf = lib.current, m = mapa.current, g = camada.current;
    if (!Lf || !m || !g) return;
    g.clearLayers();
    for (const t of trilhas) if (t.pontos.length > 1) Lf.polyline(t.pontos, { color: t.cor, weight: 3, opacity: 0.7, dashArray: tracejada ? "6 6" : undefined }).addTo(g);
    for (const p of pontos) {
      if (p.rotulo !== undefined) {
        const t = String(p.rotulo).replace(/[^0-9A-Za-z]/g, "").slice(0, 3);
        Lf.marker([p.lat, p.lng], {
          icon: Lf.divIcon({
            className: "",
            iconSize: [22, 22],
            html: `<div style="width:22px;height:22px;border-radius:9999px;background:${p.cor};color:#fff;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);font:600 11px/18px system-ui;text-align:center">${t}</div>`,
          }),
        }).bindTooltip(p.titulo).addTo(g);
        continue;
      }
      Lf.circleMarker([p.lat, p.lng], {
        radius: p.raio ?? 7, color: p.destaque ? "#ffffff" : p.cor, weight: p.destaque ? 3 : 2, fillColor: p.cor, fillOpacity: 0.9,
      }).bindTooltip(p.titulo).addTo(g);
    }
    if (assinatura !== ultimaAssinatura.current) {
      ultimaAssinatura.current = assinatura;
      m.invalidateSize(); // o mapa pode ter nascido escondido (diálogo) com tamanho zero
      const todos: [number, number][] = [...pontos.map((p) => [p.lat, p.lng] as [number, number]), ...trilhas.flatMap((t) => t.pontos)];
      if (todos.length === 1) m.setView(todos[0], 14);
      else if (todos.length > 1) m.fitBounds(Lf.latLngBounds(todos), { padding: [30, 30], maxZoom: 15 });
    }
  }

  useEffect(() => { desenhar(); });

  return <div ref={div} style={{ height: altura }} className="z-0 w-full overflow-hidden rounded-lg border border-line" role="region" aria-label="Mapa das entregas" />;
}
