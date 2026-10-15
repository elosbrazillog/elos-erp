"use client";
import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function BotaoImprimir({ automatico = true }: { automatico?: boolean }) {
  useEffect(() => {
    if (!automatico) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [automatico]);
  return <Button variante="primario" onClick={() => window.print()}><Printer size={16} /> Imprimir</Button>;
}
