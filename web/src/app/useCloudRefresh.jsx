import { useEffect } from '../core/react.mjs';
import { apiRequest } from '../core/api.mjs';
import { createCloudRefresh } from '../core/cloud-refresh.mjs';
import { diaryDayKey } from '../features/diary/model.mjs';
import { formatLocalDateKey } from '../features/reading/model.mjs';

export function useCloudRefresh(workspace, diary) {
  useEffect(() => {
    const monitor = createCloudRefresh({ getRevision: () => apiRequest('/api/sync-state'),
      refresh: [() => workspace.refresh(), () => diary.refresh()],
      day: () => `${diaryDayKey()}|${formatLocalDateKey(new Date())}`,
    });
    let timer;
    const start = () => { clearInterval(timer); monitor.start(); timer = setInterval(() => monitor.check(), 15000); };
    const stop = () => { clearInterval(timer); monitor.stop(); diary.flush(); workspace.flushTasks(); };
    const focus = () => { if (document.visibilityState === 'visible') monitor.check(true); };
    const visibility = () => document.visibilityState === 'visible' ? start() : stop();
    const beforeUnload = event => {
      if (diary.hasUnsaved()) { diary.flush(); event.preventDefault(); event.returnValue = ''; }
    };
    if (document.visibilityState !== 'hidden') start();
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', stop); window.addEventListener('beforeunload', beforeUnload);
    return () => {
      clearInterval(timer); monitor.stop();
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', stop); window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [workspace, diary]);
}
