export default function PlaceholderPage({ title, layer }: { title: string; layer: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="bg-bg-2 border border-border rounded-2xl p-8 text-center max-w-xs w-full">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-dim flex items-center justify-center">
          <span className="w-3 h-3 rounded-full bg-accent" />
        </div>
        <h2 className="text-lg font-bold mb-1">Скоро здесь появится</h2>
        <p className="text-accent text-xl font-bold mb-3">{title}</p>
        <p className="text-text-muted text-xs">В разработке · {layer}</p>
      </div>
    </div>
  );
}
