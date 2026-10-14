import { notFound } from "next/navigation";
import { exigir, pode } from "@/lib/sessao";
import { Inventario } from "@/components/estoque/Inventarios";

export const metadata = { title: "Inventário" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await exigir("estoque", "ver");
  return <Inventario id={id} podeEditar={pode(s, "estoque", "editar")} />;
}
