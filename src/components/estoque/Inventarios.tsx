"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Ban, CheckCheck, ClipboardList, Plus, Search } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { BuscaRegistro, type Resultado } from "@/components/ui/BuscaRegistro";
import { cn, formatarData, formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";
import { useDepositos } from "@/components/estoque/Dialogos";

const STATUS: Record<string, { rotulo: string; tom: "neutro" | "ok" | "aviso" | "erro" | "acento" }> = {
  aberto: { rotulo: "Em contagem", tom: "aviso" },
  concluido: { rotulo: "Concluído", tom: "ok" },
  cancelado: { rotulo: "Cancelado", tom: "erro" },
};

type Inv = { id: string; numero: number; data: string; status: string; observacao: string | null; deposito_id: string; depositos: { nome: string } | null; concluido_em: string | null };

export function ListaInventarios({ podeCriar }: { podeCriar: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const { depositos, padrao } = useDepositos();
  const [lista, setLista] = useState<(Inv & { total: number; contados: number })[] | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [deposito, setDeposito] = useState("");
  const [obs, setObs] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("inventarios").select("id, numero, data, status, observacao, deposito_id, concluido_em, depositos(nome), inventarios_itens(quantidade_contada)")
        .order("numero", { ascending: false }).limit(200);
      if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
      type R = Inv & { inventarios_itens: { quantidade_contada: number | null }[] };
      setLista(((data ?? []) as unknown as R[]).map((i) => ({ ...i, total: i.inventarios_itens.length, contados: i.inventarios_itens.filter((x) => x.quantidade_contada !== null).length })));
    })();
  }, [supabase]);

  async function criar() {
    const dep = deposito || padrao;
    if (!dep) return toast.error("Escolha o depósito");
    setOcupado(true);
    const { data, error } = await supabase.rpc("inventario_abrir", { p_deposito: dep, p_observacao: obs || null });
    setOcupado(false);
    if (error) return toast.error("Não foi possível abrir", { description: mensagemErro(error) });
    router.push(`/estoque/inventario/${data}`);
  }

  return (
    <>
      <Cabecalho trilha="Estoque" titulo="Inventário"
        acoes={podeCriar && <Button variante="primario" onClick={() => setAbrir(true)}><Plus size={16} /> Abrir inventário</Button>} />
      <Card>
        {lista === null ? <div className="px-4 py-10 text-center text-sm text-muted">Carregando...</div>
          : lista.length === 0 ? <Vazio titulo="Nenhum inventário" texto="Abra um inventário para contar o estoque de um depósito. O sistema acerta as diferenças sozinho ao concluir." />
          : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Nº</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Depósito</th>
                  <th className="px-3 py-2 text-right font-medium">Contados</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id} onClick={() => router.push(`/estoque/inventario/${i.id}`)} className="cursor-pointer border-b border-line/70 hover:bg-surface-2/70">
                    <td className="tabular px-3 py-2">{i.numero}</td>
                    <td className="px-3 py-2">{formatarData(i.data)}{i.observacao && <div className="text-xs text-muted">{i.observacao}</div>}</td>
                    <td className="px-3 py-2">{i.depositos?.nome}</td>
                    <td className="tabular px-3 py-2 text-right">{i.contados} de {i.total}</td>
                    <td className="px-3 py-2"><Badge tom={STATUS[i.status].tom}>{STATUS[i.status].rotulo}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>
      <Dialogo aberto={abrir} titulo="Abrir inventário" descricao="O sistema tira um retrato dos saldos do depósito. Depois é só digitar o que foi contado."
        aoFechar={() => setAbrir(false)}
        rodape={<><Button onClick={() => setAbrir(false)}>Voltar</Button><Button variante="primario" disabled={ocupado} onClick={criar}>Abrir</Button></>}>
        <div className="space-y-3">
          <div>
            <Label obrigatorio htmlFor="inv-dep">Depósito</Label>
            <Select id="inv-dep" value={deposito || padrao} onChange={(e) => setDeposito(e.target.value)}>
              {depositos.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="inv-obs">Observação</Label>
            <Input id="inv-obs" value={obs} placeholder="Ex.: contagem de fim de mês" onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
      </Dialogo>
    </>
  );
}

