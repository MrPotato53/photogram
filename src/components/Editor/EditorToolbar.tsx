import clsx from 'clsx';
import { useEditorStore, type PanelId } from '../../stores/editorStore';

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

export function EditorToolbar({ projectName }: EditorToolbarProps) {
  const { panels, togglePanel } = useEditorStore();

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
  ];

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-theme-bg-secondary border-b border-theme-border">
      {/* Left: Project name */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-medium text-theme-text truncate max-w-[200px]">
          {projectName}
        </h1>
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
