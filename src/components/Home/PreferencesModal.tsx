import { Modal, Button } from '../common';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { CANVAS_RESOLUTIONS } from '../../constants/canvasResolutions';
import clsx from 'clsx';

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenShortcuts: () => void;
}

export function PreferencesModal({ isOpen, onClose, onOpenShortcuts }: PreferencesModalProps) {
  const { preferences, setTheme, setCanvasResolution } = usePreferencesStore();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Preferences" size="sm">
      <div className="space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-theme-text-secondary">Theme</label>
          <div className="flex gap-2">
            <button
              onClick={() => setTheme('light')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm transition-all',
                preferences.theme === 'light'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                  : 'border-theme-border bg-theme-bg-tertiary text-theme-text-secondary hover:border-theme-border-hover'
              )}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
              Light
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm transition-all',
                preferences.theme === 'dark'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                  : 'border-theme-border bg-theme-bg-tertiary text-theme-text-secondary hover:border-theme-border-hover'
              )}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
              Dark
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-theme-text-secondary">Canvas resolution</label>
          <select
            value={preferences.canvasResolution}
            onChange={(e) => setCanvasResolution(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-theme-border bg-theme-bg-tertiary text-sm text-theme-text hover:border-theme-border-hover focus:border-blue-500 focus:outline-none transition-colors"
          >
            {CANVAS_RESOLUTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-theme-text-muted">
            Resolution photos are rendered at on the canvas. Higher is sharper when zoomed in
            but uses more memory; "Full" draws photos un-rasterized. Does not affect export quality.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-theme-text-secondary">Input</label>
          <button
            onClick={() => {
              onClose();
              onOpenShortcuts();
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-theme-border bg-theme-bg-tertiary text-sm text-theme-text hover:border-theme-border-hover transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 8a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"
                />
              </svg>
              Keyboard Shortcuts…
            </span>
            <span className="text-theme-text-muted text-xs">customize</span>
          </button>
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
