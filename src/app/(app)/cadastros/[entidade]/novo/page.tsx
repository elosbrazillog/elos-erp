import { notFound } from "next/navigation";
import { obterEntidade } from "@/lib/entidades";
import { exigir } from "@/lib/sessao";
import { FormEntidade } from "@/components/crud/FormEntidade";

export default async function Page({ params }: { params: Promise<{ entidade: string }> }) {
  const { entidade: slug } = await params;
  const e = obterEntidade(slug);
  if (!e || slug === "empresa") notFound();
  await exigir(e.modulo, "criar");
  return <FormEntidade slug={slug} podeSalvar podeExcluir={false} />;
}
