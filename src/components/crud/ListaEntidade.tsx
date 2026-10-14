"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Columns3, Download, Plus, Search, ArrowUp, ArrowDown } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Select, Vazio } from "@/components/ui";
import { cn, DIAS_SEMANA, formatarData, formatarDocumento, formatarMoeda, formatarNumero, formatarTelefone } from "@/lib/utils";
import { obterEntidade, type Coluna } from "@/lib/entidades";
import { exportarExcel } from "@/components/crud/exportar";
import { Confirmar } from "@/components/crud/Confirmar";

const POR_PAGINA = 50;
type Linha = Record<string, unknown> & { id: string; ativo?: boolean };

export function valorCaminho(linha: Record<string, unknown>, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), linha);
}

export function formatarCelula(col: Coluna, v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-muted/50">—</span>;
  switch (col.tipo) {
    case "moeda": return formatarMoeda(v);
    case "numero": return formatarNumero(v);
    case "data": return formatarData(v);
    case "documento": return formatarDocumento(v);
    case "telefone": return formatarTelefone(v);
    case "booleano": return v ? <Badge tom="acento">Sim</Badge> : <span className="text-muted/60">Não</span>;
    case "dias_semana": return (v as number[]).map((d) => DIAS_SEMANA[d]).join(", ");
    case "opcao": return col.opcoes?.find((o) => o.valor === String(v))?.rotulo ?? String(v);
    default: return Array.isArray(v) ? v.join("/") : String(v);
  }
}

function textoCelula(col: Coluna, v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (col.tipo === "moeda" || col.tipo === "numero") return Number(v);
  if (col.tipo === "booleano") return v ? "Sim" : "Não";
  if (col.tipo === "data") return formatarData(v);
  if (col.tipo === "documento") return formatarDocumento(v);
  if (col.tipo === "dias_semana") return (v as number[]).map((d) => DIAS_SEMANA[d]).join(", ");
  if (col.tipo === "opcao") return col.opcoes?.find((o) => o.valor === String(v))?.rotulo ?? String(v);
  return Array.isArray(v) ? v.join("/") : String(v);
}

const limparBusca = (t: string) => t.replace(/[,()%*\\]/g, " ").trim();

