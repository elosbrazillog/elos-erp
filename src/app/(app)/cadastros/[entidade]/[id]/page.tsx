import { notFound } from "next/navigation";
import { obterEntidade } from "@/lib/entidades";
import { exigir, pode } from "@/lib/sessao";
import { FormEntidade } from "@/components/crud/FormEntidade";

export default async function Page({ params }: { params: Promise<{ entidade: string; id: string }> }) {
  const { entidade: slug, id } = await params;
  const e = obterEntidade(slug);
  if (!e || slug === "empresa" || !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await exigir(e.modulo, "ver");
  return <FormEntidade slug={slug} id={id} podeSalvar={pode(s, e.modulo, "editar")} podeExcluir={pode(s, e.modulo, "excluir")} />;
}
