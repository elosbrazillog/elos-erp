import { exigir, pode } from "@/lib/sessao";
import { Equipe } from "@/components/cadastros/Equipe";

export const metadata = { title: "Motoristas e vendedores" };

export default async function Page() {
  const s = await exigir("cadastros", "ver");
  return <Equipe podeCriar={pode(s, "cadastros", "criar")} />;
}
