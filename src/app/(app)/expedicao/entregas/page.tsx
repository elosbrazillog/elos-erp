import { exigir, pode } from "@/lib/sessao";
import { Entregas } from "@/components/expedicao/Entregas";

export const metadata = { title: "Entregas" };

export default async function Page({ searchParams }: { searchParams: Promise<{ carga?: string }> }) {
  const s = await exigir("expedicao", "ver");
  const { carga } = await searchParams;
  // Motorista (usuário ligado a uma pessoa, sem ser administrador) vê só as próprias cargas
  const motoristaId = !s.administrador && s.pessoaId ? s.pessoaId : null;
  return <Entregas motoristaId={motoristaId} cargaInicial={carga && /^[0-9a-f-]{36}$/.test(carga) ? carga : null} podeRegistrar={pode(s, "expedicao", "editar")} />;
}
