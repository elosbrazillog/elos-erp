import { exigir, pode } from "@/lib/sessao";
import { EstoqueSaldos } from "@/components/estoque/EstoqueSaldos";

export const metadata = { title: "Saldos por lote" };

export default async function Page() {
  const s = await exigir("estoque", "ver");
  return <EstoqueSaldos podeMovimentar={pode(s, "estoque", "criar")} />;
}
