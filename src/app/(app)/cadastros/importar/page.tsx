import { exigir } from "@/lib/sessao";
import { Importador } from "./Importador";

export const metadata = { title: "Importar planilha" };

export default async function Page() {
  await exigir("cadastros", "criar");
  return <Importador />;
}