export function ListaEntidade({ slug, podeCriar, podeEditar, podeExcluir }: { slug: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean }) {
  const entidade = obterEntidade(slug)!;
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const chaveColunas = `colunas:${slug}`;

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [situacao, setSituacao] = useState<"ativos" | "inativos" | "todos">("ativos");
  const [filtroRapido, setFiltroRapido] = useState<number | null>(null);
  const [ordem, setOrdem] = useState(entidade.ordem);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [visiveis, setVisiveis] = useState<string[]>(() => entidade.colunas.filter((c) => !c.oculta).map((c) => c.nome));
  const [menuColunas, setMenuColunas] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(chaveColunas);
      if (salvo) setVisiveis(JSON.parse(salvo));
    } catch {}
  }, [chaveColunas]);

  const consulta = useCallback(
    (comContagem: boolean) => {
      let q = supabase.from(entidade.tabela).select(entidade.select ?? "*", comContagem ? { count: "exact" } : undefined);
      if (situacao !== "todos") q = q.eq("ativo", situacao === "ativos");
      if (filtroRapido !== null) {
        for (const [k, v] of Object.entries(entidade.filtrosRapidos![filtroRapido].filtro)) q = q.eq(k, v);
      }
      const termo = limparBusca(buscaAplicada);
      if (termo) {
        const digitos = termo.replace(/\D/g, "");
        const conds = entidade.busca.map((c) => `${c}.ilike.%${c === "documento" && digitos ? digitos : termo}%`);
        q = q.or(conds.join(","));
      }
      return q.order(ordem.coluna, { ascending: ordem.asc, nullsFirst: false });
    },
    [supabase, entidade, situacao, filtroRapido, buscaAplicada, ordem],
  );

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, count, error } = await consulta(true).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    setCarregando(false);
    if (error) {
      toast.error("Não foi possível carregar a lista", { description: error.message });
      return;
    }
    setLinhas((data ?? []) as unknown as Linha[]);
    setTotal(count ?? 0);
    setSelecionados(new Set());
  }, [consulta, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function aoDigitar(v: string) {
    setBusca(v);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      setPagina(0);
      setBuscaAplicada(v);
    }, 350);
  }

  function alternarColuna(nome: string) {
    const nova = visiveis.includes(nome) ? visiveis.filter((n) => n !== nome) : entidade.colunas.map((c) => c.nome).filter((n) => n === nome || visiveis.includes(n));
    setVisiveis(nova);
    try {
      localStorage.setItem(chaveColunas, JSON.stringify(nova));
    } catch {}
  }

  function ordenar(col: Coluna) {
    if (!col.ordenavel) return;
    setOrdem((o) => (o.coluna === col.nome ? { coluna: col.nome, asc: !o.asc } : { coluna: col.nome, asc: true }));
  }

  async function mudarSituacao(ativo: boolean) {
    const ids = [...selecionados];
    const { error } = await supabase.from(entidade.tabela).update({ ativo }).in("id", ids);
    if (error) return toast.error("Não foi possível alterar", { description: error.message });
    toast.success(`${ids.length} ${ids.length === 1 ? "registro" : "registros"} ${ativo ? "ativado(s)" : "inativado(s)"}`);
    carregar();
  }

  async function excluir() {
    const ids = [...selecionados];
    const { error } = await supabase.from(entidade.tabela).delete().in("id", ids);
    setConfirmarExclusao(false);
    if (error) {
      const emUso = error.code === "23503";
      return toast.error(emUso ? "Há registros em uso por outros cadastros" : "Não foi possível excluir", {
        description: emUso ? "Use Inativar para tirar da lista sem perder o histórico." : error.message,
      });
    }
    toast.success(`${ids.length} ${ids.length === 1 ? "registro excluído" : "registros excluídos"}`);
    carregar();
  }

  async function exportar() {
    const colunas = entidade.colunas.filter((c) => visiveis.includes(c.nome));
    let dados: Linha[];
    if (selecionados.size) dados = linhas.filter((l) => selecionados.has(l.id));
    else {
      const { data, error } = await consulta(false).limit(5000);
      if (error) return toast.error("Não foi possível exportar", { description: error.message });
      dados = (data ?? []) as unknown as Linha[];
    }
    await exportarExcel(
      entidade.titulo,
      colunas.map((c) => c.rotulo),
      dados.map((l) => colunas.map((c) => textoCelula(c, valorCaminho(l, c.nome)))),
    );
  }

  const colunas = entidade.colunas.filter((c) => visiveis.includes(c.nome));
  const todosMarcados = linhas.length > 0 && linhas.every((l) => selecionados.has(l.id));
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <>
      <Cabecalho
        trilha={entidade.trilha}
        titulo={entidade.titulo}
        acoes={
          podeCriar && (
            <Link href={`/cadastros/${slug}/novo`}>
              <Button variante="primario"><Plus size={16} /> Novo</Button>
            </Link>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <Input
              value={busca}
              onChange={(e) => aoDigitar(e.target.value)}
              placeholder={`Buscar por ${entidade.busca.map((b) => entidade.campos.find((c) => c.nome === b)?.rotulo.toLowerCase() ?? b).join(", ")}`}
              className="pl-8"
              aria-label="Buscar"
            />
          </div>
          <Select value={situacao} onChange={(e) => { setPagina(0); setSituacao(e.target.value as typeof situacao); }} className="w-auto" aria-label="Situação">
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </Select>
          <div className="relative">
            <Button onClick={() => setMenuColunas((m) => !m)} aria-expanded={menuColunas}><Columns3 size={16} /> Colunas</Button>
            {menuColunas && (
              <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-lg">
                {entidade.colunas.map((c) => (
                  <label key={c.nome} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                    <input type="checkbox" className="accent-[var(--accent)]" checked={visiveis.includes(c.nome)} onChange={() => alternarColuna(c.nome)} />
                    {c.rotulo}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button onClick={exportar}><Download size={16} /> Excel</Button>
        </div>

        {entidade.filtrosRapidos && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
            {entidade.filtrosRapidos.map((f, i) => (
              <button
                key={f.rotulo}
                onClick={() => { setPagina(0); setFiltroRapido(filtroRapido === i ? null : i); }}
                className={cn("rounded-full border px-3 py-1 text-xs", filtroRapido === i ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
        )}

        {selecionados.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-accent-soft px-3 py-2 text-sm">
            <span className="font-medium">{selecionados.size} selecionado(s)</span>
            {podeEditar && <Button tamanho="p" onClick={() => mudarSituacao(true)}>Ativar</Button>}
            {podeEditar && <Button tamanho="p" onClick={() => mudarSituacao(false)}>Inativar</Button>}
            {podeExcluir && <Button tamanho="p" variante="perigo" onClick={() => setConfirmarExclusao(true)}>Excluir</Button>}
            <Button tamanho="p" variante="fantasma" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" aria-label="Selecionar todos" className="accent-[var(--accent)]" checked={todosMarcados}
                    onChange={() => setSelecionados(todosMarcados ? new Set() : new Set(linhas.map((l) => l.id)))} />
                </th>
                {colunas.map((c) => {
                  const direita = c.tipo === "moeda" || c.tipo === "numero";
                  return (
                    <th key={c.nome} className={cn("px-3 py-2 font-medium whitespace-nowrap", direita && "text-right")}>
                      {c.ordenavel ? (
                        <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => ordenar(c)}>
                          {c.rotulo}
                          {ordem.coluna === c.nome && (ordem.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                        </button>
                      ) : c.rotulo}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => router.push(`/cadastros/${slug}/${l.id}`)}
                  className={cn("cursor-pointer border-b border-line/70 hover:bg-surface-2/70", l.ativo === false && "text-muted", selecionados.has(l.id) && "bg-accent-soft/50")}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label="Selecionar" className="accent-[var(--accent)]" checked={selecionados.has(l.id)}
                      onChange={() => {
                        const s = new Set(selecionados);
                        if (s.has(l.id)) s.delete(l.id);
                        else s.add(l.id);
                        setSelecionados(s);
                      }} />
                  </td>
                  {colunas.map((c) => (
                    <td key={c.nome} className={cn("px-3 py-2", (c.tipo === "moeda" || c.tipo === "numero") && "tabular text-right whitespace-nowrap")}>
                      {formatarCelula(c, valorCaminho(l, c.nome))}
                      {c === colunas[0] && l.ativo === false && <span className="ml-2"><Badge>Inativo</Badge></span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!carregando && linhas.length === 0 && (
            <Vazio
              titulo={buscaAplicada || filtroRapido !== null ? "Nada encontrado com esses filtros" : `Nenhum${entidade.feminino ? "a" : ""} ${entidade.singular} cadastrad${entidade.feminino ? "a" : "o"}`}
              texto={buscaAplicada ? "Confira a grafia ou limpe a busca." : podeCriar ? "Clique em Novo para cadastrar, ou use Importar planilha no menu Cadastros." : undefined}
            />
          )}
          {carregando && linhas.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">Carregando...</div>}
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
          <span className="tabular">{total} {total === 1 ? "registro" : "registros"}</span>
          <div className="flex items-center gap-2">
            <Button tamanho="p" variante="fantasma" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></Button>
            <span className="tabular">Página {pagina + 1} de {paginas}</span>
            <Button tamanho="p" variante="fantasma" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página"><ChevronRight size={16} /></Button>
          </div>
        </div>
      </Card>

      <Confirmar
        aberto={confirmarExclusao}
        titulo={`Excluir ${selecionados.size} ${selecionados.size === 1 ? "registro" : "registros"}?`}
        texto="A exclusão não pode ser desfeita. Registros já usados em pedidos ou notas não podem ser excluídos; nesse caso use Inativar."
        rotuloConfirmar="Excluir"
        perigo
        aoConfirmar={excluir}
        aoCancelar={() => setConfirmarExclusao(false)}
      />
    </>
  );
}
