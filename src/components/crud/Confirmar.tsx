"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";

export function Confirmar({
  aberto, titulo, texto, rotuloConfirmar = "Confirmar", perigo, aoConfirmar, aoCancelar,
}: {
  aberto: boolean; titulo: string; texto?: string; rotuloConfirmar?: string; perigo?: boolean;
  aoConfirmar: () => void; aoCancelar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog ref={ref} onClose={aoCancelar} className="m-auto w-[min(440px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-5 text-ink backdrop:bg-black/40">
      <h2 className="mb-2 font-semibold">{titulo}</h2>
      {texto && <p className="mb-5 text-sm text-muted">{texto}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={aoCancelar}>Cancelar</Button>
        <Button variante={perigo ? "perigo" : "primario"} onClick={aoConfirmar}>{rotuloConfirmar}</Button>
      </div>
    </dialog>
  );
}
