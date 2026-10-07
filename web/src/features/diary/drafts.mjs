// Each browser tab has a separate draft document. A late receipt from a page
// being unloaded updates only its submitted edit, never a reopened newer edit.
export function createDiaryDrafts(storage) {
  return {
    read() { return storage.read({}); },
    put(date, draft) { storage.write({ ...this.read(), [date]: draft }); },
    remove(date, expectedID) {
      const drafts = this.read();
      if (expectedID && drafts[date]?.editID !== expectedID) return;
      delete drafts[date]; storage.write(drafts);
    },
    prepare(submitted, operation) {
      const drafts = this.read(), current = drafts[submitted.entry.date];
      if (current?.editID === submitted.editID) {
        drafts[submitted.entry.date] = { ...current, operation }; storage.write(drafts);
      }
    },
    acknowledge(submitted, receipt) {
      const drafts = this.read(), current = drafts[submitted.entry.date];
      if (!current) return;
      if (current.editID === submitted.editID) delete drafts[submitted.entry.date];
      else if (current.baseContent === submitted.baseContent && current.baseUpdatedAt === submitted.baseUpdatedAt) {
        // Later keystrokes were based on the submitted body, not on remote text
        // merged into the receipt. Let the next server merge retain that text.
        drafts[submitted.entry.date] = { ...current, baseContent: submitted.entry.content, baseUpdatedAt: receipt.updatedAt || '' };
      }
      storage.write(drafts);
    },
  };
}
