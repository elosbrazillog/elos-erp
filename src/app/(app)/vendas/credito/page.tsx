import { exigir, pode } from "@/lib/sessao";
import { FilaCredito } from "@/components/vendas/FilaCredito";

export const metadata = { title: "Aprovação de crédito" };

export default async function Page() {
  const s = await exigir("vendas", "ver");
  return <FilaCredito podeLiberar={pode(s, "financeiro", "editar")} />;
}
