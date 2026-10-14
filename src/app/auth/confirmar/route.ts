import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { criarClienteServidor } from "@/lib/supabase/server";

// Recebe os links de convite e de recuperação de senha enviados por e-mail
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const tipo = searchParams.get("type") as EmailOtpType | null;
  const codigo = searchParams.get("code");
  const proximo = searchParams.get("proximo") ?? "/nova-senha";
  const supabase = await criarClienteServidor();

  let erro = null;
  if (codigo) ({ error: erro } = await supabase.auth.exchangeCodeForSession(codigo));
  else if (tokenHash && tipo) ({ error: erro } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo }));
  else erro = { message: "link inválido" };

  if (erro) return NextResponse.redirect(`${origin}/login?erro=link`);
  return NextResponse.redirect(`${origin}${proximo.startsWith("/") ? proximo : "/"}`);
}
