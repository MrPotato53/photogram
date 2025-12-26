import clsx from 'clsx';
import { useTabsStore } from '../stores/tabsStore';
import type { Tab } from '../types';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabsStore();

  // Only show tab bar if there are project tabs open
  if (tabs.length <= 1) return null;

  return (
    <div className="flex items-center bg-theme-bg-secondary border-b border-theme-border h-9">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => setActiveTab(tab.id)}
          onClose={tab.type === 'project' ? () => closeTab(tab.id) : undefined}
        />
      ))}
    </div>
  );
}

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onClick: () => void;
  onClose?: () => void;
}

function TabItem({ tab, isActive, onClick, onClose }: TabItemProps) {
  const isHome = tab.type === 'home';

  return (
    <div
      onClick={onClick}
      className={clsx(
        'group flex items-center gap-2 px-3 h-full border-r border-theme-border cursor-pointer',
        'transition-colors',
        isActive
          ? 'bg-theme-bg text-theme-text'
          : 'bg-theme-bg-secondary text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary'
      )}
    >
      {isHome ? (
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
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ) : (
        <>
          <span className="text-sm truncate max-w-[150px]">{tab.projectName}</span>
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className={clsx(
                'p-0.5 rounded',
                'opacity-0 group-hover:opacity-100',
                'hover:bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text',
                'transition-all'
              )}
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  );
}
