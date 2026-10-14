import { exigir } from "@/lib/sessao";
import { CaixaBancos } from "@/components/financeiro/CaixaBancos";

export const metadata = { title: "Caixa e bancos" };

export default async function Page() {
  await exigir("financeiro", "ver");
  return <CaixaBancos />;
}
