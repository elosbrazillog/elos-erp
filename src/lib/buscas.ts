// Buscas usadas nos campos de cliente e produto (lado do navegador)
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resultado } from "@/components/ui/BuscaRegistro";
import { formatarDocumento, formatarMoeda, formatarNumero } from "@/lib/utils";

const limpar = (t: string) => t.replace(/[,()%*\\]/g, " ").trim();

export type ClienteBusca = Resultado & { bloqueado: boolean };

export async function buscarClientes(supabase: SupabaseClient, termo: string): Promise<ClienteBusca[]> {
  let q = supabase
    .from("pessoas")
    .select("id, codigo, razao_social, nome_fantasia, documento, bloqueado, pessoas_enderecos(cidade, bairro)")
    .eq("ativo", true)
    .eq("eh_cliente", true)
    .order("razao_social")
    .limit(20);
  const t = limpar(termo);
  if (t) {
    const dig = t.replace(/\D/g, "");
    const conds = [`razao_social.ilike.%${t}%`, `nome_fantasia.ilike.%${t}%`];
    if (dig && dig === t.replace(/[.\-/\s]/g, "")) {
      conds.push(`documento.ilike.%${dig}%`);
      if (dig.length <= 7) conds.push(`codigo.eq.${dig}`);
    }
    q = q.or(conds.join(","));
  }
  const { data } = await q;
  type P = { id: string; codigo: number; razao_social: string; nome_fantasia: string | null; documento: string | null; bloqueado: boolean; pessoas_enderecos: { cidade: string | null; bairro: string | null }[] };
  return ((data ?? []) as P[]).map((p) => {
    const end = p.pessoas_enderecos?.[0];
    return {
      id: p.id,
      rotulo: `${p.codigo} · ${p.nome_fantasia || p.razao_social}`,
      detalhe: [p.nome_fantasia ? p.razao_social : null, p.documento ? formatarDocumento(p.documento) : null, end?.bairro, end?.cidade].filter(Boolean).join(" · "),
      aviso: p.bloqueado ? "Bloqueado" : undefined,
      bloqueado: p.bloqueado,
    };
  });
}

export type ProdutoVenda = {
  id: string; codigo: string; nome: string; preco: number; preco_minimo: number | null;
  disponivel: number | null; unidade: string | null; peso: number | null;
};

/** Produtos ativos com o preço da tabela informada e o disponível (sem vencidos) no depósito */
export async function carregarProdutosVenda(supabase: SupabaseClient, tabelaId: string | null, depositoId: string | null): Promise<ProdutoVenda[]> {
  const [prods, precos, estoque] = await Promise.all([
    supabase.from("produtos").select("id, codigo, nome, preco_venda, preco_minimo, peso_bruto_kg, unidades(sigla)").eq("ativo", true).order("nome").limit(2000),
    tabelaId
      ? supabase.from("tabelas_preco_itens").select("produto_id, preco, preco_minimo").eq("tabela_preco_id", tabelaId).eq("ativo", true).limit(2000)
      : Promise.resolve({ data: [] }),
    depositoId
      ? supabase.from("vw_estoque_disponivel").select("produto_id, disponivel").eq("deposito_id", depositoId).limit(5000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const preco = new Map(((precos.data ?? []) as { produto_id: string; preco: number; preco_minimo: number | null }[]).map((p) => [p.produto_id, p]));
  const disp = estoque.error ? null : new Map(((estoque.data ?? []) as { produto_id: string; disponivel: number }[]).map((e) => [e.produto_id, Number(e.disponivel)]));
  type P = { id: string; codigo: string; nome: string; preco_venda: number; preco_minimo: number | null; peso_bruto_kg: number | null; unidades: { sigla: string } | null };
  return ((prods.data ?? []) as unknown as P[]).map((p) => {
    const tp = preco.get(p.id);
    return {
      id: p.id, codigo: p.codigo, nome: p.nome,
      preco: Number(tp?.preco ?? p.preco_venda),
      preco_minimo: tp?.preco_minimo ?? p.preco_minimo ?? null,
      disponivel: disp ? disp.get(p.id) ?? 0 : null,
      unidade: p.unidades?.sigla ?? null,
      peso: p.peso_bruto_kg,
    };
  });
}

export function filtrarProdutos(lista: ProdutoVenda[], termo: string): Resultado[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const partes = norm(termo).split(/\s+/).filter(Boolean);
  return lista
    .filter((p) => { const alvo = norm(`${p.codigo} ${p.nome}`); return partes.every((x) => alvo.includes(x)); })
    .slice(0, 30)
    .map((p) => ({
      id: p.id,
      rotulo: `${p.codigo} · ${p.nome}`,
      detalhe: `${formatarMoeda(p.preco)}${p.unidade ? ` / ${p.unidade}` : ""}${p.disponivel !== null ? ` · disponível ${formatarNumero(p.disponivel)}` : ""}`,
      aviso: p.disponivel !== null && p.disponivel <= 0 ? "Sem estoque" : undefined,
    }));
}
