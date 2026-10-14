"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Ban, ClipboardList, PackageCheck, Plus, Printer, Truck, X } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Textarea, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { STATUS_CARGA, STATUS_ENTREGA, enderecoTexto, mensagemErro } from "@/lib/pedidos";
import { useOpcoesCarga, type Carga } from "@/components/expedicao/ListaCargas";

type PedidoCarga = {
  id: string; pedido_id: string; ordem_entrega: number; status_entrega: string; motivo_devolucao: string | null;
  pedido_numero: number; valor_total: number; peso_total_kg: number; data_entrega: string | null; qtd_itens: number;
  cliente_codigo: number; cliente_nome: string; cliente_fantasia: string | null;
  logradouro: string | null; endereco_numero: string | null; bairro: string | null; cidade: string | null; uf: string | null;
};
type Separacao = { deposito_nome: string; produto_codigo: string; produto_nome: string; unidade: string | null; lote_numero: string | null; validade: string | null; quantidade: number };
type Disponivel = { id: string; numero: number; cliente_nome: string; cliente_fantasia: string | null; rota_id: string | null; rota_nome: string | null; data_entrega: string | null; valor_total: number; peso_total_kg: number };

export function DetalheCarga({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const opcoes = useOpcoesCarga();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [pedidos, setPedidos] = useState<PedidoCarga[]>([]);
  const [separacao, setSeparacao] = useState<Separacao[]>([]);
  const [form, setForm] = useState({ data: "", rota_id: "", motorista_id: "", veiculo_id: "", observacao: "" });
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<null | "incluir" | "saida" | "cancelar">(null);
  const [disponiveis, setDisponiveis] = useState<Disponivel[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [filtroRota, setFiltroRota] = useState<"rota" | "todas">("rota");

  const carregar = useCallback(async () => {
    const [c, p, s] = await Promise.all([
      supabase.from("vw_expedicoes").select("*").eq("id", id).maybeSingle(),
      supabase.from("vw_expedicao_pedidos").select("*").eq("expedicao_id", id).order("ordem_entrega"),
      supabase.from("vw_separacao").select("*").eq("expedicao_id", id).order("produto_nome").order("validade"),
    ]);
    if (!c.data) return setNaoEncontrada(true);
    const k = c.data as Carga;
    setCarga(k);
    setForm({ data: k.data, rota_id: k.rota_id ?? "", motorista_id: k.motorista_id ?? "", veiculo_id: k.veiculo_id ?? "", observacao: k.observacao ?? "" });
    setPedidos((p.data ?? []) as PedidoCarga[]);
    setSeparacao((s.data ?? []) as Separacao[]);
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function abrirInclusao() {
    const { data, error } = await supabase.from("vw_pedidos")
      .select("id, numero, cliente_nome, cliente_fantasia, rota_id, rota_nome, data_entrega, valor_total, peso_total_kg")
      .eq("status", "aprovado").eq("tipo", "pedido").eq("ativo", true).order("data_entrega", { nullsFirst: false }).order("numero").limit(500);
    if (error) return toast.error("Não foi possível listar os pedidos", { description: mensagemErro(error) });
    setDisponiveis((data ?? []) as Disponivel[]);
    setMarcados(new Set());
    setFiltroRota(carga?.rota_id ? "rota" : "todas");
    setDialogo("incluir");
  }

  async function rpc(nome: string, args: Record<string, unknown>, sucesso: string) {
    setOcupado(true);
    const { data, error } = await supabase.rpc(nome, args);
    setOcupado(false);
    if (error) { toast.error("Não foi possível concluir", { description: mensagemErro(error), duration: 10000 }); return null; }
    if (sucesso) toast.success(sucesso);
    await carregar();
    return data ?? true;
  }

  if (naoEncontrada) return <Card><Vazio titulo="Carga não encontrada" acao={<Link href="/expedicao/cargas"><Button>Voltar</Button></Link>} /></Card>;
  if (!carga) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;

  const st = STATUS_CARGA[carga.status];
  const montagem = carga.status === "montando" || carga.status === "separando";
  const editavel = podeEditar && !["concluida", "cancelada"].includes(carga.status);
  const alterado = form.data !== carga.data || form.rota_id !== (carga.rota_id ?? "") || form.motorista_id !== (carga.motorista_id ?? "")
    || form.veiculo_id !== (carga.veiculo_id ?? "") || form.observacao !== (carga.observacao ?? "");
  const capacidade = carga.capacidade_kg ? Number(carga.capacidade_kg) : null;
  const peso = Number(carga.peso_total_kg);
  const lista = disponiveis.filter((d) => filtroRota === "todas" || !carga.rota_id || d.rota_id === carga.rota_id);
  const pesoMarcado = disponiveis.filter((d) => marcados.has(d.id)).reduce((a, d) => a + Number(d.peso_total_kg), 0);

  async function salvarDados() {
    setOcupado(true);
    const { error } = await supabase.from("expedicoes").update({
      data: form.data, rota_id: form.rota_id || null, motorista_id: form.motorista_id || null, veiculo_id: form.veiculo_id || null, observacao: form.observacao || null,
    }).eq("id", id);
    setOcupado(false);
    if (error) return toast.error("Não foi possível salvar", { description: mensagemErro(error) });
    toast.success("Dados da carga salvos");
    carregar();
  }

  async function mover(i: number, d: -1 | 1) {
    const ids = pedidos.map((p) => p.pedido_id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    setPedidos((ps) => { const n = [...ps]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
    await rpc("expedicao_ordenar", { p_expedicao: id, p_pedidos: ids }, "");
  }

  async function incluir() {
    if (!marcados.size) return toast.error("Marque ao menos um pedido");
    const r = await rpc("expedicao_incluir_pedidos", { p_expedicao: id, p_pedidos: [...marcados] }, `${marcados.size} ${marcados.size === 1 ? "pedido incluído" : "pedidos incluídos"}`);
    if (r) setDialogo(null);
  }

  async function saida() {
    const r = (await rpc("expedicao_saida", { p_expedicao: id }, "")) as { pedidos: number; unidades: number } | null;
    if (r) { setDialogo(null); toast.success(`Carga saiu para entrega: ${r.pedidos} pedidos, ${formatarNumero(r.unidades)} unidades baixadas do estoque.`); }
  }

  return (
    <>
      <Cabecalho trilha="Expedição · Cargas" titulo={`Carga ${carga.numero}`}
        acoes={<>
          <Button onClick={() => router.push("/expedicao/cargas")}><ArrowLeft size={16} /> Voltar</Button>
          {pedidos.length > 0 && <a href={`/imprimir/separacao/${id}`} target="_blank" rel="noreferrer"><Button><ClipboardList size={16} /> Separação</Button></a>}
          {pedidos.length > 0 && <a href={`/imprimir/romaneio/${id}`} target="_blank" rel="noreferrer"><Button><Printer size={16} /> Romaneio</Button></a>}
          {podeEditar && montagem && <Button onClick={abrirInclusao} disabled={ocupado}><Plus size={16} /> Incluir pedidos</Button>}
          {podeEditar && carga.status === "montando" && pedidos.length > 0 &&
            <Button disabled={ocupado} onClick={() => rpc("expedicao_separar", { p_expedicao: id }, "Separação iniciada. Imprima a lista de separação.")}><PackageCheck size={16} /> Iniciar separação</Button>}
          {podeEditar && montagem && pedidos.length > 0 &&
            <Button variante="primario" disabled={ocupado || alterado} title={alterado ? "Salve os dados antes" : undefined} onClick={() => setDialogo("saida")}><Truck size={16} /> Saída para entrega</Button>}
          {carga.status === "em_rota" && <Link href={`/expedicao/entregas?carga=${id}`}><Button variante="primario"><Truck size={16} /> Entregas</Button></Link>}
          {podeEditar && montagem && <Button variante="perigo" disabled={ocupado} onClick={() => setDialogo("cancelar")}><Ban size={16} /> Cancelar</Button>}
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tom={st.tom}>{st.rotulo}</Badge>
        <span className="text-muted">Saída em {formatarData(carga.data)}</span>
        {carga.status === "em_rota" && <span className="text-muted">· {carga.entregues} entregues, {carga.pendentes} a entregar</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between border-b border-line p-3">
              <span className="text-sm font-medium">Pedidos na ordem de entrega</span>
              <span className="text-xs text-muted">{pedidos.length} {pedidos.length === 1 ? "pedido" : "pedidos"}</span>
            </div>
            {pedidos.length === 0 ? (
              <Vazio titulo="Carga vazia" texto={podeEditar && montagem ? "Clique em Incluir pedidos para trazer os pedidos aprovados." : undefined} />
            ) : (
              <ol className="divide-y divide-line/70">
                {pedidos.map((p, i) => {
                  const se = STATUS_ENTREGA[p.status_entrega];
                  return (
                    <li key={p.id} className="flex items-start gap-3 px-3 py-2.5">
                      <span className="tabular mt-0.5 w-6 shrink-0 text-center text-sm font-semibold text-muted">{p.ordem_entrega}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <Link href={`/vendas/pedidos/${p.pedido_id}`} className="font-medium hover:text-accent">{p.cliente_fantasia || p.cliente_nome}</Link>
                          <span className="text-xs text-muted">pedido {p.pedido_numero}</span>
                          {carga.status !== "montando" && carga.status !== "separando" && <Badge tom={se.tom}>{se.rotulo}</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted">{enderecoTexto(p) || "Sem endereço cadastrado"}</div>
                        {p.motivo_devolucao && <div className="text-xs text-warn">{p.motivo_devolucao}</div>}
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <div className="tabular">{formatarMoeda(p.valor_total)}</div>
                        <div className="tabular text-xs text-muted">{formatarNumero(p.peso_total_kg)} kg · {p.qtd_itens} {Number(p.qtd_itens) === 1 ? "item" : "itens"}</div>
                      </div>
                      {podeEditar && carga.status !== "concluida" && carga.status !== "cancelada" && (
                        <div className="flex shrink-0 flex-col">
                          <button className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30" disabled={i === 0 || ocupado} onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp size={14} /></button>
                          <button className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30" disabled={i === pedidos.length - 1 || ocupado} onClick={() => mover(i, 1)} aria-label="Descer"><ArrowDown size={14} /></button>
                        </div>
                      )}
                      {podeEditar && montagem && (
                        <Button tamanho="p" variante="fantasma" disabled={ocupado} aria-label={`Retirar pedido ${p.pedido_numero}`} title="Retirar da carga"
                          onClick={() => rpc("expedicao_retirar_pedido", { p_expedicao: id, p_pedido: p.pedido_id }, `Pedido ${p.pedido_numero} retirado da carga`)}><X size={15} /></Button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          {separacao.length > 0 && (
            <Card>
              <div className="flex items-center justify-between border-b border-line p-3">
                <span className="text-sm font-medium">{montagem ? "O que separar" : "O que saiu"} · por lote</span>
                <span className="text-xs text-muted">vencimento mais próximo primeiro</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Produto</th>
                    <th className="px-3 py-2 font-medium">Lote</th>
                    <th className="px-3 py-2 font-medium">Validade</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Depósito</th>
                    <th className="px-3 py-2 text-right font-medium">Qtd</th>
                  </tr>
                </thead>
                <tbody>
                  {separacao.map((s, k) => (
                    <tr key={k} className="border-b border-line/70">
                      <td className="px-3 py-2"><span className="text-muted">{s.produto_codigo}</span> {s.produto_nome}</td>
                      <td className="px-3 py-2">{s.lote_numero ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatarData(s.validade)}</td>
                      <td className="hidden px-3 py-2 sm:table-cell">{s.deposito_nome}</td>
                      <td className="tabular px-3 py-2 text-right font-medium whitespace-nowrap">{formatarNumero(s.quantidade)} {s.unidade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 text-sm font-medium">Totais</div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Pedidos</dt><dd className="tabular">{carga.qtd_pedidos}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Valor</dt><dd className="tabular font-semibold">{formatarMoeda(carga.valor_total)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Peso bruto</dt><dd className={cn("tabular", capacidade && peso > capacidade && "font-semibold text-bad")}>{formatarNumero(peso)} kg</dd></div>
            </dl>
            {capacidade && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={capacidade} aria-valuenow={peso} aria-label="Ocupação do veículo">
                  <div className={cn("h-full rounded-full", peso > capacidade ? "bg-bad" : "bg-accent")} style={{ width: `${Math.min(100, (peso / capacidade) * 100)}%` }} />
                </div>
                <div className="mt-1 text-xs text-muted">{Math.round((peso / capacidade) * 100)}% de {formatarNumero(capacidade)} kg do veículo</div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">Dados da carga</span>
              {alterado && editavel && <Button tamanho="p" variante="primario" disabled={ocupado} onClick={salvarDados}>Salvar</Button>}
            </div>
            <div className="space-y-3">
              <div><Label htmlFor="d-data">Data de saída</Label><Input id="d-data" type="date" disabled={!editavel} value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></div>
              {([["rota_id", "Rota", opcoes.rotas], ["motorista_id", "Motorista", opcoes.motoristas], ["veiculo_id", "Veículo", opcoes.veiculos]] as const).map(([k, r, ops]) => (
                <div key={k}>
                  <Label htmlFor={`d-${k}`}>{r}</Label>
                  <Select id={`d-${k}`} disabled={!editavel} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                    <option value="">—</option>{ops.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                  </Select>
                </div>
              ))}
              <div><Label htmlFor="d-obs">Observação</Label><Textarea id="d-obs" className="min-h-16" disabled={!editavel} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} /></div>
            </div>
          </Card>
        </div>
      </div>

      <Dialogo aberto={dialogo === "incluir"} largo titulo="Incluir pedidos aprovados" aoFechar={() => setDialogo(null)}
        descricao={carga.rota_id ? undefined : "A carga não tem rota: aparecem os pedidos de todas as rotas."}
        rodape={<>
          <span className="mr-auto text-sm text-muted">{marcados.size} marcados · {formatarNumero(pesoMarcado)} kg</span>
          <Button onClick={() => setDialogo(null)}>Voltar</Button>
          <Button variante="primario" disabled={ocupado || !marcados.size} onClick={incluir}>Incluir na carga</Button>
        </>}>
        {carga.rota_id && (
          <div className="mb-3 flex gap-1.5">
            {(["rota", "todas"] as const).map((x) => (
              <button key={x} onClick={() => setFiltroRota(x)}
                className={cn("rounded-full border px-3 py-1 text-xs", filtroRota === x ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}>
                {x === "rota" ? `Só da rota ${carga.rota_nome}` : "Todas as rotas"}
              </button>
            ))}
          </div>
        )}
        {lista.length === 0 ? <Vazio titulo="Nenhum pedido aprovado esperando carga" texto="Pedidos confirmados (e com crédito liberado) aparecem aqui." /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="w-8 py-2">
                  <input type="checkbox" className="accent-[var(--accent)]" aria-label="Marcar todos" checked={lista.every((d) => marcados.has(d.id))}
                    onChange={(e) => setMarcados(e.target.checked ? new Set(lista.map((d) => d.id)) : new Set())} />
                </th>
                <th className="py-2 pr-2 font-medium">Pedido</th>
                <th className="py-2 pr-2 font-medium">Cliente</th>
                <th className="hidden py-2 pr-2 font-medium sm:table-cell">Rota</th>
                <th className="hidden py-2 pr-2 font-medium sm:table-cell">Entrega</th>
                <th className="py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id} className="cursor-pointer border-b border-line/70 hover:bg-surface-2/70"
                  onClick={() => setMarcados((m) => { const n = new Set(m); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}>
                  <td className="py-2"><input type="checkbox" className="accent-[var(--accent)]" readOnly checked={marcados.has(d.id)} aria-label={`Pedido ${d.numero}`} /></td>
                  <td className="tabular py-2 pr-2">{d.numero}</td>
                  <td className="py-2 pr-2">{d.cliente_fantasia || d.cliente_nome}</td>
                  <td className="hidden py-2 pr-2 sm:table-cell">{d.rota_nome ?? "—"}</td>
                  <td className="hidden py-2 pr-2 sm:table-cell">{formatarData(d.data_entrega) || "—"}</td>
                  <td className="tabular py-2 text-right">{formatarMoeda(d.valor_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Dialogo>

      <Dialogo aberto={dialogo === "saida"} titulo={`Saída da carga ${carga.numero}`} aoFechar={() => setDialogo(null)}
        rodape={<><Button onClick={() => setDialogo(null)}>Voltar</Button><Button variante="primario" disabled={ocupado} onClick={saida}>Confirmar saída</Button></>}>
        <ul className="space-y-1 text-sm">
          <li>{pedidos.length} pedidos · {formatarMoeda(carga.valor_total)} · {formatarNumero(peso)} kg.</li>
          <li>O estoque reservado é baixado agora, lote por lote.</li>
          {!carga.motorista_id && <li className="text-bad">Informe o motorista nos dados da carga antes da saída.</li>}
          {capacidade && peso > capacidade && <li className="text-bad">Peso acima da capacidade do veículo.</li>}
          <li className="text-muted">Depois da saída, os pedidos não podem mais ser cancelados por aqui; devolução é registrada na entrega.</li>
        </ul>
      </Dialogo>

      <Dialogo aberto={dialogo === "cancelar"} titulo={`Cancelar carga ${carga.numero}?`} descricao="Os pedidos voltam para aprovados, com o estoque ainda reservado." aoFechar={() => setDialogo(null)}
        rodape={<><Button onClick={() => setDialogo(null)}>Voltar</Button><Button variante="perigo" disabled={ocupado} onClick={async () => { if (await rpc("expedicao_cancelar", { p_expedicao: id }, "Carga cancelada")) setDialogo(null); }}>Cancelar carga</Button></>} />
    </>
  );
}
