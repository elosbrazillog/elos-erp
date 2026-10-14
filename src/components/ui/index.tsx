"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "secundario" | "fantasma" | "perigo";
  tamanho?: "p" | "m";
};
export const Button = React.forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { className, variante = "secundario", tamanho = "m", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none",
        tamanho === "p" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variante === "primario" && "bg-accent text-accent-ink hover:brightness-110",
        variante === "secundario" && "border border-line bg-surface text-ink hover:bg-surface-2",
        variante === "fantasma" && "text-ink hover:bg-surface-2",
        variante === "perigo" && "border border-bad/40 bg-surface text-bad hover:bg-bad/5",
        className,
      )}
      {...props}
    />
  );
});

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-20 w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink focus:border-accent focus:outline-none",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none disabled:bg-surface-2",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ children, obrigatorio, htmlFor }: { children: React.ReactNode; obrigatorio?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted">
      {children}
      {obrigatorio && <span className="text-bad"> *</span>}
    </label>
  );
}

export function Badge({ children, tom = "neutro" }: { children: React.ReactNode; tom?: "neutro" | "ok" | "aviso" | "erro" | "acento" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        tom === "neutro" && "bg-surface-2 text-muted",
        tom === "ok" && "bg-ok/10 text-ok",
        tom === "aviso" && "bg-warn/10 text-warn",
        tom === "erro" && "bg-bad/10 text-bad",
        tom === "acento" && "bg-accent-soft text-accent",
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-lg border border-line bg-surface", className)}>{children}</section>;
}

export function Cabecalho({
  trilha,
  titulo,
  acoes,
}: {
  trilha?: string;
  titulo: string;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {trilha && <div className="text-xs text-muted">{trilha}</div>}
        <h1 className="text-xl font-semibold text-balance">{titulo}</h1>
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

export function Abas({ abas, ativa, onChange }: { abas: string[]; ativa: string; onChange: (a: string) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {abas.map((a) => (
        <button
          key={a}
          role="tab"
          aria-selected={a === ativa}
          type="button"
          onClick={() => onChange(a)}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
            a === ativa ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

export function Vazio({ titulo, texto, acao }: { titulo: string; texto?: string; acao?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <div className="font-medium">{titulo}</div>
      {texto && <p className="max-w-md text-sm text-muted">{texto}</p>}
      {acao}
    </div>
  );
}
