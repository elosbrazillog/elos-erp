import { exigir, pode } from "@/lib/sessao";
import { DespesasFrota } from "@/components/expedicao/DespesasFrota";

export const metadata = { title: "Despesas da frota" };

export default async function Page({ searchParams }: { searchParams: Promise<{ carga?: string }> }) {
  const sp = await searchParams;
  const s = await exigir("expedicao", "ver");
  const carga = sp.carga && /^[0-9a-f-]{36}$/.test(sp.carga) ? sp.carga : null;
  return <DespesasFrota podeLancar={pode(s, "expedicao", "editar")} cargaInicial={carga} />;
}
