import { exigir, pode } from "@/lib/sessao";
import { HistoricoVendas } from "@/components/vendas/HistoricoVendas";

export const metadata = { title: "Histórico de vendas" };

export default async function Page() {
  const s = await exigir("vendas", "ver");
  return <HistoricoVendas podeImportar={pode(s, "vendas", "editar") && !s.apenasCarteira} />;
}
