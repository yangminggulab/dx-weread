import { useEffect, useState, useSyncExternalStore } from '../core/react.mjs';
import { apiRequest, PERSONAL_MODE, workspaceIdentity } from '../core/api.mjs';
import { browserStorage, createJSONStorage } from '../core/storage.mjs';
import { WorkspaceController } from '../core/workspace-controller.mjs';

export function useWorkspace() {
  const [controller] = useState(() => new WorkspaceController({ request: apiRequest, personal: PERSONAL_MODE,
    cache: createJSONStorage(browserStorage(), `mpl_workspace_v1:${workspaceIdentity()}`),
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => () => controller.dispose(), [controller]);
  return { controller, state };
}
