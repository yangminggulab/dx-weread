"use strict";

const {
  DIARY_DRAFT_KEY
} = require("./model.js");

// A POST queue alone cannot wait for an editor's baseline/cache acknowledgement
// or the later keystrokes queued behind it. Register the full save transaction.
const savers = new Map();
function registerDiarySaver(owner, flush) {
  savers.set(owner, flush);
  return () => savers.delete(owner);
}
async function flushActiveDiaryDraft() {
  // Storage errors must propagate: an unreadable draft is not an empty draft.
  const draft = wx.getStorageSync(DIARY_DRAFT_KEY);
  const flush = draft && savers.get(draft.owner);
  if (flush) await flush();
}
module.exports = {
  registerDiarySaver,
  flushActiveDiaryDraft
};
