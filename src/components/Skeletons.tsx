export function PosterSkeleton() {
  return (
    <div className="w-[168px] shrink-0">
      <div className="skeleton aspect-[2/3] w-full rounded-[14px]" />
      <div className="skeleton mt-2 h-3 w-4/5 rounded" />
    </div>
  );
}

export function RowSkeleton({ title = true }: { title?: boolean }) {
  return (
    <div className="mb-9">
      {title && <div className="skeleton mb-4 h-5 w-48 rounded" />}
      <div className="flex gap-3.5 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <PosterSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="skeleton aspect-[2/3] w-full rounded-[14px]" />
          <div className="skeleton mt-2 h-3 w-4/5 rounded" />
        </div>
      ))}
    </div>
  );
}

export function HeroSkeleton() {
  return <div className="skeleton mb-10 h-[420px] w-full rounded-3xl" />;
}
