import Link from "next/link";
import { BarChart3, Boxes, Wallet } from "lucide-react";
import { exigir, pode } from "@/lib/sessao";
import { Cabecalho, Card } from "@/components/ui";
import { RELATORIOS } from "@/lib/relatorios";

export const metadata = { title: "Relatórios" };

const ICONES = { Vendas: BarChart3, Estoque: Boxes, Financeiro: Wallet } as const;

export default async function Page() {
  const s = await exigir("relatorios", "ver");
  const veFin = pode(s, "financeiro");
  const grupos = (["Vendas", "Estoque", "Financeiro"] as const)
    .map((g) => ({ g, itens: RELATORIOS.filter((r) => r.grupo === g && (!r.financeiro || veFin)) }))
    .filter((x) => x.itens.length);
  return (
    <>
      <Cabecalho trilha="Relatórios" titulo="Central de relatórios" />
      <div className="space-y-6">
        {grupos.map(({ g, itens }) => {
          const Icone = ICONES[g];
          return (
            <section key={g}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted"><Icone size={16} /> {g}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {itens.map((r) => (
                  <Link key={r.slug} href={`/relatorios/${r.slug}`}>
                    <Card className="h-full p-4 transition-colors hover:border-accent">
                      <div className="font-medium">{r.titulo}</div>
                      <p className="mt-1 text-sm text-muted">{r.descricao}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
