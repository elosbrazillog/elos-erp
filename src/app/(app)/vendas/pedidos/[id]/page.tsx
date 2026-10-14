import { notFound } from "next/navigation";
import { exigir, pode } from "@/lib/sessao";
import { FormPedido } from "@/components/vendas/FormPedido";

export const metadata = { title: "Pedido" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await exigir("vendas", "ver");
  return (
    <FormPedido
      id={id}
      podeCriar={pode(s, "vendas", "criar")}
      podeEditar={pode(s, "vendas", "editar")}
      podeExcluir={pode(s, "vendas", "excluir")}
      podeCredito={pode(s, "financeiro", "editar")}
    />
  );
}
