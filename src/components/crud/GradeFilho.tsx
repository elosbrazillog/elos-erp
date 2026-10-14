"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X, Percent, ListPlus } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Card, Input, Vazio } from "@/components/ui";
import { cn, formatarMoeda } from "@/lib/utils";
import type { Filho } from "@/lib/entidades";
import { buscarCep, CampoInput, paraBanco, paraInput, useOpcoes, validarCampo } from "@/components/crud/CampoInput";
import { formatarCelula } from "@/components/crud/ListaEntidade";
import { Confirmar } from "@/components/crud/Confirmar";

type Linha = Record<string, unknown> & { id: string };

function CelulaLeitura({ campo, valor }: { campo: Filho["campos"][number]; valor: unknown }) {
  const opcoes = useOpcoes(campo);
  if (campo.tipo === "relacao" || campo.tipo === "select")
    return <>{opcoes.find((o) => o.valor === String(valor))?.rotulo ?? (valor ? "…" : "—")}</>;
  if (campo.tipo === "moeda") return <>{formatarMoeda(valor)}</>;
  if (campo.tipo === "booleano") return <>{valor ? "Sim" : "Não"}</>;
  return <>{formatarCelula({ nome: campo.nome, rotulo: campo.rotulo, tipo: campo.tipo === "telefone" ? "telefone" : "texto" }, valor)}</>;
}

