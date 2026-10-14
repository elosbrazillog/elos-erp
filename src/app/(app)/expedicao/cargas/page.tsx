import { exigir, pode } from "@/lib/sessao";
import { ListaCargas } from "@/components/expedicao/ListaCargas";

export const metadata = { title: "Cargas" };

export default async function Page() {
  const s = await exigir("expedicao", "ver");
  return <ListaCargas podeCriar={pode(s, "expedicao", "criar")} />;
}
