import { exigir, pode } from "@/lib/sessao";
import { FormPedido } from "@/components/vendas/FormPedido";

export const metadata = { title: "Novo pedido" };

export default async function Page() {
  const s = await exigir("vendas", "criar");
  return <FormPedido podeCriar={pode(s, "vendas", "criar")} podeEditar={false} podeExcluir={false} podeCredito={false} />;
}
