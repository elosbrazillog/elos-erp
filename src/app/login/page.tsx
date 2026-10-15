"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";

function FormLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) {
      setErro(error.message.includes("Invalid") ? "E-mail ou senha incorretos." : error.message);
      return;
    }
    router.replace(params.get("voltar") || "/");
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="space-y-4">
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="senha">Senha</Label>
        <Input id="senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
      </div>
      {erro && <p className="text-sm text-bad">{erro}</p>}
      <Button type="submit" variante="primario" className="w-full" disabled={carregando}>
        {carregando ? "Entrando..." : "Entrar"}
      </Button>
      <Link href="/recuperar-senha" className="block text-center text-sm text-accent hover:underline">
        Esqueci minha senha
      </Link>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-side px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-elos.png" alt="Elos · Distribuidora e comércio de alimentos" className="mb-8 w-full max-w-xs" />
      <div className="w-full max-w-sm rounded-xl border-t-4 border-accent bg-surface p-7 shadow-xl">
        <div className="mb-6">
          <div className="text-lg font-semibold">Entrar no ERP</div>
          <p className="text-sm text-muted">Use seu e-mail e senha</p>
        </div>
        <Suspense>
          <FormLogin />
        </Suspense>
      </div>
    </div>
  );
}
