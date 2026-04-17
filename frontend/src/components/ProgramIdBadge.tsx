import { ExternalLink } from "lucide-react";

interface ProgramIdBadgeProps {
  showFull?: boolean;
}

function shortenProgramId(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

export function ProgramIdBadge({ showFull = false }: ProgramIdBadgeProps) {
  const programId = process.env.NEXT_PUBLIC_PROGRAM_ID?.trim();

  if (!programId) {
    return null;
  }

  const label = showFull ? programId : shortenProgramId(programId);
  const href = `https://explorer.solana.com/address/${programId}?cluster=devnet`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-4 py-2 text-[11px] font-[var(--font-mono)] text-[var(--text-2)] transition hover:text-[var(--text-1)]"
      title={programId}
    >
      <span className="text-[var(--text-3)]">Program</span>
      <span>{label}</span>
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
