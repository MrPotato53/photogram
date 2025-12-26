import { Modal, Button } from '../common';
import { usePreferencesStore } from '../../stores/preferencesStore';
import clsx from 'clsx';

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PreferencesModal({ isOpen, onClose }: PreferencesModalProps) {
  const { preferences, setTheme } = usePreferencesStore();

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

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
