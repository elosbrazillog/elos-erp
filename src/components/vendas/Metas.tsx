"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Vazio } from "@/components/ui";
import { cn, formatarMoeda, formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";

type Linha = {
  vendedor_id: string | null; vendedor_nome: string; meta: number | null; meta_lancada: boolean; meta_cadastro: number | null;
  vendido: number; pedidos: number; clientes: number; carteira: number;
};

const lerValor = (t: string) => {
  const s = t.trim().replace(/[R$\s]/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

function diasUteis(ini: Date) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  let total = 0, passados = 0;
  for (let d = new Date(ini); d.getMonth() === ini.getMonth(); d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue;
    total++;
    if (d <= hoje) passados++;
  }
  return { total, passados };
}

function Barra({ valor, meta }: { valor: number; meta: number | null }) {
  if (!meta) return <div className="h-2 rounded-full bg-surface-2" />;
  const p = Math.min(100, (valor / meta) * 100);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={meta} aria-valuenow={valor} aria-label="Meta atingida">
      <div className={cn("h-full rounded-full", valor >= meta ? "bg-ok" : "bg-accent")} style={{ width: `${p}%` }} />
    </div>
  );
}

function CampoMeta({ valor, placeholder, disabled, onSalvar, rotulo }: {
  valor: number | null; placeholder?: string; disabled?: boolean; rotulo: string; onSalvar: (v: number | null) => Promise<boolean>;
}) {
  const [texto, setTexto] = useState(valor === null ? "" : formatarNumero(valor));
  useEffect(() => setTexto(valor === null ? "" : formatarNumero(valor)), [valor]);
  async function sair() {
    const v = lerValor(texto);
    if (Number.isNaN(v)) { toast.error("Valor de meta inválido"); return setTexto(valor === null ? "" : formatarNumero(valor)); }
    if (v === valor || (v !== null && valor !== null && Math.abs(v - valor) < 0.005)) return;
    if (!(await onSalvar(v))) setTexto(valor === null ? "" : formatarNumero(valor));
  }
  return (
    <Input aria-label={rotulo} inputMode="decimal" className="tabular w-32 text-right" value={texto} placeholder={placeholder} disabled={disabled}
      onChange={(e) => setTexto(e.target.value)} onBlur={sair} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

export function Metas({ podeEditar }: { podeEditar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [mes, setMes] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [metaEmpresa, setMetaEmpresa] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const [l, m] = await Promise.all([
      supabase.rpc("metas_mes", { p_mes: iso(mes) }),
      supabase.from("metas").select("valor").eq("mes", iso(mes)).is("vendedor_id", null).maybeSingle(),
    ]);
    if (l.error) return toast.error("Não foi possível carregar as metas", { description: mensagemErro(l.error) });
    setLinhas((l.data ?? []) as Linha[]);
    setMetaEmpresa(m.data ? Number(m.data.valor) : null);
  }, [supabase, mes]);
  useEffect(() => { setLinhas(null); carregar(); }, [carregar]);

  async function salvar(vendedor: string | null, valor: number | null) {
    const { error } = await supabase.rpc("meta_definir", { p_mes: iso(mes), p_vendedor: vendedor, p_valor: valor });
    if (error) { toast.error("Não foi possível salvar a meta", { description: mensagemErro(error) }); return false; }
    toast.success(valor === null ? "Meta do mês removida" : "Meta salva");
    await carregar();
    return true;
  }

  const lista = linhas ?? [];
  const vendido = lista.reduce((a, l) => a + Number(l.vendido), 0);
  const somaVend = lista.reduce((a, l) => a + Number(l.meta ?? 0), 0);
  const metaTotal = metaEmpresa ?? (somaVend || null);
  const { total, passados } = diasUteis(mes);
  const atual = iso(mes) === iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const futuro = mes > new Date();
  const projecao = atual && passados > 0 ? (vendido / passados) * total : null;
  const restantes = Math.max(0, total - passados);
  const nomeMes = mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const mudar = (n: number) => setMes((d) => new Date(d.getFullYear(), d.getMonth() + n, 1));

  return (
    <>
      <Cabecalho trilha="Vendas" titulo="Metas de venda"
        acoes={
          <div className="flex items-center gap-1">
            <Button variante="fantasma" onClick={() => mudar(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></Button>
            <span className="min-w-36 text-center text-sm font-medium">{nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}</span>
            <Button variante="fantasma" onClick={() => mudar(1)} aria-label="Próximo mês"><ChevronRight size={16} /></Button>
          </div>
        } />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs text-muted">Vendido em {nomeMes}</div>
            <div className="tabular text-2xl font-semibold">{formatarMoeda(vendido)}</div>
            <div className="text-xs text-muted">
              {metaTotal ? `${Math.round((vendido / metaTotal) * 100)}% da meta de ${formatarMoeda(metaTotal)}` : "Sem meta para o mês"}
              {projecao !== null && <> · no ritmo atual fecha em <span className="tabular font-medium text-ink">{formatarMoeda(projecao)}</span></>}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Meta da empresa (R$)
            <CampoMeta rotulo="Meta da empresa" valor={metaEmpresa} disabled={!podeEditar}
              placeholder={somaVend ? formatarNumero(somaVend) : "0,00"} onSalvar={(v) => salvar(null, v)} />
          </label>
        </div>
        <div className="mt-3"><Barra valor={vendido} meta={metaTotal} /></div>
        {metaTotal && atual && vendido < metaTotal && restantes > 0 && (
          <p className="mt-2 text-sm">Para bater a meta: <b className="tabular">{formatarMoeda((metaTotal - vendido) / restantes)}</b> por dia útil nos {restantes} dias que restam.</p>
        )}
        <p className="mt-2 text-xs text-muted">
          Sem meta da empresa lançada, vale a soma das metas dos vendedores. Conta pedidos confirmados (aprovados em diante), pela data de emissão.
        </p>
      </Card>

      <Card>
        {linhas === null ? <div className="py-10 text-center text-sm text-muted">Carregando...</div>
          : lista.length === 0 ? <Vazio titulo="Nenhum vendedor ativo" texto="Marque o papel Vendedor no cadastro da pessoa para ela aparecer aqui." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Vendedor</th>
                    <th className="px-3 py-2 text-right font-medium">Meta do mês (R$)</th>
                    <th className="px-3 py-2 text-right font-medium">Vendido</th>
                    <th className="w-48 px-3 py-2 font-medium">Atingido</th>
                    <th className="px-3 py-2 text-right font-medium">Pedidos</th>
                    <th className="px-3 py-2 text-right font-medium">Clientes</th>
                    {projecao !== null && <th className="px-3 py-2 text-right font-medium">Projeção</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {lista.map((l) => {
                    const meta = l.meta === null ? null : Number(l.meta);
                    const v = Number(l.vendido);
                    const proj = projecao !== null && passados > 0 ? (v / passados) * total : null;
                    return (
                      <tr key={l.vendedor_id ?? "sem"}>
                        <td className="px-3 py-2">
                          <div>{l.vendedor_nome}</div>
                          <div className="text-xs text-muted">{l.vendedor_id ? `${l.carteira} clientes na carteira` : "Pedidos sem vendedor no cadastro"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            {!l.meta_lancada && meta !== null && <Badge>do cadastro</Badge>}
                            {l.vendedor_id && <CampoMeta rotulo={`Meta de ${l.vendedor_nome}`} valor={l.meta_lancada ? meta : null} disabled={!podeEditar}
                              placeholder={l.meta_cadastro ? formatarNumero(l.meta_cadastro) : "0,00"} onSalvar={(x) => salvar(l.vendedor_id, x)} />}
                          </div>
                        </td>
                        <td className="tabular px-3 py-2 text-right">{formatarMoeda(v)}</td>
                        <td className="px-3 py-2">
                          <Barra valor={v} meta={meta} />
                          <div className="mt-0.5 text-xs text-muted">{meta ? `${Math.round((v / meta) * 100)}%` : "sem meta"}</div>
                        </td>
                        <td className="tabular px-3 py-2 text-right">{l.pedidos}</td>
                        <td className="tabular px-3 py-2 text-right">{l.clientes}{l.carteira ? <span className="text-muted"> / {l.carteira}</span> : null}</td>
                        {projecao !== null && (
                          <td className={cn("tabular px-3 py-2 text-right", meta && proj !== null && proj < meta ? "text-warn" : "")}>{proj !== null ? formatarMoeda(proj) : ""}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>
      {podeEditar && !futuro && (
        <p className="mt-3 text-xs text-muted">A meta lançada aqui vale só para {nomeMes}. Deixe em branco para usar a meta mensal do cadastro do vendedor.</p>
      )}
      {podeEditar && futuro && (
        <p className="mt-3 text-xs text-muted">Você pode lançar as metas de meses futuros com antecedência.</p>
      )}
    </>
  );
}
