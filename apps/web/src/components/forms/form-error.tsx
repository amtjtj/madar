import { CircleAlert } from 'lucide-react';

/** Form-level error banner, announced to screen readers. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
    >
      <CircleAlert aria-hidden />
      <span>{message}</span>
    </div>
  );
}
