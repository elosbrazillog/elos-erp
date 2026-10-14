import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { exigir, pode } from "@/lib/sessao";
import { obterRelatorio } from "@/lib/relatorios";
import { RelatorioView } from "@/components/relatorios/RelatorioView";

type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  return { title: obterRelatorio((await params).slug)?.titulo ?? "Relatório" };
}

export default async function Page({ params }: P) {
  const { slug } = await params;
  const rel = obterRelatorio(slug);
  if (!rel) notFound();
  const s = await exigir("relatorios", "ver");
  if (rel.financeiro && !pode(s, "financeiro")) redirect("/sem-acesso");
  return <RelatorioView slug={slug} />;
}
