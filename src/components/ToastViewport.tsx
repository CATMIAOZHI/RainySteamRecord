import { useToastStore } from "../stores/toast";

export default function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-20 right-5 z-[200] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2" role="region" aria-live="polite">
      {toasts.map((item) => (
        <button
          key={item.id}
          onClick={() => dismiss(item.id)}
          className="pointer-events-auto rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-text shadow-2xl"
          style={{ borderLeft: `4px solid var(--${item.kind === "error" ? "danger" : item.kind === "success" ? "success" : "accent"})` }}
        >
          {item.message}
        </button>
      ))}
    </div>
  );
}
