import { useEffect } from 'react';
import { usePreferencesStore } from './stores/preferencesStore';
import { useTabsStore } from './stores/tabsStore';
import { TabBar } from './components/TabBar';
import { HomePage } from './components/Home';
import { EditorPlaceholder } from './components/Editor/EditorPlaceholder';

export default function App() {
  const { loadPreferences } = usePreferencesStore();
  const { tabs, activeTabId } = useTabsStore();

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="h-screen flex flex-col bg-theme-bg text-theme-text">
      <TabBar />
      <div className="flex-1 overflow-hidden">
        {activeTab?.type === 'home' && <HomePage />}
        {activeTab?.type === 'project' && activeTab.projectId && (
          <EditorPlaceholder
            projectId={activeTab.projectId}
            projectName={activeTab.projectName || 'Untitled'}
          />
        )}
      </div>
    </div>
  );
}
