"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button, Cabecalho, Card, Input, Label } from "@/components/ui";

export default function NovaSenhaPage() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) return setErro("Use pelo menos 8 caracteres.");
    if (senha !== confirma) return setErro("As senhas não conferem.");
    const { error } = await criarClienteNavegador().auth.updateUser({ password: senha });
    if (error) return setErro(error.message);
    toast.success("Senha definida");
    router.replace("/");
  }

  return (
    <>
      <Cabecalho titulo="Definir senha" />
      <Card className="max-w-md p-5">
        <form onSubmit={salvar} className="space-y-4">
          <div>
            <Label htmlFor="s1">Nova senha</Label>
            <Input id="s1" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s2">Repita a senha</Label>
            <Input id="s2" type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
          </div>
          {erro && <p className="text-sm text-bad">{erro}</p>}
          <Button type="submit" variante="primario">Salvar senha</Button>
        </form>
      </Card>
    </>
  );
}
