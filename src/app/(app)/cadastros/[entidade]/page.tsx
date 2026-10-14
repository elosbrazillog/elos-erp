import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { obterEntidade } from "@/lib/entidades";
import { exigir, pode } from "@/lib/sessao";
import { ListaEntidade } from "@/components/crud/ListaEntidade";

type P = { params: Promise<{ entidade: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const e = obterEntidade((await params).entidade);
  return { title: e?.titulo ?? "Cadastro" };
}

export default async function Page({ params }: P) {
  const { entidade: slug } = await params;
  const e = obterEntidade(slug);
  if (!e || slug === "empresa") notFound();
  const s = await exigir(e.modulo, "ver");
  return <ListaEntidade slug={slug} podeCriar={pode(s, e.modulo, "criar")} podeEditar={pode(s, e.modulo, "editar")} podeExcluir={pode(s, e.modulo, "excluir")} />;
}