// ---------------------------------------------------------------------
type ItemInv = {
  id: string; produto_id: string; lote_id: string | null; lote_numero: string | null; validade: string | null;
  quantidade_sistema: number; quantidade_contada: number | null; diferenca: number | null;
  produtos: { codigo: string; nome: string } | null; lotes: { numero: string; validade: string } | null;
};

export function Inventario({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [inv, setInv] = useState<Inv | null>(null);
  const [itens, setItens] = useState<ItemInv[]>([]);
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "pendentes" | "diferenca">("todos");
  const [dialogo, setDialogo] = useState<null | "concluir" | "cancelar" | "incluir">(null);
  const [ocupado, setOcupado] = useState(false);
  const [produtos, setProdutos] = useState<{ id: string; codigo: string; nome: string }[]>([]);
  const [novo, setNovo] = useState<{ produto: Resultado | null; lote: string; validade: string; qtd: string }>({ produto: null, lote: "", validade: "", qtd: "" });
  const [naoEncontrado, setNaoEncontrado] = useState(false);

  const carregar = useCallback(async () => {
    const [i, its] = await Promise.all([
      supabase.from("inventarios").select("id, numero, data, status, observacao, deposito_id, concluido_em, depositos(nome)").eq("id", id).maybeSingle(),
      supabase.from("inventarios_itens").select("id, produto_id, lote_id, lote_numero, validade, quantidade_sistema, quantidade_contada, diferenca, produtos(codigo, nome), lotes(numero, validade)").eq("inventario_id", id).limit(5000),
    ]);
    if (!i.data) return setNaoEncontrado(true);
    setInv(i.data as unknown as Inv);
    const ls = ((its.data ?? []) as unknown as ItemInv[]).sort((a, b) =>
      (a.produtos?.nome ?? "").localeCompare(b.produtos?.nome ?? "") || (a.lotes?.validade ?? a.validade ?? "").localeCompare(b.lotes?.validade ?? b.validade ?? ""));
    setItens(ls);
    setContagem(Object.fromEntries(ls.map((x) => [x.id, x.quantidade_contada === null ? "" : String(Number(x.quantidade_contada))])));
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    supabase.from("produtos").select("id, codigo, nome").eq("ativo", true).order("nome").limit(2000).then(({ data }) => setProdutos(data ?? []));
  }, [supabase]);

  const buscarProduto = useCallback(async (t: string): Promise<Resultado[]> => {
    const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const partes = n(t).split(/\s+/).filter(Boolean);
    return produtos.filter((p) => partes.every((x) => n(`${p.codigo} ${p.nome}`).includes(x))).slice(0, 30).map((p) => ({ id: p.id, rotulo: `${p.codigo} · ${p.nome}` }));
  }, [produtos]);

  if (naoEncontrado) return <Card><Vazio titulo="Inventário não encontrado" acao={<Link href="/estoque/inventario"><Button>Voltar</Button></Link>} /></Card>;
  if (!inv) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;

  const aberto = inv.status === "aberto" && podeEditar;
  const contadoDe = (x: ItemInv) => (contagem[x.id] === "" || contagem[x.id] === undefined ? null : Number(contagem[x.id]));
  const difDe = (x: ItemInv) => (inv.status === "concluido" ? (x.diferenca === null ? null : Number(x.diferenca)) : contadoDe(x) === null ? null : contadoDe(x)! - Number(x.quantidade_sistema));

  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visiveis = itens.filter((x) => {
    const lote = x.lotes?.numero ?? x.lote_numero ?? "";
    if (busca && !n(busca).split(/\s+/).every((t) => n(`${x.produtos?.codigo} ${x.produtos?.nome} ${lote}`).includes(t))) return false;
    if (filtro === "pendentes") return contadoDe(x) === null;
    if (filtro === "diferenca") return (difDe(x) ?? 0) !== 0;
    return true;
  });
  const contados = itens.filter((x) => contadoDe(x) !== null).length;
  const comDiferenca = itens.filter((x) => (difDe(x) ?? 0) !== 0).length;

  async function salvarContagem(x: ItemInv) {
    const v = contagem[x.id];
    const novoValor = v === "" ? null : Number(String(v).replace(",", "."));
    if (novoValor === (x.quantidade_contada === null ? null : Number(x.quantidade_contada))) return;
    if (novoValor !== null && (Number.isNaN(novoValor) || novoValor < 0)) return toast.error("Quantidade inválida");
    const { error } = await supabase.from("inventarios_itens").update({ quantidade_contada: novoValor }).eq("id", x.id);
    if (error) return toast.error("Não foi possível salvar", { description: mensagemErro(error) });
    setItens((ls) => ls.map((i) => (i.id === x.id ? { ...i, quantidade_contada: novoValor } : i)));
  }

  async function incluir() {
    if (!novo.produto) return toast.error("Escolha o produto");
    if (!novo.validade && !novo.lote) return toast.error("Informe a validade do lote encontrado");
    if (novo.qtd === "") return toast.error("Informe a quantidade contada");
    setOcupado(true);
    const { error } = await supabase.from("inventarios_itens").insert({
      inventario_id: id, produto_id: novo.produto.id, lote_numero: novo.lote.trim().toUpperCase() || null,
      validade: novo.validade || null, quantidade_contada: Number(novo.qtd.replace(",", ".")),
    });
    setOcupado(false);
    if (error) return toast.error("Não foi possível incluir", { description: error.code === "23505" ? "Esse lote já está na contagem." : mensagemErro(error) });
    setNovo({ produto: null, lote: "", validade: "", qtd: "" });
    setDialogo(null);
    carregar();
  }

  async function concluir() {
    setOcupado(true);
    const { data, error } = await supabase.rpc("inventario_concluir", { p_inventario: id });
    setOcupado(false);
    setDialogo(null);
    if (error) return toast.error("Não foi possível concluir", { description: mensagemErro(error), duration: 10000 });
    const a = (data as { ajustes: number }).ajustes;
    toast.success(`Inventário concluído. ${a} ${a === 1 ? "ajuste lançado" : "ajustes lançados"} no estoque.`);
    carregar();
  }

  async function cancelar() {
    setOcupado(true);
    const { error } = await supabase.rpc("inventario_cancelar", { p_inventario: id });
    setOcupado(false);
    setDialogo(null);
    if (error) return toast.error("Não foi possível cancelar", { description: mensagemErro(error) });
    toast.success("Inventário cancelado. Nada foi alterado no estoque.");
    carregar();
  }

  return (
    <>
      <Cabecalho trilha={`Estoque · Inventário · ${inv.depositos?.nome ?? ""}`} titulo={`Inventário ${inv.numero}`}
        acoes={<>
          <Button onClick={() => router.push("/estoque/inventario")}><ArrowLeft size={16} /> Voltar</Button>
          {aberto && <Button onClick={() => setDialogo("incluir")}><Plus size={16} /> Lote encontrado</Button>}
          {aberto && <Button variante="perigo" onClick={() => setDialogo("cancelar")}><Ban size={16} /> Cancelar</Button>}
          {aberto && <Button variante="primario" disabled={!contados} onClick={() => setDialogo("concluir")}><CheckCheck size={16} /> Concluir</Button>}
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tom={STATUS[inv.status].tom}>{STATUS[inv.status].rotulo}</Badge>
        <span className="text-muted">Aberto em {formatarData(inv.data)}{inv.concluido_em ? ` · concluído em ${formatarData(inv.concluido_em)}` : ""}</span>
        {inv.observacao && <span className="text-muted">· {inv.observacao}</span>}
      </div>

      {inv.status === "aberto" && (
        <p className="mb-3 flex items-start gap-2 text-sm text-muted">
          <ClipboardList size={16} className="mt-0.5 shrink-0" />
          Digite a quantidade contada de cada lote; salva sozinho ao sair do campo. Itens em branco ficam como estão. Ao concluir, o sistema lança um ajuste para cada diferença.
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto ou lote" className="pl-8" aria-label="Buscar" />
          </div>
          {(["todos", "pendentes", "diferenca"] as const).map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              className={cn("rounded-full border px-3 py-1 text-xs", filtro === f ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}>
              {f === "todos" ? `Todos (${itens.length})` : f === "pendentes" ? `Não contados (${itens.length - contados})` : `Com diferença (${comDiferenca})`}
            </button>
          ))}
        </div>
        {visiveis.length === 0 ? <Vazio titulo={itens.length ? "Nada com esse filtro" : "Depósito sem saldo"} texto={itens.length ? undefined : aberto ? "Use 'Lote encontrado' para incluir o que foi contado." : undefined} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">Lote</th>
                  <th className="px-3 py-2 font-medium">Validade</th>
                  <th className="px-3 py-2 text-right font-medium">Sistema</th>
                  <th className="px-3 py-2 text-right font-medium">Contado</th>
                  <th className="px-3 py-2 text-right font-medium">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((x) => {
                  const d = difDe(x);
                  return (
                    <tr key={x.id} className="border-b border-line/70">
                      <td className="px-3 py-2"><span className="text-muted">{x.produtos?.codigo}</span> {x.produtos?.nome}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{x.lotes?.numero ?? x.lote_numero ?? <span className="text-muted/50">—</span>}{!x.lote_id && <span className="ml-1.5"><Badge tom="acento">Novo</Badge></span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatarData(x.lotes?.validade ?? x.validade)}</td>
                      <td className="tabular px-3 py-2 text-right">{formatarNumero(x.quantidade_sistema)}</td>
                      <td className="px-2 py-1.5 text-right">
                        {aberto ? (
                          <Input type="number" min="0" step="any" inputMode="decimal" className="ml-auto h-8 w-24 text-right tabular" value={contagem[x.id] ?? ""}
                            aria-label={`Contado ${x.produtos?.nome}`} onChange={(e) => setContagem({ ...contagem, [x.id]: e.target.value })} onBlur={() => salvarContagem(x)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
                        ) : (
                          <span className="tabular">{x.quantidade_contada === null ? <span className="text-muted/50">—</span> : formatarNumero(x.quantidade_contada)}</span>
                        )}
                      </td>
                      <td className={cn("tabular px-3 py-2 text-right font-medium", d !== null && d < 0 && "text-bad", d !== null && d > 0 && "text-ok")}>
                        {d === null ? <span className="text-muted/50">—</span> : d === 0 ? "0" : `${d > 0 ? "+" : "−"}${formatarNumero(Math.abs(d))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialogo aberto={dialogo === "concluir"} titulo={`Concluir inventário ${inv.numero}?`} aoFechar={() => setDialogo(null)}
        rodape={<><Button onClick={() => setDialogo(null)}>Voltar</Button><Button variante="primario" disabled={ocupado} onClick={concluir}>Concluir e acertar estoque</Button></>}>
        <ul className="space-y-1 text-sm">
          <li>{contados} de {itens.length} itens contados.</li>
          <li>{comDiferenca} com diferença: viram ajustes de estoque.</li>
          {itens.length - contados > 0 && <li className="text-warn">{itens.length - contados} não contados ficam como estão.</li>}
          <li className="text-muted">Depois de concluído, o inventário não pode mais ser alterado.</li>
        </ul>
      </Dialogo>

      <Dialogo aberto={dialogo === "cancelar"} titulo={`Cancelar inventário ${inv.numero}?`} descricao="As contagens são descartadas e o estoque não muda." aoFechar={() => setDialogo(null)}
        rodape={<><Button onClick={() => setDialogo(null)}>Voltar</Button><Button variante="perigo" disabled={ocupado} onClick={cancelar}>Cancelar inventário</Button></>} />

      <Dialogo aberto={dialogo === "incluir"} titulo="Lote encontrado na contagem" descricao="Para produto ou lote que não aparece na lista." aoFechar={() => setDialogo(null)}
        rodape={<><Button onClick={() => setDialogo(null)}>Voltar</Button><Button variante="primario" disabled={ocupado} onClick={incluir}>Incluir</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label obrigatorio>Produto</Label>
            <BuscaRegistro autoFocus buscar={buscarProduto} selecionado={novo.produto} aoEscolher={(r) => setNovo({ ...novo, produto: r })} aoLimpar={() => setNovo({ ...novo, produto: null })} placeholder="Código ou nome" />
          </div>
          <div><Label htmlFor="inv-lote">Lote</Label><Input id="inv-lote" value={novo.lote} placeholder="Opcional" onChange={(e) => setNovo({ ...novo, lote: e.target.value })} /></div>
          <div><Label obrigatorio htmlFor="inv-val">Validade</Label><Input id="inv-val" type="date" value={novo.validade} onChange={(e) => setNovo({ ...novo, validade: e.target.value })} /></div>
          <div><Label obrigatorio htmlFor="inv-qtd">Quantidade contada</Label><Input id="inv-qtd" type="number" min="0" step="any" className="tabular text-right" value={novo.qtd} onChange={(e) => setNovo({ ...novo, qtd: e.target.value })} /></div>
        </div>
      </Dialogo>
    </>
  );
}
