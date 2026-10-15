"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Plus, Search, Trash2, UsersRound } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Select, Vazio } from "@/components/ui";
import { cn, dataLocal, formatarData, formatarMoeda, formatarNumero, formatarTelefone } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";

type Pessoa = {
  id: string; codigo: number; razao_social: string; nome_fantasia: string | null; documento: string | null; whatsapp: string | null; telefone: string | null;
  eh_vendedor: boolean; eh_motorista: boolean; comissao_percentual: number | null; meta_mensal: number | null;
  cnh_numero: string | null; cnh_categoria: string | null; cnh_validade: string | null; regiao: string | null; ativo: boolean;
  veiculo: { placa: string } | null; supervisor: { razao_social: string } | null;
};
type Linha = { nome: string; funcao: "motorista" | "vendedor" | "ambos"; documento: string; whatsapp: string; cnh: string; categoria: string; validade: string; comissao: string; meta: string; regiao: string };

const LINHAS = 10;
const vazia = (): Linha => ({ nome: "", funcao: "vendedor", documento: "", whatsapp: "", cnh: "", categoria: "", validade: "", comissao: "", meta: "", regiao: "" });
const num = (t: string) => { const s = t.trim().replace(/\./g, "").replace(",", "."); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };

export function Equipe({ podeCriar }: { podeCriar: boolean }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "vendedores" | "motoristas">("todos");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>(() => Array.from({ length: LINHAS }, vazia));
  const [cadastrando, setCadastrando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("pessoas")
      .select("id, codigo, razao_social, nome_fantasia, documento, whatsapp, telefone, eh_vendedor, eh_motorista, comissao_percentual, meta_mensal, cnh_numero, cnh_categoria, cnh_validade, regiao, ativo, veiculo:veiculo_padrao_id(placa), supervisor:supervisor_id(razao_social)")
      .or("eh_vendedor.eq.true,eh_motorista.eq.true").order("razao_social").limit(1000);
    if (error) return toast.error("Não foi possível carregar", { description: mensagemErro(error) });
    setPessoas((data ?? []) as unknown as Pessoa[]);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  const hoje = dataLocal();
  const em30 = dataLocal(30);
  const t = busca.trim().toLowerCase();
  const lista = (pessoas ?? []).filter((p) =>
    (filtro === "todos" || (filtro === "vendedores" ? p.eh_vendedor : p.eh_motorista)) &&
    (!t || `${p.codigo} ${p.razao_social} ${p.nome_fantasia ?? ""} ${p.regiao ?? ""}`.toLowerCase().includes(t)));
  const qtdV = (pessoas ?? []).filter((p) => p.eh_vendedor && p.ativo).length;
  const qtdM = (pessoas ?? []).filter((p) => p.eh_motorista && p.ativo).length;

  function mudar(i: number, campo: keyof Linha, v: string) {
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: v } : l)));
  }

  async function salvar() {
    const preenchidas = linhas.filter((l) => l.nome.trim());
    if (!preenchidas.length) return toast.error("Preencha o nome de ao menos uma pessoa");
    for (const l of preenchidas) {
      if ([num(l.comissao), num(l.meta)].some((n) => Number.isNaN(n))) return toast.error(`Valor inválido na linha de ${l.nome}`);
    }
    const registros = preenchidas.map((l) => {
      const doc = l.documento.replace(/\D/g, "");
      const motorista = l.funcao !== "vendedor", vendedor = l.funcao !== "motorista";
      return {
        tipo_pessoa: doc.length === 14 ? "PJ" : "PF",
        razao_social: l.nome.trim(), documento: doc || null, whatsapp: l.whatsapp.replace(/\D/g, "") || null,
        eh_cliente: false, eh_vendedor: vendedor, eh_motorista: motorista,
        cnh_numero: motorista ? l.cnh.trim() || null : null, cnh_categoria: motorista ? l.categoria || null : null,
        cnh_validade: motorista ? l.validade || null : null,
        comissao_percentual: vendedor ? num(l.comissao) : null, meta_mensal: vendedor ? num(l.meta) : null,
        regiao: l.regiao.trim() || null,
      };
    });
    setSalvando(true);
    const { error } = await supabase.from("pessoas").insert(registros);
    setSalvando(false);
    if (error) return toast.error("Não foi possível cadastrar", { description: mensagemErro(error) });
    toast.success(`${registros.length} ${registros.length === 1 ? "pessoa cadastrada" : "pessoas cadastradas"}`);
    setLinhas(Array.from({ length: LINHAS }, vazia));
    setCadastrando(false);
    carregar();
  }

  return (
    <>
      <Cabecalho trilha="Cadastros" titulo="Motoristas e vendedores"
        acoes={podeCriar && !cadastrando && <Button variante="primario" onClick={() => setCadastrando(true)}><Plus size={16} /> Cadastrar até {LINHAS} de uma vez</Button>} />

      {cadastrando && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="text-sm font-medium">Novos cadastros <span className="font-normal text-muted">· preencha só as linhas que precisar; o resto fica em branco</span></div>
            <Button tamanho="p" onClick={() => setLinhas((ls) => [...ls, ...Array.from({ length: LINHAS }, vazia)])}><Plus size={14} /> Mais {LINHAS} linhas</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="w-8 px-2 py-2 font-medium">#</th>
                  <th className="px-1 py-2 font-medium">Nome *</th>
                  <th className="w-32 px-1 py-2 font-medium">Função</th>
                  <th className="w-36 px-1 py-2 font-medium">CPF</th>
                  <th className="w-36 px-1 py-2 font-medium">WhatsApp</th>
                  <th className="w-32 px-1 py-2 font-medium">CNH</th>
                  <th className="w-20 px-1 py-2 font-medium">Cat.</th>
                  <th className="w-36 px-1 py-2 font-medium">Validade CNH</th>
                  <th className="w-20 px-1 py-2 font-medium">Comissão %</th>
                  <th className="w-28 px-1 py-2 font-medium">Meta (R$)</th>
                  <th className="w-32 px-1 py-2 font-medium">Região</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const ehMot = l.funcao !== "vendedor", ehVend = l.funcao !== "motorista";
                  return (
                    <tr key={i} className="border-b border-line/50">
                      <td className="tabular px-2 text-xs text-muted">{i + 1}</td>
                      <td className="px-1 py-1"><Input value={l.nome} onChange={(e) => mudar(i, "nome", e.target.value)} aria-label={`Nome da linha ${i + 1}`} className="h-8" /></td>
                      <td className="px-1 py-1">
                        <Select value={l.funcao} onChange={(e) => mudar(i, "funcao", e.target.value)} aria-label={`Função da linha ${i + 1}`} className="h-8">
                          <option value="vendedor">Vendedor</option><option value="motorista">Motorista</option><option value="ambos">Os dois</option>
                        </Select>
                      </td>
                      <td className="px-1 py-1"><Input value={l.documento} inputMode="numeric" onChange={(e) => mudar(i, "documento", e.target.value)} aria-label={`CPF da linha ${i + 1}`} className="h-8" /></td>
                      <td className="px-1 py-1"><Input value={l.whatsapp} inputMode="tel" onChange={(e) => mudar(i, "whatsapp", e.target.value)} aria-label={`WhatsApp da linha ${i + 1}`} className="h-8" /></td>
                      <td className="px-1 py-1"><Input value={l.cnh} disabled={!ehMot} onChange={(e) => mudar(i, "cnh", e.target.value)} aria-label={`CNH da linha ${i + 1}`} className="h-8" /></td>
                      <td className="px-1 py-1">
                        <Select value={l.categoria} disabled={!ehMot} onChange={(e) => mudar(i, "categoria", e.target.value)} aria-label={`Categoria da CNH da linha ${i + 1}`} className="h-8">
                          <option value="" />{["A", "B", "AB", "C", "D", "E", "AC", "AD", "AE"].map((c) => <option key={c} value={c}>{c}</option>)}
                        </Select>
                      </td>
                      <td className="px-1 py-1"><Input type="date" value={l.validade} disabled={!ehMot} onChange={(e) => mudar(i, "validade", e.target.value)} aria-label={`Validade da CNH da linha ${i + 1}`} className="h-8" /></td>
                      <td className="px-1 py-1"><Input value={l.comissao} disabled={!ehVend} inputMode="decimal" onChange={(e) => mudar(i, "comissao", e.target.value)} aria-label={`Comissão da linha ${i + 1}`} className="h-8 text-right" /></td>
                      <td className="px-1 py-1"><Input value={l.meta} disabled={!ehVend} inputMode="decimal" onChange={(e) => mudar(i, "meta", e.target.value)} aria-label={`Meta da linha ${i + 1}`} className="h-8 text-right" /></td>
                      <td className="px-1 py-1"><Input value={l.regiao} onChange={(e) => mudar(i, "regiao", e.target.value)} aria-label={`Região da linha ${i + 1}`} className="h-8" /></td>
                      <td className="px-1">
                        <button className="rounded p-1 text-muted hover:text-bad" onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, k) => k !== i) : [vazia()]))} aria-label={`Limpar linha ${i + 1}`}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-xs text-muted">Endereço, supervisor, veículo, PIX, admissão e contato de emergência ficam na aba Equipe do cadastro de cada pessoa.</span>
            <div className="flex gap-2">
              <Button onClick={() => { setCadastrando(false); setLinhas(Array.from({ length: LINHAS }, vazia)); }}>Cancelar</Button>
              <Button variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Salvando..." : `Cadastrar ${linhas.filter((l) => l.nome.trim()).length || ""}`}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, código ou região" className="pl-8" aria-label="Buscar" />
          </div>
          {([["todos", `Todos (${qtdV + qtdM})`], ["vendedores", `Vendedores (${qtdV})`], ["motoristas", `Motoristas (${qtdM})`]] as const).map(([k, r]) => (
            <button key={k} onClick={() => setFiltro(k)} aria-pressed={filtro === k}
              className={cn("rounded-full border px-3 py-1 text-xs", filtro === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>{r}</button>
          ))}
        </div>
        {pessoas === null ? <div className="py-10 text-center text-sm text-muted">Carregando...</div>
          : lista.length === 0 ? <Vazio titulo="Ninguém cadastrado ainda" texto="Use Cadastrar até 10 de uma vez para lançar a equipe." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Função</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">WhatsApp</th>
                    <th className="px-3 py-2 font-medium">CNH / veículo</th>
                    <th className="hidden px-3 py-2 text-right font-medium lg:table-cell">Comissão</th>
                    <th className="hidden px-3 py-2 text-right font-medium lg:table-cell">Meta</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Região / supervisor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {lista.map((p) => {
                    const vencida = p.cnh_validade && p.cnh_validade < hoje;
                    const vencendo = p.cnh_validade && !vencida && p.cnh_validade <= em30;
                    return (
                      <tr key={p.id} className={cn(!p.ativo && "opacity-50")}>
                        <td className="px-3 py-2">
                          <Link href={`/cadastros/pessoas/${p.id}`} className="font-medium hover:text-accent">{p.razao_social}</Link>
                          <div className="text-xs text-muted">cód. {p.codigo}{!p.ativo ? " · inativo" : ""}</div>
                        </td>
                        <td className="px-3 py-2"><div className="flex flex-wrap gap-1">
                          {p.eh_vendedor && <Badge tom="acento">Vendedor</Badge>}{p.eh_motorista && <Badge>Motorista</Badge>}
                        </div></td>
                        <td className="hidden px-3 py-2 md:table-cell">{p.whatsapp ? formatarTelefone(p.whatsapp) : <span className="text-muted/50">—</span>}</td>
                        <td className="px-3 py-2 text-xs">
                          {p.eh_motorista ? (
                            <>
                              <div>{p.cnh_numero ? `${p.cnh_numero}${p.cnh_categoria ? ` · ${p.cnh_categoria}` : ""}` : <span className="text-muted">sem CNH cadastrada</span>}</div>
                              {p.cnh_validade && (
                                <div className={cn("flex items-center gap-1", vencida ? "text-bad" : vencendo ? "text-warn" : "text-muted")}>
                                  {(vencida || vencendo) && <AlertTriangle size={11} />}{vencida ? "vencida em" : "vence"} {formatarData(p.cnh_validade)}
                                </div>
                              )}
                              {p.veiculo && <div className="text-muted">veículo {p.veiculo.placa}</div>}
                            </>
                          ) : <span className="text-muted/50">—</span>}
                        </td>
                        <td className="tabular hidden px-3 py-2 text-right lg:table-cell">{p.eh_vendedor && p.comissao_percentual !== null ? `${formatarNumero(p.comissao_percentual)}%` : <span className="text-muted/50">—</span>}</td>
                        <td className="tabular hidden px-3 py-2 text-right lg:table-cell">{p.eh_vendedor && p.meta_mensal ? formatarMoeda(p.meta_mensal) : <span className="text-muted/50">—</span>}</td>
                        <td className="hidden px-3 py-2 text-xs md:table-cell">
                          {p.regiao ?? <span className="text-muted/50">—</span>}
                          {p.supervisor && <div className="text-muted">sup. {p.supervisor.razao_social}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted"><UsersRound size={13} /> Para o vendedor usar o app ou o motorista registrar entregas, ligue o usuário dele à pessoa em Configurações › Usuários.</div>
      </Card>
    </>
  );
}
