import { exigir, pode } from "@/lib/sessao";
import { ListaMovimentos } from "@/components/estoque/ListaMovimentos";

export const metadata = { title: "Movimentações de estoque" };

export default async function Page() {
  const s = await exigir("estoque", "ver");
  return <ListaMovimentos podeMovimentar={pode(s, "estoque", "criar")} />;
}
