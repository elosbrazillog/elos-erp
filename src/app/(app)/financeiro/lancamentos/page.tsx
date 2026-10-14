import { exigir, pode } from "@/lib/sessao";
import { Lancamentos } from "@/components/financeiro/Lancamentos";

export const metadata = { title: "Lançamentos" };

export default async function Page() {
  const s = await exigir("financeiro", "ver");
  return <Lancamentos podeCriar={pode(s, "financeiro", "criar")} podeEditar={pode(s, "financeiro", "editar")} />;
}
