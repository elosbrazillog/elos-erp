import { exigir, pode } from "@/lib/sessao";
import { ListaInventarios } from "@/components/estoque/Inventarios";

export const metadata = { title: "Inventário" };

export default async function Page() {
  const s = await exigir("estoque", "ver");
  return <ListaInventarios podeCriar={pode(s, "estoque", "criar")} />;
}
