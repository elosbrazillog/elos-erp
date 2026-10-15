import { exigir, pode } from "@/lib/sessao";
import { Faturamento } from "@/components/fiscal/Faturamento";

export const metadata = { title: "Faturamento" };

export default async function Page() {
  const s = await exigir("fiscal", "ver");
  return <Faturamento podeFaturar={pode(s, "fiscal", "editar")} />;
}
