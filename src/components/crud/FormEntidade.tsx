"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Trash2, ArrowLeft, Search } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Abas, Badge, Button, Cabecalho, Card, Label } from "@/components/ui";
import { cn, documentoValido } from "@/lib/utils";
import { artigo, obterEntidade, type Campo } from "@/lib/entidades";
import { buscarCep, CampoInput, limparCacheRelacoes, paraBanco, paraInput, validarCampo } from "@/components/crud/CampoInput";
import { GradeFilho } from "@/components/crud/GradeFilho";
import { Confirmar } from "@/components/crud/Confirmar";
import { ClientesDaRota } from "@/components/cadastros/ClientesDaRota";
import { FinanceiroCliente } from "@/components/cadastros/FinanceiroCliente";
import { HistoricoCliente } from "@/components/cadastros/HistoricoCliente";
import { EstoqueProduto } from "@/components/cadastros/EstoqueProduto";

type Dados = Record<string, unknown>;

const largura = (l?: number) =>
  l === 4 ? "sm:col-span-2 lg:col-span-4" : l === 3 ? "sm:col-span-2 lg:col-span-3" : l === 2 ? "sm:col-span-2" : "";

const EXTRAS: Record<string, { titulo: string; Componente: React.ComponentType<{ id: string }> }> = {
  clientes_rota: { titulo: "Clientes da rota", Componente: ClientesDaRota },
  financeiro_cliente: { titulo: "Financeiro", Componente: FinanceiroCliente },
  historico_cliente: { titulo: "Histórico de compras", Componente: HistoricoCliente },
  estoque_produto: { titulo: "Estoque por lote", Componente: EstoqueProduto },
};

