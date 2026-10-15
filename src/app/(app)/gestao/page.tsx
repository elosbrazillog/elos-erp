import { redirect } from "next/navigation";
import { obterSessao } from "@/lib/sessao";
import { GestaoGeral } from "@/components/gestao/GestaoGeral";

export const metadata = { title: "Gestão geral" };

export default async function Page() {
  const s = await obterSessao();
  if (!s?.administrador) redirect("/sem-acesso");
  return <GestaoGeral />;
}
