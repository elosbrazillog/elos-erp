import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import type { Acao, Modulo, Permissoes } from "@/lib/menu";

export type Sessao = {
  usuarioId: string;
  nome: string;
  email: string;
  empresaId: string;
  empresaNome: string;
  perfilNome: string;
  administrador: boolean;
  permissoes: Permissoes;
  pessoaId: string | null;
  apenasCarteira: boolean;
};

export const obterSessao = cache(async (): Promise<Sessao | null> => {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("usuarios")
    .select("id, nome, email, empresa_id, ativo, pessoa_id, perfis(nome, administrador, permissoes, apenas_carteira), empresas(nome_fantasia, razao_social)")
    .eq("id", user.id)
    .maybeSingle();

  if (!data || !data.ativo) return null;
  const perfil = data.perfis as unknown as { nome: string; administrador: boolean; permissoes: Permissoes; apenas_carteira?: boolean } | null;
  const empresa = data.empresas as unknown as { nome_fantasia: string | null; razao_social: string } | null;

  return {
    usuarioId: data.id,
    nome: data.nome,
    email: data.email,
    empresaId: data.empresa_id,
    empresaNome: empresa?.nome_fantasia || empresa?.razao_social || "",
    perfilNome: perfil?.nome ?? "Sem perfil",
    administrador: !!perfil?.administrador,
    permissoes: perfil?.permissoes ?? {},
    pessoaId: (data as { pessoa_id?: string | null }).pessoa_id ?? null,
    apenasCarteira: !perfil?.administrador && !!perfil?.apenas_carteira,
  };
});

export function pode(sessao: Sessao, modulo: Modulo, acao: Acao = "ver") {
  return sessao.administrador || !!sessao.permissoes?.[modulo]?.[acao];
}

/** Para páginas: exige login e permissão, senão redireciona */
export async function exigir(modulo: Modulo, acao: Acao = "ver") {
  const sessao = await obterSessao();
  if (!sessao) redirect("/sem-acesso");
  if (!pode(sessao, modulo, acao)) redirect("/sem-acesso");
  return sessao;
}
