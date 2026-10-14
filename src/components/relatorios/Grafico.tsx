"use client";
import { useMemo, useRef, useState } from "react";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import type { Grafico as Def } from "@/lib/relatorios";

type Ponto = { rotulo: string; valor: number };
const fmt = (f: Def["formato"], v: number) => (f === "moeda" ? formatarMoeda(v) : formatarNumero(v));
const curto = (f: Def["formato"], v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : a >= 1e3 ? `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return f === "moeda" ? `R$ ${s}` : s;
};
const ehData = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const rotuloX = (s: string) => (ehData(s) ? formatarData(s).slice(0, 5) : s);

/** Escala "redonda" de 0 até o máximo (ou do mínimo, se houver negativos) */
function escala(min: number, max: number) {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  const passo0 = (hi - lo || 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(passo0));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= passo0)!;
  const ini = Math.floor(lo / passo) * passo, fim = Math.ceil(hi / passo) * passo;
  const ticks: number[] = [];
  for (let t = ini; t <= fim + passo / 2; t += passo) ticks.push(Math.round(t * 100) / 100);
  return { ini, fim, ticks };
}

export function Grafico({ def, linhas }: { def: Def; linhas: Record<string, unknown>[] }) {
  const pontos: Ponto[] = useMemo(() => {
    let ps = linhas.map((l) => ({ rotulo: String(l[def.rotulo] ?? "—"), valor: Number(l[def.valor] ?? 0) }));
    if (def.tipo === "barras") ps = [...ps].sort((a, b) => b.valor - a.valor).slice(0, def.top ?? 20);
    return ps;
  }, [linhas, def]);
  if (!pontos.length) return null;

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-sm font-medium">{def.titulo}</figcaption>
      {def.tipo === "barras" ? <Barras pontos={pontos} formato={def.formato} /> : <Plano pontos={pontos} formato={def.formato} linha={def.tipo === "linha"} />}
    </figure>
  );
}

function Barras({ pontos, formato }: { pontos: Ponto[]; formato: Def["formato"] }) {
  const max = Math.max(...pontos.map((p) => p.valor), 0) || 1;
  const [ativo, setAtivo] = useState<number | null>(null);
  return (
    <ul className="space-y-0.5" onMouseLeave={() => setAtivo(null)}>
      {pontos.map((p, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 rounded px-1 py-[3px] text-xs sm:grid-cols-[minmax(0,14rem)_1fr_auto]"
          onMouseEnter={() => setAtivo(i)} onFocus={() => setAtivo(i)} tabIndex={0}
          aria-label={`${p.rotulo}: ${fmt(formato, p.valor)}`}>
          <span className="truncate text-muted" title={p.rotulo}>{p.rotulo}</span>
          <span className="relative h-3">
            <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-accent transition-opacity"
              style={{ width: `${Math.max(0.5, (Math.max(p.valor, 0) / max) * 100)}%`, opacity: ativo === null || ativo === i ? 1 : 0.45 }} />
          </span>
          <span className="tabular min-w-20 text-right text-ink">{i < 5 || ativo === i ? fmt(formato, p.valor) : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function Plano({ pontos, formato, linha }: { pontos: Ponto[]; formato: Def["formato"]; linha: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [ativo, setAtivo] = useState<number | null>(null);
  const L = 64, R = 12, T = 8, B = 26, W = 720, H = 220;
  const { ini, fim, ticks } = escala(Math.min(...pontos.map((p) => p.valor)), Math.max(...pontos.map((p) => p.valor)));
  const y = (v: number) => T + (H - T - B) * (1 - (v - ini) / (fim - ini || 1));
  const n = pontos.length;
  const banda = (W - L - R) / n;
  const x = (i: number) => L + banda * i + banda / 2;
  const cadaX = Math.max(1, Math.ceil(n / 10));

  function mover(e: React.MouseEvent<SVGSVGElement>) {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setAtivo(Math.max(0, Math.min(n - 1, Math.floor((px - L) / banda))));
  }

  const p = ativo !== null ? pontos[ativo] : null;
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Gráfico" onMouseMove={mover} onMouseLeave={() => setAtivo(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={L - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)">{curto(formato, t)}</text>
          </g>
        ))}
        {pontos.map((pt, i) => (i % cadaX === 0 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{rotuloX(pt.rotulo)}</text>
        ) : null))}
        {linha ? (
          <>
            <polyline fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              points={pontos.map((pt, i) => `${x(i)},${y(pt.valor)}`).join(" ")} />
            {ativo !== null && (
              <>
                <line x1={x(ativo)} x2={x(ativo)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={x(ativo)} cy={y(pontos[ativo].valor)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
              </>
            )}
          </>
        ) : (
          pontos.map((pt, i) => {
            const w = Math.max(2, Math.min(36, banda - 2));
            const y0 = y(0), y1 = y(pt.valor);
            const topo = Math.min(y0, y1), alt = Math.max(1, Math.abs(y1 - y0));
            const r = Math.min(4, w / 2, alt);
            return (
              <path key={i} fill="var(--accent)" opacity={ativo === null || ativo === i ? 1 : 0.45}
                d={pt.valor >= 0
                  ? `M${x(i) - w / 2},${y0} V${topo + r} Q${x(i) - w / 2},${topo} ${x(i) - w / 2 + r},${topo} H${x(i) + w / 2 - r} Q${x(i) + w / 2},${topo} ${x(i) + w / 2},${topo + r} V${y0} Z`
                  : `M${x(i) - w / 2},${y0} V${topo + alt - r} Q${x(i) - w / 2},${topo + alt} ${x(i) - w / 2 + r},${topo + alt} H${x(i) + w / 2 - r} Q${x(i) + w / 2},${topo + alt} ${x(i) + w / 2},${topo + alt - r} V${y0} Z`} />
            );
          })
        )}
      </svg>
      {p && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${(x(ativo!) / W) * 100}%`, transform: `translateX(${ativo! > n / 2 ? "calc(-100% - 8px)" : "8px"})` }}>
          <div className="text-muted">{ehData(p.rotulo) ? formatarData(p.rotulo) : p.rotulo}</div>
          <div className="tabular font-medium">{fmt(formato, p.valor)}</div>
        </div>
      )}
    </div>
  );
}
