import { criarClienteServidor } from "@/lib/supabase/server";
import { exigir, pode } from "@/lib/sessao";
import { Usuarios } from "./Usuarios";

export const metadata = { title: "Usuários" };

export default async function Page() {
  const s = await exigir("configuracoes", "ver");
  const supabase = await criarClienteServidor();
  const [{ data: usuarios }, { data: perfis }, { data: pessoas }] = await Promise.all([
    supabase.from("usuarios").select("id, nome, email, perfil_id, pessoa_id, ativo, criado_em").order("nome"),
    supabase.from("perfis").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("pessoas").select("id, razao_social").or("eh_vendedor.eq.true,eh_motorista.eq.true").eq("ativo", true).order("razao_social"),
  ]);
  return (
    <Usuarios
      usuarios={usuarios ?? []}
      perfis={perfis ?? []}
      pessoas={pessoas ?? []}
      euId={s.usuarioId}
      podeEditar={pode(s, "configuracoes", "editar")}
      podeConvidar={pode(s, "configuracoes", "criar")}
    />
  );
}
