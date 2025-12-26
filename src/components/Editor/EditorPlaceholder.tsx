interface EditorPlaceholderProps {
  projectId: string;
  projectName: string;
}

export function EditorPlaceholder({ projectId, projectName }: EditorPlaceholderProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-theme-bg text-theme-text-secondary">
      <svg
        className="w-12 h-12 mb-3 text-theme-text-muted"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
      <h2 className="text-lg font-medium text-theme-text mb-1">{projectName}</h2>
      <p className="text-sm">Project editor coming soon...</p>
      <p className="text-xs text-theme-text-muted mt-2">ID: {projectId}</p>
    </div>
  );
}
