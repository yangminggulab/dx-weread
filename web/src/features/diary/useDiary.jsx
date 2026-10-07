import { useEffect, useState, useSyncExternalStore } from '../../core/react.mjs';
import { apiRequest, workspaceIdentity } from '../../core/api.mjs';
import { browserStorage, createJSONStorage, tabIdentity } from '../../core/storage.mjs';
import { createDiaryDrafts } from './drafts.mjs';
import { DiaryController } from './controller.mjs';

export function useDiary() {
  const [controller] = useState(() => {
    const identity = workspaceIdentity(), storage = browserStorage();
    return new DiaryController({ request: apiRequest,
      drafts: createDiaryDrafts(createJSONStorage(storage, `mpl_diary_drafts_v2:${identity}:${tabIdentity()}`)),
      cache: createJSONStorage(storage, `mpl_diary_cache_v2:${identity}`),
    });
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => () => controller.dispose(), [controller]);
  return { controller, state };
}
