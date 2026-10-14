"use client";
import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function BotaoImprimir() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return <Button variante="primario" onClick={() => window.print()}><Printer size={16} /> Imprimir</Button>;
}
