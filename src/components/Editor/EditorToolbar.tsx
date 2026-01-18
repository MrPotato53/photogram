import clsx from 'clsx';
import { usePanelStore, type PanelId } from '../../stores/panelStore';
import { useHistoryStore, useCanUndo, useCanRedo } from '../../stores/historyStore';

interface EditorToolbarProps {
  projectName: string;
  onExportClick: () => void;
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

export function EditorToolbar({ projectName, onExportClick }: EditorToolbarProps) {
  const { panels, togglePanel } = usePanelStore();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const { undo, redo } = useHistoryStore();

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
      {/* Left: Project name and undo/redo */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-medium text-theme-text truncate max-w-[200px]">
          {projectName}
        </h1>

        {/* Separator */}
        <div className="w-px h-5 bg-theme-border" />

        {/* Undo/Redo buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className={clsx(
              'p-1.5 rounded transition-colors',
              canUndo
                ? 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary'
                : 'text-theme-text-tertiary cursor-not-allowed'
            )}
            title="Undo (Cmd+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className={clsx(
              'p-1.5 rounded transition-colors',
              canRedo
                ? 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary'
                : 'text-theme-text-tertiary cursor-not-allowed'
            )}
            title="Redo (Cmd+Shift+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Center: Panel toggles */}
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

        {/* Edit bar toggle */}
        <ToolbarButton
          label="Edit"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          }
          isActive={panels.editBar.isOpen}
          onClick={() => togglePanel('editBar')}
        />
      </div>

      {/* Right: Future actions (export, etc.) */}
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          onClick={onExportClick}
        >
          Export
        </button>
      </div>
    </div>
  );
}
