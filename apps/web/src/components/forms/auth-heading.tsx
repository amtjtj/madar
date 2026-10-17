export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-black text-ink">{title}</h1>
      {subtitle && <p className="text-ink-muted">{subtitle}</p>}
    </div>
  );
}
