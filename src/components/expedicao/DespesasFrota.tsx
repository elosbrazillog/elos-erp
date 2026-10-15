"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Fuel, Plus, Trash2 } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Textarea, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, dataLocal, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";
import { useOpcoesCarga } from "@/components/expedicao/ListaCargas";

type Despesa = {
  id: string; data: string; categoria: string; descricao: string | null; valor: number; pago_pelo_motorista: boolean;
  km_atual: number | null; litros: number | null; preco_litro: number | null; combustivel: string | null; tanque_cheio: boolean; posto: string | null;
  veiculo_id: string | null; veiculo_placa: string | null; motorista_nome: string | null; carga_numero: number | null; expedicao_id: string | null;
  km_rodados: number | null; km_por_litro: number | null; custo_km: number | null;
};
type CargaOpcao = { id: string; numero: number; data: string; motorista_id: string | null; veiculo_id: string | null; status: string };

export const CATEGORIAS: Record<string, string> = {
  combustivel: "Combustível", manutencao: "Manutenção", pneu: "Pneu", pedagio: "Pedágio", alimentacao: "Alimentação",
  estacionamento: "Estacionamento", lavagem: "Lavagem", multa: "Multa", outros: "Outros",
};
const COMBUSTIVEIS: Record<string, string> = { diesel_s10: "Diesel S10", diesel: "Diesel", gasolina: "Gasolina", etanol: "Etanol", gnv: "GNV" };
const num = (t: string) => { const s = t.trim().replace(/\./g, "").replace(",", "."); const n = Number(s); return s && Number.isFinite(n) ? n : 0; };
const VAZIO = { categoria: "combustivel", data: "", veiculo_id: "", motorista_id: "", expedicao_id: "", descricao: "", valor: "", pago: false,
  km: "", litros: "", preco: "", combustivel: "diesel_s10", cheio: true, posto: "" };

