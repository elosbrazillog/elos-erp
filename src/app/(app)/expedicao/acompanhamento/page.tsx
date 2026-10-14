import { exigir } from "@/lib/sessao";
import { Acompanhamento } from "@/components/expedicao/Acompanhamento";

export const metadata = { title: "Acompanhamento de entregas" };

export default async function Page() {
  await exigir("expedicao", "ver");
  return <Acompanhamento />;
}
