// Importação única dos cadastros do sistema antigo (produtos, clientes, fornecedores e vendedores).
// Roda com a sessão do administrador logado, respeitando as regras de acesso do banco.
// Pode ser executada mais de uma vez: atualiza pelo código em vez de duplicar.
// Será removida depois da implantação.
import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao } from "@/lib/sessao";
import dados from "./dados.json";

export const maxDuration = 60;

type Endereco = { logradouro: string; numero: string | null; complemento: string | null; bairro: string | null; cidade: string; uf: string; codigo_ibge: string | null; cep: string | null };
type Pessoa = {
  codigo: number; tipo_pessoa: string; documento: string | null; razao_social: string; nome_fantasia: string | null;
  inscricao_estadual: string | null; indicador_ie: number; eh_cliente: boolean; eh_fornecedor: boolean; eh_transportadora: boolean;
  telefone: string | null; whatsapp: string | null; email: string | null; observacao: string | null;
  vendedor: string | null; tabela: string | null; periodicidade: number; criado_em: string | null; endereco: Endereco | null;
};
type Produto = { codigo: string; nome: string; categoria: string | null; unidade: string; ncm: string | null; cest: string | null; origem: number; custo: number; preco_venda: number; peso_bruto_kg: number | null };

const lotes = <T,>(lista: T[], n: number) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));
const nomeProprio = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