export function DespesasFrota({ podeLancar, cargaInicial }: { podeLancar: boolean; cargaInicial: string | null }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const opcoes = useOpcoesCarga();
  const [lista, setLista] = useState<Despesa[] | null>(null);
  const [mes, setMes] = useState(() => dataLocal().slice(0, 7));
  const [fVeiculo, setFVeiculo] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState(VAZIO);
  const [cargas, setCargas] = useState<CargaOpcao[]>([]);
  const [ultimoKm, setUltimoKm] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const ini = `${mes}-01`;
    const [a, m] = mes.split("-").map(Number);
    const fim = new Date(a, m, 0).getDate();
    let q = supabase.from("vw_despesas_frota").select("*").gte("data", ini).lte("data", `${mes}-${String(fim).padStart(2, "0")}`);
    if (fVeiculo) q = q.eq("veiculo_id", fVeiculo);
    if (fCategoria) q = q.eq("categoria", fCategoria);
    const { data, error } = await q.order("data", { ascending: false }).order("criado_em", { ascending: false }).limit(2000);
    if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
    setLista((data ?? []) as Despesa[]);
  }, [supabase, mes, fVeiculo, fCategoria]);
  useEffect(() => { carregar(); }, [carregar]);

  const abrir = useCallback(async (cargaId?: string | null) => {
    const { data } = await supabase.from("vw_expedicoes").select("id, numero, data, motorista_id, veiculo_id, status")
      .in("status", ["separando", "em_rota", "concluida"]).order("data", { ascending: false }).order("numero", { ascending: false }).limit(40);
    const cs = (data ?? []) as CargaOpcao[];
    setCargas(cs);
    const c = cs.find((x) => x.id === cargaId);
    setF({ ...VAZIO, data: dataLocal(), expedicao_id: c?.id ?? "", veiculo_id: c?.veiculo_id ?? "", motorista_id: c?.motorista_id ?? "", pago: !!c });
    setAberto(true);
  }, [supabase]);
  useEffect(() => { if (cargaInicial && podeLancar) abrir(cargaInicial); }, [cargaInicial, podeLancar, abrir]);

  // último km do veículo, para orientar
  useEffect(() => {
    if (!aberto || !f.veiculo_id) { setUltimoKm(null); return; }
    supabase.from("despesas_frota").select("km_atual").eq("veiculo_id", f.veiculo_id).eq("categoria", "combustivel").eq("ativo", true)
      .order("km_atual", { ascending: false }).limit(1).maybeSingle().then(({ data }) => setUltimoKm(data?.km_atual ?? null));
  }, [supabase, aberto, f.veiculo_id]);

  const comb = f.categoria === "combustivel";
  const valorComb = Math.round(num(f.litros) * num(f.preco) * 100) / 100;
  const kmNum = Number(f.km.replace(/\D/g, "")) || 0;
  const rodados = ultimoKm !== null && kmNum > ultimoKm ? kmNum - ultimoKm : null;

  async function salvar() {
    if (comb) {
      if (!f.veiculo_id) return toast.error("Informe o veículo");
      if (!kmNum) return toast.error("Informe o km atual");
      if (ultimoKm !== null && kmNum <= ultimoKm) return toast.error(`O km atual precisa ser maior que ${formatarNumero(ultimoKm)}`);
      if (num(f.litros) <= 0) return toast.error("Informe os litros abastecidos");
      if (num(f.preco) <= 0) return toast.error("Informe o valor pago no litro");
    } else {
      if (num(f.valor) <= 0) return toast.error("Informe o valor");
      if (f.categoria === "outros" && !f.descricao.trim()) return toast.error("Descreva a despesa");
    }
    setSalvando(true);
    const { error } = await supabase.rpc("despesa_frota_lancar", {
      p_categoria: f.categoria, p_valor: comb ? null : num(f.valor), p_data: f.data || null, p_veiculo: f.veiculo_id || null,
      p_motorista: f.motorista_id || null, p_expedicao: f.expedicao_id || null, p_descricao: f.descricao || null, p_pago_pelo_motorista: f.pago,
      p_km_atual: comb ? kmNum : null, p_litros: comb ? num(f.litros) : null, p_preco_litro: comb ? num(f.preco) : null,
      p_combustivel: comb ? f.combustivel : null, p_tanque_cheio: f.cheio, p_posto: comb ? f.posto || null : null,
    });
    setSalvando(false);
    if (error) return toast.error("Não foi possível lançar", { description: mensagemErro(error), duration: 10000 });
    toast.success(comb ? `Abastecimento lançado: ${formatarMoeda(valorComb)}` : "Despesa lançada");
    setAberto(false);
    carregar();
  }

  async function excluir(d: Despesa) {
    if (!confirm(`Excluir ${CATEGORIAS[d.categoria].toLowerCase()} de ${formatarMoeda(d.valor)}?`)) return;
    const { error } = await supabase.rpc("despesa_frota_excluir", { p_id: d.id });
    if (error) return toast.error("Não foi possível excluir", { description: mensagemErro(error) });
    toast.success("Despesa excluída");
    carregar();
  }

  const ls = lista ?? [];
  const total = ls.reduce((a, d) => a + Number(d.valor), 0);
  const combs = ls.filter((d) => d.categoria === "combustivel");
  const totalComb = combs.reduce((a, d) => a + Number(d.valor), 0);
  const litros = combs.reduce((a, d) => a + Number(d.litros ?? 0), 0);
  const comConsumo = combs.filter((d) => d.km_rodados && d.tanque_cheio);
  const kmTot = comConsumo.reduce((a, d) => a + Number(d.km_rodados), 0);
  const ltTot = comConsumo.reduce((a, d) => a + Number(d.litros), 0);
  const kmRodadosMes = combs.reduce((a, d) => a + Number(d.km_rodados ?? 0), 0);
  const nomeMes = new Date(`${mes}-15T12:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <>
      <Cabecalho trilha="Expedição" titulo="Despesas da frota"
        acoes={podeLancar && <Button variante="primario" onClick={() => abrir(null)}><Plus size={16} /> Lançar despesa</Button>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="w-44" aria-label="Mês" />
        <Select value={fVeiculo} onChange={(e) => setFVeiculo(e.target.value)} className="w-40" aria-label="Veículo">
          <option value="">Todos os veículos</option>{opcoes.veiculos.map((v) => <option key={v.valor} value={v.valor}>{v.rotulo}</option>)}
        </Select>
        <Select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} className="w-44" aria-label="Categoria">
          <option value="">Todas as categorias</option>{Object.entries(CATEGORIAS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
        </Select>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          [`Total em ${nomeMes}`, formatarMoeda(total)],
          ["Combustível", formatarMoeda(totalComb)],
          ["Litros", `${formatarNumero(Math.round(litros * 10) / 10)} L`],
          ["Média", ltTot ? `${formatarNumero(Math.round((kmTot / ltTot) * 100) / 100)} km/L` : "—"],
          ["Custo por km", kmRodadosMes ? formatarMoeda(totalComb / kmRodadosMes) : "—"],
        ].map(([k, v]) => (
          <Card key={k} className="p-3"><div className="text-xs text-muted">{k}</div><div className="tabular text-lg font-semibold">{v}</div></Card>
        ))}
      </div>

      <Card>
        {lista === null ? <div className="py-10 text-center text-sm text-muted">Carregando...</div>
          : ls.length === 0 ? <Vazio titulo="Nenhuma despesa no período" texto={podeLancar ? "Use Lançar despesa para registrar combustível, pedágio, manutenção..." : undefined} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Data</th><th className="px-2 py-2 font-medium">Despesa</th>
                    <th className="px-2 py-2 font-medium">Veículo / motorista</th><th className="hidden px-2 py-2 font-medium md:table-cell">Abastecimento</th>
                    <th className="px-2 py-2 text-right font-medium">Valor</th><th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {ls.map((d) => (
                    <tr key={d.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{formatarData(d.data)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{CATEGORIAS[d.categoria]}</span>
                          {d.pago_pelo_motorista && <Badge tom="aviso">dinheiro da rota</Badge>}
                          {d.carga_numero && d.expedicao_id && <Link href={`/expedicao/cargas/${d.expedicao_id}`} className="text-xs text-muted hover:text-accent">carga {d.carga_numero}</Link>}
                        </div>
                        {(d.descricao || d.posto) && <div className="text-xs text-muted">{[d.posto, d.descricao].filter(Boolean).join(" · ")}</div>}
                      </td>
                      <td className="px-2 py-2 text-xs">{d.veiculo_placa ?? "—"}{d.motorista_nome && <div className="text-muted">{d.motorista_nome}</div>}</td>
                      <td className="hidden px-2 py-2 text-xs md:table-cell">
                        {d.categoria === "combustivel" ? (
                          <>
                            <div className="tabular">km {formatarNumero(d.km_atual)} · {formatarNumero(d.litros)} L × {formatarMoeda(d.preco_litro)}{d.combustivel ? ` · ${COMBUSTIVEIS[d.combustivel]}` : ""}</div>
                            <div className="tabular text-muted">
                              {d.km_rodados ? `${formatarNumero(d.km_rodados)} km rodados` : "primeiro abastecimento"}
                              {d.km_por_litro ? ` · ${formatarNumero(d.km_por_litro)} km/L` : ""}{d.custo_km ? ` · ${formatarMoeda(d.custo_km)}/km` : ""}
                              {!d.tanque_cheio ? " · tanque não completado" : ""}
                            </div>
                          </>
                        ) : <span className="text-muted/50">—</span>}
                      </td>
                      <td className="tabular px-2 py-2 text-right whitespace-nowrap">{formatarMoeda(d.valor)}</td>
                      <td className="px-1">{podeLancar && <button className="rounded p-1 text-muted hover:text-bad" onClick={() => excluir(d)} aria-label="Excluir despesa"><Trash2 size={14} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Dialogo aberto={aberto} titulo="Lançar despesa" aoFechar={() => setAberto(false)}
        rodape={<><Button onClick={() => setAberto(false)}>Voltar</Button><Button variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Lançando..." : "Lançar"}</Button></>}>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Categoria">
            {Object.entries(CATEGORIAS).map(([k, r]) => (
              <button key={k} role="radio" aria-checked={f.categoria === k} onClick={() => setF({ ...f, categoria: k })}
                className={cn("flex items-center gap-1 rounded-full border px-3 py-1 text-xs", f.categoria === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
                {k === "combustivel" && <Fuel size={12} />}{r}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="d-data" obrigatorio>Data</Label><Input id="d-data" type="date" max={dataLocal()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
            <div><Label htmlFor="d-vei" obrigatorio={comb}>Veículo</Label>
              <Select id="d-vei" value={f.veiculo_id} onChange={(e) => setF({ ...f, veiculo_id: e.target.value })}>
                <option value="">—</option>{opcoes.veiculos.map((v) => <option key={v.valor} value={v.valor}>{v.rotulo}</option>)}
              </Select></div>
            <div><Label htmlFor="d-mot">Motorista</Label>
              <Select id="d-mot" value={f.motorista_id} onChange={(e) => setF({ ...f, motorista_id: e.target.value })}>
                <option value="">—</option>{opcoes.motoristas.map((v) => <option key={v.valor} value={v.valor}>{v.rotulo}</option>)}
              </Select></div>
            <div><Label htmlFor="d-carga">Carga</Label>
              <Select id="d-carga" value={f.expedicao_id} onChange={(e) => {
                const c = cargas.find((x) => x.id === e.target.value);
                setF({ ...f, expedicao_id: e.target.value, veiculo_id: f.veiculo_id || c?.veiculo_id || "", motorista_id: f.motorista_id || c?.motorista_id || "", pago: e.target.value ? f.pago : false });
              }}>
                <option value="">Sem carga</option>{cargas.map((c) => <option key={c.id} value={c.id}>Carga {c.numero} · {formatarData(c.data)}</option>)}
              </Select></div>
          </div>

          {comb ? (
            <div className="space-y-3 rounded-md border border-accent/30 bg-accent-soft/30 p-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label htmlFor="d-km" obrigatorio>Km atual</Label><Input id="d-km" inputMode="numeric" className="tabular" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></div>
                <div><Label htmlFor="d-lt" obrigatorio>Litros</Label><Input id="d-lt" inputMode="decimal" className="tabular" value={f.litros} onChange={(e) => setF({ ...f, litros: e.target.value })} /></div>
                <div><Label htmlFor="d-preco" obrigatorio>R$ por litro</Label><Input id="d-preco" inputMode="decimal" className="tabular" value={f.preco} onChange={(e) => setF({ ...f, preco: e.target.value })} /></div>
              </div>
              <p className="text-xs text-muted">
                {f.veiculo_id ? (ultimoKm !== null ? `Último abastecimento deste veículo: km ${formatarNumero(ultimoKm)}${rodados ? ` · ${formatarNumero(rodados)} km rodados desde então` : ""}.` : "Primeiro abastecimento deste veículo no sistema.") : "Escolha o veículo."}
                {rodados && num(f.litros) > 0 && f.cheio ? ` Média: ${formatarNumero(Math.round((rodados / num(f.litros)) * 100) / 100)} km/L.` : ""}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="d-tipo">Combustível</Label>
                  <Select id="d-tipo" value={f.combustivel} onChange={(e) => setF({ ...f, combustivel: e.target.value })}>
                    {Object.entries(COMBUSTIVEIS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                  </Select></div>
                <div><Label htmlFor="d-posto">Posto</Label><Input id="d-posto" value={f.posto} onChange={(e) => setF({ ...f, posto: e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.cheio} onChange={(e) => setF({ ...f, cheio: e.target.checked })} />
                Completou o tanque (usado para calcular a média de consumo)
              </label>
              <div className="flex justify-between rounded bg-surface p-2 font-semibold"><span>Valor do abastecimento</span><span className="tabular">{formatarMoeda(valorComb)}</span></div>
            </div>
          ) : (
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <div><Label htmlFor="d-valor" obrigatorio>Valor</Label><Input id="d-valor" inputMode="decimal" className="tabular" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></div>
              <div><Label htmlFor="d-desc" obrigatorio={f.categoria === "outros"}>Descrição</Label><Input id="d-desc" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
            </div>
          )}
          {comb && <div><Label htmlFor="d-obs">Observação</Label><Textarea id="d-obs" className="min-h-12" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>}
          <label className={cn("flex items-start gap-2 text-xs", !f.expedicao_id && "opacity-50")}>
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" disabled={!f.expedicao_id} checked={f.pago} onChange={(e) => setF({ ...f, pago: e.target.checked })} />
            <span>Pago com o dinheiro recebido na rota<span className="block text-muted">Entra automaticamente nas despesas do acerto do motorista desta carga.</span></span>
          </label>
        </div>
      </Dialogo>
    </>
  );
}
