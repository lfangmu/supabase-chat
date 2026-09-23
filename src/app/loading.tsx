export default function Loading() {
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-border border-t-primary rounded-full animate-spin" />
        <p className="text-muted-foreground text-sm">加载中...</p>
      </div>
    </div>
  );
}
