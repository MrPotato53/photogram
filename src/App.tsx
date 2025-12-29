import { useEffect } from 'react';
import { usePreferencesStore } from './stores/preferencesStore';
import { useTemplatesStore } from './stores/templatesStore';
import { useTabsStore } from './stores/tabsStore';
import { TabBar } from './components/TabBar';
import { HomePage } from './components/Home';
import { EditorLayout } from './components/Editor/EditorLayout';

export default function App() {
  const { loadPreferences } = usePreferencesStore();
  const { loadTemplates } = useTemplatesStore();
  const { tabs, activeTabId } = useTabsStore();

  useEffect(() => {
    loadPreferences();
    loadTemplates();
  }, [loadPreferences, loadTemplates]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="h-screen flex flex-col bg-theme-bg text-theme-text">
      <TabBar />
      <div className="flex-1 overflow-hidden">
        {activeTab?.type === 'home' && <HomePage />}
        {activeTab?.type === 'project' && activeTab.projectId && (
          <EditorLayout projectId={activeTab.projectId} />
        )}
      </div>
    </div>
  );
}
