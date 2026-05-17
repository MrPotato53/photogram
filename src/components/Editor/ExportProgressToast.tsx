import React from 'react';

interface ExportProgressToastProps {
  progress: {
    current: number;
    total: number;
    phase: 'rendering' | 'saving' | 'done' | 'error';
    errorMessage?: string;
  } | null;
  onDismiss: () => void;
}

export const ExportProgressToast: React.FC<ExportProgressToastProps> = ({
  progress,
  onDismiss,
}) => {
  if (!progress) return null;

  const { current, total, phase, errorMessage } = progress;
  const pct = phase === 'done' ? 100 : Math.round((current / Math.max(total, 1)) * 100);

  const label =
    phase === 'rendering'
      ? `Exporting ${current} of ${total}`
      : phase === 'saving'
        ? `Saving ${total} ${total === 1 ? 'photo' : 'photos'}…`
        : phase === 'done'
          ? `Exported ${total} ${total === 1 ? 'photo' : 'photos'}`
          : 'Export failed';

  const barColor =
    phase === 'error'
      ? 'bg-red-500'
      : phase === 'done'
        ? 'bg-green-500'
        : 'bg-blue-500';

  const showDismiss = phase === 'done' || phase === 'error';

  return (
    <div className="fixed bottom-6 right-6 z-50 w-72 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-2xl p-3 select-none">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-theme-text truncate">{label}</span>
        {showDismiss && (
          <button
            onClick={onDismiss}
            className="text-theme-text-muted hover:text-theme-text ml-2 leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
      <div className="h-1.5 bg-theme-bg-tertiary rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-150`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {phase === 'error' && errorMessage && (
        <div className="text-xs text-red-400 mt-1.5 truncate" title={errorMessage}>
          {errorMessage}
        </div>
      )}
    </div>
  );
};
