import { exigir, pode } from "@/lib/sessao";
import { FormEntidade } from "@/components/crud/FormEntidade";

export const metadata = { title: "Dados da empresa" };

export default async function Page() {
  const s = await exigir("configuracoes", "ver");
  return <FormEntidade slug="empresa" id={s.empresaId} podeSalvar={pode(s, "configuracoes", "editar")} podeExcluir={false} semVoltar />;
}
