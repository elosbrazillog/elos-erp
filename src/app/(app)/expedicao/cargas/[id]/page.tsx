import { notFound } from "next/navigation";
import { exigir, pode } from "@/lib/sessao";
import { DetalheCarga } from "@/components/expedicao/DetalheCarga";

export const metadata = { title: "Carga" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await exigir("expedicao", "ver");
  return <DetalheCarga id={id} podeEditar={pode(s, "expedicao", "editar")} />;
}
