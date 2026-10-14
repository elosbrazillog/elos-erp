"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { criarClienteAdmin } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";

export async function convidarUsuario(form: { email: string; nome: string; perfilId: string }) {
  const sessao = await obterSessao();
  if (!sessao || !pode(sessao, "configuracoes", "criar")) return { erro: "Você não tem permissão para convidar usuários." };

  const email = form.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { erro: "E-mail inválido." };
  if (!form.nome.trim()) return { erro: "Informe o nome." };

  const h = await headers();
  const origem = process.env.NEXT_PUBLIC_SITE_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  try {
    const admin = criarClienteAdmin();
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { nome: form.nome.trim(), empresa_id: sessao.empresaId, perfil_id: form.perfilId || null },
      redirectTo: `${origem}/auth/confirmar?proximo=/nova-senha`,
    });
    if (error) return { erro: error.message.includes("already") ? "Esse e-mail já tem cadastro." : error.message };
  } catch (e) {
    return { erro: (e as Error).message };
  }
  revalidatePath("/configuracoes/usuarios");
  return { ok: true };
}
