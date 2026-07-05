import { useEffect, useRef, useState, type TouchEvent as RTouchEvent } from 'react';
import { fetchReceiptObjectUrl, getReceiptMeta, type ReceiptMeta } from '../api';
import { fmtUSD } from '../format';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export default function ReceiptViewer({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<ReceiptMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    Promise.all([fetchReceiptObjectUrl(receiptId), getReceiptMeta(receiptId).catch(() => null)])
      .then(([u, m]) => { if (cancelled) { URL.revokeObjectURL(u); return; } objectUrl = u; setUrl(u); setMeta(m); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить фото'); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [receiptId]);

  const onTouchStart = (e: RTouchEvent) => { startY.current = e.touches[0].clientY; };
  const onTouchEnd = (e: RTouchEvent) => {
    if (startY.current != null && e.changedTouches[0].clientY - startY.current > 80) onClose();
    startY.current = null;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex justify-end p-4">
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-bg-2/80 text-text text-2xl leading-none">×</button>
      </div>
      <div className="flex-1 flex items-center justify-center px-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {error ? <p className="text-danger text-sm">{error}</p>
          : url ? <img src={url} alt="Чек" className="max-h-full max-w-full object-contain rounded-xl" />
            : <div className="w-8 h-8 rounded-full border-2 border-border-2 border-t-accent animate-spin" />}
      </div>
      {meta && (
        <div className="p-4 text-center text-xs text-text-muted space-y-0.5" onClick={(e) => e.stopPropagation()}>
          {meta.recognized_amount != null && <div>Распознано: {fmtUSD(meta.recognized_amount)}</div>}
          {meta.confirmed_amount != null && <div>Подтверждено: {fmtUSD(meta.confirmed_amount)}</div>}
          <div>Загружено: {fmtDate(meta.created_at)}</div>
        </div>
      )}
    </div>
  );
}
