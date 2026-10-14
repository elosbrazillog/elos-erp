"use client";
import { useState } from "react";
import Link from "next/link";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirmar?proximo=/nova-senha`,
    });
    if (error) setErro(error.message);
    else setEnviado(true);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-side px-4">
      <div className="w-full max-w-sm rounded-xl bg-surface p-7 shadow-xl">
        <div className="mb-5 text-lg font-semibold">Recuperar senha</div>
        {enviado ? (
          <p className="text-sm">Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.</p>
        ) : (
          <form onSubmit={enviar} className="space-y-4">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {erro && <p className="text-sm text-bad">{erro}</p>}
            <Button type="submit" variante="primario" className="w-full">Enviar link</Button>
          </form>
        )}
        <Link href="/login" className="mt-4 block text-center text-sm text-accent hover:underline">Voltar ao login</Link>
      </div>
    </div>
  );
}
