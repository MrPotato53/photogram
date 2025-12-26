import clsx from 'clsx';

interface NewProjectCardProps {
  onClick: () => void;
}

export function NewProjectCard({ onClick }: NewProjectCardProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative flex flex-col rounded-lg overflow-hidden',
        'bg-theme-bg-secondary border border-dashed border-theme-border',
        'hover:border-blue-500 group',
        'transition-all duration-150 cursor-pointer'
      )}
    >
      {/* Invisible structure to match ProjectCard height */}
      <div className="aspect-square" />
      <div className="p-2.5">
        <div className="text-sm invisible">&nbsp;</div>
        <div className="text-xs invisible">&nbsp;</div>
      </div>
      {/* Centered content overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center text-theme-text-muted group-hover:text-blue-500 transition-colors">
          <svg
            className="w-8 h-8 mb-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 4v16m8-8H4"
            />
          </svg>
          <span className="text-sm font-medium">New Project</span>
        </div>
      </div>
    </button>
  );
}
