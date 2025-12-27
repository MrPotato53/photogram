export function TemplatesPanel() {
  return (
    <div className="p-3 h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center text-theme-text-muted">
        <svg
          className="w-10 h-10 mb-2 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
          />
        </svg>
        <p className="text-sm text-center">No templates</p>
        <p className="text-xs text-center mt-1 opacity-70">
          Create a layout and save it as a template
        </p>
      </div>

      {/* Save template button */}
      <button className="mt-3 w-full py-2 border border-dashed border-theme-border rounded text-sm text-theme-text-secondary hover:border-blue-500 hover:text-blue-500 transition-colors">
        + Save Current as Template
      </button>
    </div>
  );
}
