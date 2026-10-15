import { notFound } from "next/navigation";
import { exigir, pode } from "@/lib/sessao";
import { AcertoMotorista } from "@/components/expedicao/AcertoMotorista";

export const metadata = { title: "Acerto do motorista" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await exigir("expedicao", "ver");
  return <AcertoMotorista id={id} podeEditar={pode(s, "expedicao", "editar")} podeBaixar={pode(s, "financeiro", "editar")} />;
}
