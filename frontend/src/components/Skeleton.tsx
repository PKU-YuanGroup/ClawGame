export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded ${className}`} style={{ backgroundColor: "var(--skeleton)" }} />;
}
