import { exigir, pode } from "@/lib/sessao";
import { Metas } from "@/components/vendas/Metas";

export const metadata = { title: "Metas de venda" };

export default async function Page() {
  const s = await exigir("vendas", "ver");
  return <Metas podeEditar={pode(s, "vendas", "editar") && !s.apenasCarteira} />;
}
