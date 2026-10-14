"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Janela modal com título, conteúdo e rodapé de ações */
export function Dialogo({
  aberto, titulo, descricao, children, rodape, aoFechar, largo,
}: {
  aberto: boolean;
  titulo: string;
  descricao?: string;
  children?: React.ReactNode;
  rodape?: React.ReactNode;
  aoFechar: () => void;
  largo?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      onClose={aoFechar}
      className={cn(
        "m-auto max-h-[calc(100dvh-32px)] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40",
        largo ? "w-[min(720px,calc(100vw-32px))]" : "w-[min(480px,calc(100vw-32px))]",
      )}
    >
      {aberto && (
        <div className="flex max-h-[calc(100dvh-34px)] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-semibold">{titulo}</h2>
              {descricao && <p className="mt-0.5 text-sm text-muted">{descricao}</p>}
            </div>
            <button type="button" onClick={aoFechar} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {rodape && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{rodape}</div>}
        </div>
      )}
    </dialog>
  );
}
