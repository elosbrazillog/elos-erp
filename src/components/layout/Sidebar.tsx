"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Users, ShoppingCart, Package, Truck, FileText, Wallet, BarChart3, Settings, LayoutDashboard, Menu, X, LogOut, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GrupoMenu } from "@/lib/menu";

const ICONES: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  users: Users, cart: ShoppingCart, box: Package, truck: Truck, file: FileText, money: Wallet, chart: BarChart3, gear: Settings,
};

export function Sidebar({ grupos, nome, perfil, empresa }: { grupos: GrupoMenu[]; nome: string; perfil: string; empresa: string }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const grupoAtivo = grupos.find((g) => g.itens.some((i) => pathname.startsWith(i.rota)))?.titulo;
  const [expandidos, setExpandidos] = useState<string[]>(grupoAtivo ? [grupoAtivo] : ["Cadastros"]);

  const alternar = (t: string) => setExpandidos((e) => (e.includes(t) ? e.filter((x) => x !== t) : [...e, t]));

  const conteudo = (
    <nav className="flex h-full flex-col bg-side text-side-ink">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="text-[15px] font-semibold tracking-wide text-white" onClick={() => setAberto(false)}>
          ELOS <span className="font-normal text-side-ink">ERP</span>
        </Link>
        <button className="lg:hidden" onClick={() => setAberto(false)} aria-label="Fechar menu">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <Link
          href="/"
          onClick={() => setAberto(false)}
          className={cn("mb-1 flex items-center gap-2.5 rounded-md px-3 py-2", pathname === "/" ? "bg-side-active text-white" : "hover:bg-side-active/60")}
        >
          <LayoutDashboard size={17} /> Painel
        </Link>
        {grupos.map((g) => {
          const Icone = ICONES[g.icone] ?? Users;
          const exp = expandidos.includes(g.titulo);
          return (
            <div key={g.titulo} className="mb-0.5">
              <button
                onClick={() => alternar(g.titulo)}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left hover:bg-side-active/60"
                aria-expanded={exp}
              >
                <Icone size={17} />
                <span className="flex-1">{g.titulo}</span>
                <ChevronDown size={15} className={cn("transition-transform", exp && "rotate-180")} />
              </button>
              {exp && (
                <div className="mt-0.5 mb-1 ml-[26px] border-l border-white/10 pl-2">
                  {g.itens.map((i) =>
                    i.pronto ? (
                      <Link
                        key={i.rota}
                        href={i.rota}
                        onClick={() => setAberto(false)}
                        className={cn(
                          "block rounded px-2.5 py-1.5 text-[13px]",
                          pathname.startsWith(i.rota) ? "bg-side-active text-white" : "hover:text-white",
                        )}
                      >
                        {i.titulo}
                      </Link>
                    ) : (
                      <span key={i.rota} className="flex items-center justify-between px-2.5 py-1.5 text-[13px] text-side-ink/45">
                        {i.titulo}
                        <span className="text-[10px] uppercase tracking-wider">em breve</span>
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 px-4 py-3 text-xs">
        <div className="truncate font-medium text-white">{nome}</div>
        <div className="truncate">{perfil} · {empresa}</div>
        <form action="/auth/sair" method="post" className="mt-2">
          <button className="flex items-center gap-1.5 hover:text-white">
            <LogOut size={14} /> Sair
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button onClick={() => setAberto(true)} aria-label="Abrir menu">
          <Menu size={22} />
        </button>
        <span className="font-semibold">ELOS ERP</span>
      </div>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 lg:block">{conteudo}</aside>
      {aberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAberto(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{conteudo}</aside>
        </div>
      )}
    </>
  );
}
