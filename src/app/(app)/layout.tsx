import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MENU } from "@/lib/menu";
import { obterSessao, pode } from "@/lib/sessao";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await obterSessao();
  if (!sessao) redirect("/sem-acesso");

  const grupos = MENU.map((g) => ({
    ...g,
    // itens de cadastros financeiros/fiscais seguem o módulo do grupo
    itens: g.itens,
  })).filter((g) => pode(sessao, g.modulo));

  return (
    <div className="min-h-full">
      <Sidebar grupos={grupos} nome={sessao.nome} perfil={sessao.perfilNome} empresa={sessao.empresaNome} />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