export function GradeFilho({ filho, paiId, podeEditar }: { filho: Filho; paiId: string; podeEditar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [editando, setEditando] = useState<string | null>(null); // id ou "novo"
  const [rascunho, setRascunho] = useState<Record<string, unknown>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [excluir, setExcluir] = useState<string | null>(null);
  const [percentual, setPercentual] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    let q = supabase.from(filho.tabela).select("*").eq(filho.fk, paiId);
    if (filho.ordem) q = q.order(filho.ordem);
    const { data, error } = await q.order("criado_em");
    if (error) return toast.error("Erro ao carregar", { description: error.message });
    setLinhas((data ?? []) as Linha[]);
  }, [supabase, filho, paiId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function iniciar(l?: Linha) {
    const r: Record<string, unknown> = {};
    for (const c of filho.campos) r[c.nome] = paraInput(c, l ? l[c.nome] : (c.padrao ?? null));
    setRascunho(r);
    setErros({});
    setEditando(l ? l.id : "novo");
  }

  async function salvar() {
    const es: Record<string, string> = {};
    for (const c of filho.campos) {
      const e = validarCampo(c, rascunho[c.nome]);
      if (e) es[c.nome] = e;
    }
    setErros(es);
    if (Object.keys(es).length) return;
    const reg: Record<string, unknown> = { [filho.fk]: paiId };
    for (const c of filho.campos) reg[c.nome] = paraBanco(c, rascunho[c.nome]);
    const { error } =
      editando === "novo"
        ? await supabase.from(filho.tabela).insert(reg)
        : await supabase.from(filho.tabela).update(reg).eq("id", editando!);
    if (error) {
      return toast.error("Não foi possível salvar", { description: error.code === "23505" ? "Esse item já está na lista." : error.message });
    }
    setEditando(null);
    carregar();
  }

  async function remover() {
    const { error } = await supabase.from(filho.tabela).delete().eq("id", excluir!);
    setExcluir(null);
    if (error) return toast.error("Não foi possível remover", { description: error.message });
    carregar();
  }

  async function aoSair(nome: string) {
    const c = filho.campos.find((x) => x.nome === nome);
    if (c?.tipo !== "cep") return;
    const end = await buscarCep(String(rascunho[nome] ?? ""));
    if (end) setRascunho((r) => ({ ...r, ...Object.fromEntries(Object.entries(end).filter(([k, v]) => v && k in r && !r[k])) }));
  }

  // Tabela de preço: incluir todos os produtos ativos que ainda não estão nela
  async function preencherProdutos() {
    setOcupado(true);
    const { data: produtos, error } = await supabase.from("produtos").select("id, preco_venda, preco_minimo").eq("ativo", true);
    if (error) { setOcupado(false); return toast.error(error.message); }
    const ja = new Set(linhas.map((l) => String(l.produto_id)));
    const novos = (produtos ?? []).filter((p) => !ja.has(p.id)).map((p) => ({ [filho.fk]: paiId, produto_id: p.id, preco: p.preco_venda, preco_minimo: p.preco_minimo }));
    if (novos.length) {
      const { error: e2 } = await supabase.from(filho.tabela).insert(novos);
      if (e2) { setOcupado(false); return toast.error(e2.message); }
    }
    setOcupado(false);
    toast.success(novos.length ? `${novos.length} produtos incluídos com o preço base` : "Todos os produtos já estão na tabela");
    carregar();
  }

  async function reajustar() {
    const p = Number(percentual.replace(",", "."));
    if (!p || Number.isNaN(p)) return toast.error("Informe o percentual, por exemplo 5 ou -3");
    setOcupado(true);
    const fator = 1 + p / 100;
    const resultados = await Promise.all(
      linhas.map((l) =>
        supabase.from(filho.tabela).update({
          preco: Math.round(Number(l.preco) * fator * 100) / 100,
          preco_minimo: l.preco_minimo == null ? null : Math.round(Number(l.preco_minimo) * fator * 100) / 100,
        }).eq("id", l.id),
      ),
    );
    setOcupado(false);
    const falhas = resultados.filter((r) => r.error).length;
    if (falhas) toast.error(`${falhas} itens não foram reajustados`);
    else toast.success(`Preços reajustados em ${p}%`);
    setPercentual("");
    carregar();
  }

  const camposVisiveis = filho.campos.filter((c) => c.tipo !== "textarea");

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <div className="text-sm font-medium">{filho.titulo} <span className="text-muted">({linhas.length})</span></div>
        {podeEditar && (
          <div className="flex flex-wrap items-center gap-2">
            {filho.reajuste && linhas.length > 0 && (
              <div className="flex items-center gap-1">
                <Input value={percentual} onChange={(e) => setPercentual(e.target.value)} placeholder="%" className="h-8 w-16 text-right" aria-label="Percentual de reajuste" inputMode="decimal" />
                <Button tamanho="p" onClick={reajustar} disabled={ocupado}><Percent size={14} /> Reajustar</Button>
              </div>
            )}
            {filho.preencherProdutos && (
              <Button tamanho="p" onClick={preencherProdutos} disabled={ocupado}><ListPlus size={14} /> Incluir todos os produtos</Button>
            )}
            <Button tamanho="p" variante="primario" onClick={() => iniciar()} disabled={editando !== null}><Plus size={14} /> Adicionar</Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
              {camposVisiveis.map((c) => (
                <th key={c.nome} className={cn("px-3 py-2 font-medium whitespace-nowrap", c.tipo === "moeda" && "text-right")}>{c.rotulo}</th>
              ))}
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {[...linhas, ...(editando === "novo" ? [{ id: "novo" } as Linha] : [])].map((l) =>
              editando === l.id ? (
                <tr key={l.id} className="border-b border-line bg-accent-soft/40 align-top">
                  {camposVisiveis.map((c) => (
                    <td key={c.nome} className="min-w-32 px-2 py-2">
                      <CampoInput campo={c} compacto valor={rascunho[c.nome]} erro={erros[c.nome]}
                        onChange={(v) => setRascunho((r) => ({ ...r, [c.nome]: v }))} onBlur={() => aoSair(c.nome)} />
                      {erros[c.nome] && <div className="mt-0.5 text-[11px] text-bad">{erros[c.nome]}</div>}
                    </td>
                  ))}
                  <td className="px-2 py-2 whitespace-nowrap">
                    <Button tamanho="p" variante="primario" onClick={salvar} aria-label="Salvar"><Check size={14} /></Button>{" "}
                    <Button tamanho="p" variante="fantasma" onClick={() => setEditando(null)} aria-label="Cancelar"><X size={14} /></Button>
                  </td>
                </tr>
              ) : (
                <tr key={l.id} className="border-b border-line/70">
                  {camposVisiveis.map((c) => (
                    <td key={c.nome} className={cn("px-3 py-2", c.tipo === "moeda" && "tabular text-right")}>
                      <CelulaLeitura campo={c} valor={l[c.nome]} />
                    </td>
                  ))}
                  <td className="px-2 py-1 whitespace-nowrap text-right">
                    {podeEditar && editando === null && (
                      <>
                        <Button tamanho="p" variante="fantasma" onClick={() => iniciar(l)} aria-label="Editar"><Pencil size={14} /></Button>
                        <Button tamanho="p" variante="fantasma" onClick={() => setExcluir(l.id)} aria-label="Remover"><Trash2 size={14} /></Button>
                      </>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {linhas.length === 0 && editando !== "novo" && <Vazio titulo={`Nenhum item em ${filho.titulo.toLowerCase()}`} />}
      </div>

      <Confirmar aberto={!!excluir} titulo="Remover este item?" rotuloConfirmar="Remover" perigo aoConfirmar={remover} aoCancelar={() => setExcluir(null)} />
    </Card>
  );
}
