import Link from "next/link";

export default function SemAcesso() {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-lg font-semibold">Sem acesso a esta área</h1>
        <p className="mb-4 text-sm text-muted">
          Seu usuário não tem permissão para esta tela ou ainda não foi liberado. Fale com o administrador do sistema.
        </p>
        <div className="flex justify-center gap-4 text-sm">
          <Link href="/" className="text-accent hover:underline">Ir para o painel</Link>
          <form action="/auth/sair" method="post"><button className="text-accent hover:underline">Entrar com outro usuário</button></form>
        </div>
      </div>
    </div>
  );
}