export async function POST() {
  const sessao = await obterSessao();
  if (!sessao?.administrador) return NextResponse.json({ erro: "Apenas o administrador pode rodar a importação." }, { status: 403 });
  const supabase = await criarClienteServidor();
  const empresa_id = sessao.empresaId;
  const log: string[] = [];
  const falhar = (etapa: string, e: { message: string }) => NextResponse.json({ erro: `${etapa}: ${e.message}`, log }, { status: 500 });

  const pessoas = dados.pessoas as Pessoa[];
  const produtos = dados.produtos as Produto[];

  // 1. Grupo tributário do sistema antigo
  const r = await supabase.from("grupos_tributarios").upsert({
    empresa_id, nome: "500 - Produto com ST", cfop_dentro_uf: "5405", cfop_fora_uf: "6404", csosn: "500", icms_st: false,
    observacao: "Importado do sistema antigo: ICMS cobrado anteriormente por substituição tributária. Validar com o contador.",
  }, { onConflict: "empresa_id,nome" }).select("id").single();
  if (r.error) return falhar("grupo tributário", r.error);
  const grupoST = r.data!.id as string;

  // 2. Categorias e unidades
  const categorias = [...new Set(produtos.map((p) => p.categoria).filter(Boolean))] as string[];
  const rc = await supabase.from("categorias").upsert(categorias.map((nome) => ({ empresa_id, nome })), { onConflict: "empresa_id,nome" });
  if (rc.error) return falhar("categorias", rc.error);
  const { data: cats } = await supabase.from("categorias").select("id, nome");
  const catId = new Map((cats ?? []).map((c) => [c.nome, c.id]));
  const { data: uns } = await supabase.from("unidades").select("id, sigla");
  const unId = new Map((uns ?? []).map((u) => [u.sigla, u.id]));
  const { data: marca } = await supabase.from("marcas").select("id").eq("nome", "Top Sabores").maybeSingle();

  // 3. Tabelas de preço (a padrão passa a se chamar PRINCIPAL, como no sistema antigo)
  await supabase.from("tabelas_preco").update({ nome: "PRINCIPAL" }).eq("nome", "Tabela padrão");
  await supabase.from("tabelas_preco").upsert([{ empresa_id, nome: "PRINCIPAL", padrao: true }, { empresa_id, nome: "TABELA NUTRIBENE", padrao: false }], { onConflict: "empresa_id,nome" });
  const { data: tabs } = await supabase.from("tabelas_preco").select("id, nome");
  const tabId = new Map((tabs ?? []).map((t) => [t.nome, t.id]));

  // 4. Condições de pagamento citadas nas observações
  await supabase.from("condicoes_pagamento").upsert({ empresa_id, nome: "7/14 dias", parcelas_dias: [7, 14] }, { onConflict: "empresa_id,nome" });
  const { data: conds } = await supabase.from("condicoes_pagamento").select("id, nome");
  const condId = new Map((conds ?? []).map((c) => [c.nome, c.id]));
  const { data: boleto } = await supabase.from("formas_pagamento").select("id").eq("nome", "Boleto").maybeSingle();
  const condicaoDe = (obs: string | null) => {
    const o = (obs ?? "").toUpperCase();
    if (o.includes("7/14")) return condId.get("7/14 dias");
    if (o.includes("14 DIAS")) return condId.get("14 dias");
    if (o.includes("7 DIAS")) return condId.get("7 dias");
    return undefined;
  };

  // 5. Vendedores (cadastro de pessoa com papel Vendedor)
  const maxCodigo = Math.max(...pessoas.map((p) => p.codigo));
  const vendedores = dados.vendedores as string[];
  const rv = await supabase.from("pessoas").upsert(vendedores.map((v, i) => ({
    empresa_id, codigo: maxCodigo + 1 + i, tipo_pessoa: "PF", razao_social: nomeProprio(v), eh_vendedor: true, eh_cliente: false,
  })), { onConflict: "empresa_id,codigo" });
  if (rv.error) return falhar("vendedores", rv.error);
  const { data: vends } = await supabase.from("pessoas").select("id, codigo").eq("eh_vendedor", true);
  const vendPorCodigo = new Map((vends ?? []).map((v) => [v.codigo, v.id]));
  const vendId = new Map(vendedores.map((v, i) => [v, vendPorCodigo.get(maxCodigo + 1 + i)]));
  log.push(`${vendedores.length} vendedores`);

  // 6. Clientes, fornecedores e transportadora
  for (const lote of lotes(pessoas, 300)) {
    const reg = lote.map((p) => ({
      empresa_id, codigo: p.codigo, tipo_pessoa: p.tipo_pessoa, documento: p.documento, razao_social: p.razao_social,
      nome_fantasia: p.nome_fantasia, inscricao_estadual: p.inscricao_estadual, indicador_ie: p.indicador_ie,
      eh_cliente: p.eh_cliente, eh_fornecedor: p.eh_fornecedor, eh_transportadora: p.eh_transportadora,
      telefone: p.telefone, whatsapp: p.whatsapp, email: p.email, email_nfe: p.email,
      observacao: [p.observacao, p.periodicidade ? `Periodicidade de compra no sistema antigo: ${p.periodicidade} dias` : null].filter(Boolean).join(" · ") || null,
      vendedor_id: p.vendedor ? vendId.get(p.vendedor) ?? null : null,
      tabela_preco_id: p.tabela ? tabId.get(p.tabela) ?? null : p.eh_cliente ? tabId.get("PRINCIPAL") : null,
      condicao_pagamento_id: condicaoDe(p.observacao) ?? null,
      forma_pagamento_id: condicaoDe(p.observacao) ? boleto?.id ?? null : null,
      criado_em: p.criado_em ?? new Date().toISOString(),
    }));
    const { error } = await supabase.from("pessoas").upsert(reg, { onConflict: "empresa_id,codigo" });
    if (error) return falhar(`pessoas (códigos ${lote[0].codigo}…)`, error);
  }
  log.push(`${pessoas.length} clientes/fornecedores`);

  // 7. Endereços (só para quem ainda não tem)
  // o Supabase devolve no máximo 1000 linhas por consulta, então busca em páginas
  async function tudo<T>(tabela: string, colunas: string): Promise<T[]> {
    const out: T[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase.from(tabela).select(colunas).order("id").range(de, de + 999);
      if (error || !data?.length) break;
      out.push(...(data as T[]));
      if (data.length < 1000) break;
    }
    return out;
  }
  const todas = await tudo<{ id: string; codigo: number; documento: string | null }>("pessoas", "id, codigo, documento");
  const idPorCodigo = new Map((todas ?? []).map((p) => [p.codigo, p.id]));
  const idPorDoc = new Map((todas ?? []).filter((p) => p.documento).map((p) => [p.documento, p.id]));
  const comEndereco = await tudo<{ pessoa_id: string }>("pessoas_enderecos", "pessoa_id");
  const jaTem = new Set((comEndereco ?? []).map((e) => e.pessoa_id));
  const enderecos = pessoas
    .filter((p) => p.endereco && idPorCodigo.has(p.codigo) && !jaTem.has(idPorCodigo.get(p.codigo)!))
    .map((p) => ({ empresa_id, pessoa_id: idPorCodigo.get(p.codigo), tipo: "principal", ...p.endereco! }));
  const extras = (dados.enderecos_extras as (Endereco & { documento: string })[])
    .filter((e) => idPorDoc.has(e.documento) && !jaTem.has(idPorDoc.get(e.documento)!))
    .map(({ documento, ...e }) => ({ empresa_id, pessoa_id: idPorDoc.get(documento), tipo: "entrega", ...e }));
  for (const lote of lotes([...enderecos, ...extras], 400)) {
    const { error } = await supabase.from("pessoas_enderecos").insert(lote);
    if (error) return falhar("endereços", error);
  }
  log.push(`${enderecos.length + extras.length} endereços`);

  // 8. Produtos e preços na tabela PRINCIPAL
  const fornecedorTop = idPorDoc.get("51692783000152") ?? null;
  const { error: ep } = await supabase.from("produtos").upsert(produtos.map((p) => ({
    empresa_id, codigo: p.codigo, nome: p.nome, categoria_id: p.categoria ? catId.get(p.categoria) ?? null : null,
    unidade_id: unId.get(p.unidade) ?? unId.get("UN") ?? null, marca_id: marca?.id ?? null, fornecedor_id: fornecedorTop,
    grupo_tributario_id: grupoST, ncm: p.ncm, cest: p.cest, origem: p.origem, custo: p.custo, preco_venda: p.preco_venda,
    peso_bruto_kg: p.peso_bruto_kg, validade_dias: null,
  })), { onConflict: "empresa_id,codigo" });
  if (ep) return falhar("produtos", ep);
  const { data: prods } = await supabase.from("produtos").select("id, codigo, preco_venda");
  const principal = tabId.get("PRINCIPAL");
  if (principal) {
    const { error } = await supabase.from("tabelas_preco_itens").upsert(
      (prods ?? []).map((p) => ({ empresa_id, tabela_preco_id: principal, produto_id: p.id, preco: p.preco_venda })),
      { onConflict: "tabela_preco_id,produto_id" },
    );
    if (error) return falhar("tabela de preço", error);
  }
  log.push(`${produtos.length} produtos com preço na tabela PRINCIPAL`);

  return NextResponse.json({ ok: true, log, maiorCodigoPessoa: maxCodigo + vendedores.length, fornecedorTopSabores: !!fornecedorTop });
}
