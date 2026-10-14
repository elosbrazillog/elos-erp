import { criarClienteServidor } from "@/lib/supabase/server";
import { exigir, pode } from "@/lib/sessao";
import { Perfis } from "./Perfis";

export const metadata = { title: "Perfis de acesso" };

export default async function Page() {
  const s = await exigir("configuracoes", "ver");
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("perfis").select("id, nome, descricao, administrador, permissoes, ativo, apenas_carteira").order("administrador", { ascending: false }).order("nome");
  return <Perfis perfis={data ?? []} empresaId={s.empresaId} podeEditar={pode(s, "configuracoes", "editar")} />;
}
