export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
