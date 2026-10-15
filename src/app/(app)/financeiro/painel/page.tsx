import { exigir, pode } from "@/lib/sessao";
import { PainelFinanceiro } from "@/components/financeiro/PainelFinanceiro";

export const metadata = { title: "Departamento financeiro" };

export default async function Page() {
  const s = await exigir("financeiro", "ver");
  return <PainelFinanceiro podeEditar={pode(s, "financeiro", "editar")} podeCriar={pode(s, "financeiro", "criar")} />;
}
