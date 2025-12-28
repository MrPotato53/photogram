import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { useEditorStore, type PanelId, type SnapSettings, type SnapSettingsUpdate } from '../../stores/editorStore';

interface EditorToolbarProps {
  projectName: string;
}

interface ToolbarButtonProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}

function ToolbarButton({ label, icon, isActive, onClick }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-sm transition-colors',
        isActive
          ? 'bg-blue-500/20 text-blue-500'
          : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary'
      )}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

interface SnapSettingsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;
  snapSettings: SnapSettings;
  updateSnapSettings: (updates: SnapSettingsUpdate) => void;
}

function SnapSettingsPopover({
  isOpen,
  onClose,
  snapEnabled,
  setSnapEnabled,
  snapSettings,
  updateSnapSettings,
}: SnapSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay to avoid immediate close from the opening click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute top-full mt-1 right-0 w-64 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl z-50"
    >
      <div className="p-3 space-y-3">
        {/* Master toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm font-medium text-theme-text">Enable Snapping</span>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
            className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
          />
        </label>

        <div className="border-t border-theme-border pt-3 space-y-2.5">
          <span className="text-xs text-theme-text-muted uppercase tracking-wide">Snap To</span>

          {/* Canvas center */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-theme-text-secondary">Canvas center</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => updateSnapSettings({ canvas: { show: !snapSettings.canvas.show } })}
                className={clsx(
                  'p-1 rounded transition-colors',
                  snapSettings.canvas.show
                    ? 'text-blue-400 bg-blue-500/20'
                    : 'text-gray-500 hover:text-gray-400'
                )}
                title="Show guides"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
              <input
                type="checkbox"
                checked={snapSettings.canvas.enabled}
                onChange={(e) => updateSnapSettings({ canvas: { enabled: e.target.checked } })}
                disabled={!snapEnabled}
                className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Other elements */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-theme-text-secondary">Other elements</span>
            <input
              type="checkbox"
              checked={snapSettings.elements}
              onChange={(e) => updateSnapSettings({ elements: e.target.checked })}
              disabled={!snapEnabled}
              className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
            />
          </div>

          {/* Margin guides */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-theme-text-secondary">Margin guides</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateSnapSettings({ margin: { show: !snapSettings.margin.show } })}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    snapSettings.margin.show
                      ? 'text-blue-400 bg-blue-500/20'
                      : 'text-gray-500 hover:text-gray-400'
                  )}
                  title="Show guides"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
                <input
                  type="checkbox"
                  checked={snapSettings.margin.enabled}
                  onChange={(e) => updateSnapSettings({ margin: { enabled: e.target.checked } })}
                  disabled={!snapEnabled}
                  className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
                />
              </div>
            </div>
            {(snapSettings.margin.enabled || snapSettings.margin.show) && (
              <div className="flex items-center gap-2 pl-2">
                <span className="text-xs text-theme-text-muted">Margin:</span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={snapSettings.margin.value}
                  onChange={(e) =>
                    updateSnapSettings({ margin: { value: Math.max(0, parseInt(e.target.value) || 0) } })
                  }
                  className="w-16 px-2 py-0.5 text-xs bg-theme-bg border border-theme-border rounded text-theme-text focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-theme-text-muted">px</span>
              </div>
            )}
          </div>

          {/* Grid guides */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-theme-text-secondary">Grid guides</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateSnapSettings({ grid: { show: !snapSettings.grid.show } })}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    snapSettings.grid.show
                      ? 'text-blue-400 bg-blue-500/20'
                      : 'text-gray-500 hover:text-gray-400'
                  )}
                  title="Show guides"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
                <input
                  type="checkbox"
                  checked={snapSettings.grid.enabled}
                  onChange={(e) => updateSnapSettings({ grid: { enabled: e.target.checked } })}
                  disabled={!snapEnabled}
                  className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
                />
              </div>
            </div>
            {(snapSettings.grid.enabled || snapSettings.grid.show) && (
              <div className="space-y-1.5 pl-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-theme-text-muted">Rows:</span>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={snapSettings.grid.horizontal}
                      onChange={(e) =>
                        updateSnapSettings({
                          grid: { horizontal: Math.max(2, Math.min(12, parseInt(e.target.value) || 2)) },
                        })
                      }
                      className="w-12 px-1.5 py-0.5 text-xs bg-theme-bg border border-theme-border rounded text-theme-text focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-theme-text-muted">Cols:</span>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={snapSettings.grid.vertical}
                      onChange={(e) =>
                        updateSnapSettings({
                          grid: { vertical: Math.max(2, Math.min(12, parseInt(e.target.value) || 2)) },
                        })
                      }
                      className="w-12 px-1.5 py-0.5 text-xs bg-theme-bg border border-theme-border rounded text-theme-text focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-theme-text-muted">Gutter:</span>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={snapSettings.grid.margin}
                    onChange={(e) =>
                      updateSnapSettings({
                        grid: { margin: Math.max(0, Math.min(200, parseInt(e.target.value) || 0)) },
                      })
                    }
                    className="w-16 px-2 py-0.5 text-xs bg-theme-bg border border-theme-border rounded text-theme-text focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-xs text-theme-text-muted">px</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EditorToolbar({ projectName }: EditorToolbarProps) {
  const { panels, togglePanel, snapEnabled, setSnapEnabled, snapSettings, updateSnapSettings } =
    useEditorStore();
  const [snapPopoverOpen, setSnapPopoverOpen] = useState(false);

  const panelButtons: { id: PanelId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'mediaPool',
      label: 'Media',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      id: 'layers',
      label: 'Layers',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
      ),
    },
    {
      id: 'templates',
      label: 'Templates',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
          />
        </svg>
      ),
    },
    {
      id: 'slides',
      label: 'Slides',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 6h16M4 10h16M4 14h16M4 18h16"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-theme-bg-secondary border-b border-theme-border">
      {/* Left: Project name */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-medium text-theme-text truncate max-w-[200px]">
          {projectName}
        </h1>
      </div>

      {/* Center: Panel toggles and tools */}
      <div className="flex items-center gap-1">
        {panelButtons.map((button) => (
          <ToolbarButton
            key={button.id}
            label={button.label}
            icon={button.icon}
            isActive={panels[button.id].isOpen}
            onClick={() => togglePanel(button.id)}
          />
        ))}

        {/* Separator */}
        <div className="w-px h-5 bg-theme-border mx-1" />

        {/* Snap toggle with dropdown */}
        <div className="relative">
          <div className="flex">
            {/* Main snap toggle */}
            <button
              onClick={() => setSnapEnabled(!snapEnabled)}
              className={clsx(
                'flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-l text-sm transition-colors',
                snapEnabled
                  ? 'bg-blue-500/20 text-blue-500'
                  : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary'
              )}
              title="Toggle snapping"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="hidden sm:inline">Snap</span>
            </button>
            {/* Dropdown arrow */}
            <button
              onClick={() => setSnapPopoverOpen(!snapPopoverOpen)}
              className={clsx(
                'flex items-center px-1 py-1 rounded-r text-sm transition-colors border-l',
                snapEnabled
                  ? 'bg-blue-500/20 text-blue-500 border-blue-500/30'
                  : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary border-theme-border'
              )}
              title="Snap settings"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <SnapSettingsPopover
            isOpen={snapPopoverOpen}
            onClose={() => setSnapPopoverOpen(false)}
            snapEnabled={snapEnabled}
            setSnapEnabled={setSnapEnabled}
            snapSettings={snapSettings}
            updateSnapSettings={updateSnapSettings}
          />
        </div>
      </div>

      {/* Right: Future actions (export, etc.) */}
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          onClick={() => {
            // TODO: Export functionality
          }}
        >
          Export
        </button>
      </div>
    </div>
  );
}
