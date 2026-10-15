import { exigir, pode } from "@/lib/sessao";
import { ListaPedidos } from "@/components/vendas/ListaPedidos";

export const metadata = { title: "Pedidos e orçamentos" };

export default async function Page() {
  const s = await exigir("vendas", "ver");
  return <ListaPedidos podeCriar={pode(s, "vendas", "criar")} podeFaturar={pode(s, "fiscal", "editar")} />;
}
