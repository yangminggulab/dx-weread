import { useState, useSyncExternalStore } from '../../core/react.mjs';
import { apiRequest, workspaceIdentity } from '../../core/api.mjs';
import { browserStorage, createJSONStorage, tabIdentity } from '../../core/storage.mjs';
import { ReadingController } from './writes.mjs';

export function useReading(workspace) {
  const [controller] = useState(() => new ReadingController({ workspace, request: apiRequest,
    drafts: createJSONStorage(browserStorage(), `mpl_reading_drafts_v1:${workspaceIdentity()}:${tabIdentity()}`),
  }));
  return { controller, state: useSyncExternalStore(controller.subscribe, controller.getSnapshot) };
}