export function FormEntidade({
  slug, id, podeSalvar, podeExcluir, semVoltar,
}: { slug: string; id?: string; podeSalvar: boolean; podeExcluir: boolean; semVoltar?: boolean }) {
  const entidade = obterEntidade(slug)!;
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const novo = !id;

  const inicial = useMemo(() => {
    const d: Dados = {};
    for (const c of entidade.campos) d[c.nome] = paraInput(c, c.padrao ?? null);
    return d;
  }, [entidade]);

  const [dados, setDados] = useState<Dados>(inicial);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ativo, setAtivo] = useState(true);
  const [carregando, setCarregando] = useState(!novo);
  const [salvando, setSalvando] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [enderecoPendente, setEnderecoPendente] = useState<Dados | null>(null);

  const abasCampos = entidade.abas ?? ["Dados"];
  const abasFilhos = novo ? [] : (entidade.filhos ?? []).map((f) => f.titulo);
  const abasExtras = novo ? [] : (entidade.componentesExtras ?? []).map((k) => EXTRAS[k].titulo);
  const todasAbas = [...abasCampos, ...abasFilhos, ...abasExtras];
  const [aba, setAba] = useState(todasAbas[0]);

  useEffect(() => {
    if (novo) return;
    (async () => {
      const { data, error } = await supabase.from(entidade.tabela).select("*").eq("id", id).maybeSingle();
      setCarregando(false);
      if (error || !data) {
        toast.error("Registro não encontrado ou sem permissão");
        return;
      }
      const d: Dados = {};
      for (const c of entidade.campos) d[c.nome] = paraInput(c, (data as Dados)[c.nome]);
      setDados(d);
      setAtivo((data as Dados).ativo !== false);
    })();
  }, [novo, id, supabase, entidade]);

  // aviso ao sair com alterações não salvas
  useEffect(() => {
    if (!alterado) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [alterado]);

  function mudar(campo: Campo, v: unknown) {
    setDados((d) => ({ ...d, [campo.nome]: v }));
    setAlterado(true);
    if (erros[campo.nome]) setErros((e) => ({ ...e, [campo.nome]: "" }));
  }

  async function aoSairDoCampo(campo: Campo) {
    if (campo.tipo === "cep") {
      const end = await buscarCep(String(dados[campo.nome] ?? ""));
      if (end) {
        setDados((d) => {
          const n = { ...d };
          for (const [k, v] of Object.entries(end)) if (k in n && v && !n[k]) n[k] = v;
          return n;
        });
      }
    }
    if (campo.tipo === "documento") {
      const d = String(dados[campo.nome] ?? "").replace(/\D/g, "");
      if (d && !documentoValido(d)) setErros((e) => ({ ...e, [campo.nome]: "Dígitos verificadores não conferem" }));
    }
  }

  async function buscarCnpj() {
    const cnpj = String(dados.documento ?? "").replace(/\D/g, "");
    if (cnpj.length !== 14) return toast.error("Digite um CNPJ com 14 dígitos");
    const t = toast.loading("Consultando CNPJ...");
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (!r.ok) throw new Error("CNPJ não encontrado");
      const j = await r.json();
      setDados((d) => ({
        ...d,
        tipo_pessoa: "PJ",
        razao_social: j.razao_social || d.razao_social,
        nome_fantasia: j.nome_fantasia || d.nome_fantasia,
        telefone: d.telefone || (j.ddd_telefone_1 ? String(j.ddd_telefone_1).replace(/\D/g, "") : ""),
        email: d.email || (j.email ? String(j.email).toLowerCase() : ""),
      }));
      setEnderecoPendente({
        tipo: "principal", cep: j.cep, logradouro: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(" "),
        numero: j.numero, complemento: j.complemento, bairro: j.bairro, cidade: j.municipio, uf: j.uf, codigo_ibge: j.codigo_municipio_ibge ? String(j.codigo_municipio_ibge) : null,
      });
      setAlterado(true);
      toast.success(`${j.razao_social}`, { id: t, description: j.descricao_situacao_cadastral ? `Situação: ${j.descricao_situacao_cadastral}` : undefined });
    } catch (e) {
      toast.error("Não foi possível consultar o CNPJ", { id: t, description: (e as Error).message });
    }
  }

  async function salvar() {
    const novosErros: Record<string, string> = {};
    for (const c of entidade.campos) {
      const er = validarCampo(c, dados[c.nome]);
      if (er) novosErros[c.nome] = er;
    }
    setErros(novosErros);
    const primeiro = Object.keys(novosErros)[0];
    if (primeiro) {
      const campo = entidade.campos.find((c) => c.nome === primeiro)!;
      if (campo.aba) setAba(campo.aba);
      return toast.error("Corrija os campos destacados", { description: `${campo.rotulo}: ${novosErros[primeiro]}` });
    }

    const registro: Dados = {};
    for (const c of entidade.campos) if (!c.somenteLeitura) registro[c.nome] = paraBanco(c, dados[c.nome]);
    registro.ativo = ativo;

    setSalvando(true);
    const q = novo
      ? supabase.from(entidade.tabela).insert(registro).select("id").single()
      : supabase.from(entidade.tabela).update(registro).eq("id", id).select("id").single();
    const { data, error } = await q;
    setSalvando(false);

    if (error) {
      const msg = error.code === "23505" ? "Já existe um cadastro com esse código, nome ou documento." : error.message;
      return toast.error("Não foi possível salvar", { description: msg });
    }
    limparCacheRelacoes();
    setAlterado(false);

    if (novo && enderecoPendente && entidade.slug === "pessoas") {
      await supabase.from("pessoas_enderecos").insert({ ...enderecoPendente, cep: String(enderecoPendente.cep ?? "").replace(/\D/g, "") || null, pessoa_id: data.id });
    }
    toast.success(novo ? `${entidade.singular[0].toUpperCase()}${entidade.singular.slice(1)} cadastrad${entidade.feminino ? "a" : "o"}` : "Alterações salvas");
    if (novo) router.replace(`/cadastros/${slug}/${data.id}`);
    else router.refresh();
  }

  async function excluir() {
    setConfirmar(false);
    const { error } = await supabase.from(entidade.tabela).delete().eq("id", id);
    if (error) {
      const emUso = error.code === "23503";
      return toast.error(emUso ? "Este cadastro já está em uso" : "Não foi possível excluir", {
        description: emUso ? "Desmarque Ativo e salve para tirá-lo das listas sem perder o histórico." : error.message,
      });
    }
    toast.success("Excluído");
    router.replace(`/cadastros/${slug}`);
  }

  const titulo = novo
    ? `Nov${entidade.feminino ? "a" : "o"} ${entidade.singular}`
    : String(dados.razao_social || dados.nome || dados.descricao || dados.placa || dados.sigla || entidade.singular);

  const camposDaAba = entidade.campos.filter((c) => (c.aba ?? abasCampos[0]) === aba);
  const filho = entidade.filhos?.find((f) => f.titulo === aba);
  const extra = Object.values(EXTRAS).find((e) => e.titulo === aba && abasExtras.includes(e.titulo));
  const ehAbaDeCampos = abasCampos.includes(aba);

  return (
    <>
      <Cabecalho
        trilha={`${entidade.trilha} › ${entidade.titulo}`}
        titulo={titulo}
        acoes={
          <>
            {!semVoltar && (
              <Button onClick={() => router.push(`/cadastros/${slug}`)}><ArrowLeft size={16} /> Voltar</Button>
            )}
            {!novo && podeExcluir && !semVoltar && (
              <Button variante="perigo" onClick={() => setConfirmar(true)}><Trash2 size={16} /> Excluir</Button>
            )}
            {podeSalvar && ehAbaDeCampos && (
              <Button variante="primario" onClick={salvar} disabled={salvando || carregando}>
                <Save size={16} /> {salvando ? "Salvando..." : "Salvar"}
              </Button>
            )}
          </>
        }
      />

      {novo && entidade.filhos?.length ? (
        <p className="mb-3 text-xs text-muted">
          Depois de salvar, as abas {entidade.filhos.map((f) => f.titulo).join(" e ")} ficam disponíveis.
        </p>
      ) : null}

      {todasAbas.length > 1 && <Abas abas={todasAbas} ativa={aba} onChange={setAba} />}

      {ehAbaDeCampos && (
        <Card className="p-5">
          {carregando ? (
            <div className="py-8 text-center text-sm text-muted">Carregando...</div>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              {camposDaAba.map((c) => (
                <div key={c.nome} className={cn("min-w-0", largura(c.largura))}>
                  {c.tipo !== "booleano" && <Label htmlFor={`f-${c.nome}`} obrigatorio={c.obrigatorio}>{c.rotulo}</Label>}
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <CampoInput id={`f-${c.nome}`} campo={c} valor={dados[c.nome]} erro={erros[c.nome]}
                        onChange={(v) => mudar(c, v)} onBlur={() => aoSairDoCampo(c)} />
                    </div>
                    {entidade.buscaCnpj && c.nome === "documento" && (
                      <Button onClick={buscarCnpj} title="Preencher pelo CNPJ" aria-label="Preencher pelo CNPJ"><Search size={16} /></Button>
                    )}
                  </div>
                  {erros[c.nome] ? (
                    <p className="mt-1 text-xs text-bad">{erros[c.nome]}</p>
                  ) : c.ajuda ? (
                    <p className="mt-1 text-xs text-muted">{c.ajuda}</p>
                  ) : null}
                </div>
              ))}
              {aba === abasCampos[0] && !semVoltar && (
                <div className="flex items-end sm:col-span-2 lg:col-span-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={ativo} onChange={(e) => { setAtivo(e.target.checked); setAlterado(true); }} />
                    Ativo
                    {!ativo && <Badge tom="aviso">Não aparece nas listas de seleção</Badge>}
                  </label>
                </div>
              )}
            </div>
          )}
          {enderecoPendente && novo && (
            <p className="mt-4 text-xs text-muted">
              Endereço da Receita Federal ({String(enderecoPendente.cidade)}/{String(enderecoPendente.uf)}) será gravado junto ao salvar.
            </p>
          )}
        </Card>
      )}

      {filho && id && <GradeFilho filho={filho} paiId={id} podeEditar={podeSalvar} />}
      {extra && id && <extra.Componente id={id} />}

      <Confirmar
        aberto={confirmar}
        titulo={`Excluir ${artigo(entidade)} ${entidade.singular}?`}
        texto="A exclusão não pode ser desfeita. Se o cadastro já tiver sido usado, desmarque Ativo em vez de excluir."
        rotuloConfirmar="Excluir"
        perigo
        aoConfirmar={excluir}
        aoCancelar={() => setConfirmar(false)}
      />
    </>
  );
}
