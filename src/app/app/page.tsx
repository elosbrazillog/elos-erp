import { redirect } from "next/navigation";
import { obterSessao, pode } from "@/lib/sessao";
import { ForcaVendas } from "@/components/app/ForcaVendas";

export const metadata = { title: "Força de vendas" };

export default async function Page() {
  const s = await obterSessao();
  if (!s) redirect("/login?voltar=/app");
  if (!pode(s, "vendas")) redirect("/sem-acesso");
  return <ForcaVendas nome={s.nome} podeCriar={pode(s, "vendas", "criar")} />;
}
