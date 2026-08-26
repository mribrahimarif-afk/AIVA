export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-base-700 bg-base-900 p-6 shadow-sm shadow-black/20 ${className}`}>
      {children}
    </div>
  );
}
