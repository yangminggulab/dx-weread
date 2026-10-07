import { React } from '../../core/react.mjs';

export function BookModal({ controller, state }) {
  if (!state.editor) return null;
  const f = state.editor.fields, cloud = controller.cloudBook();
  const inp = 'w-full px-3 py-2 bg-paper border border-line rounded-lg text-sm';
  return <div className="anim-fade fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="学习书籍编辑">
    <div className="bg-paper rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
      <div className="flex justify-between px-6 py-4 border-b border-line"><h3 className="serif font-semibold">{state.editor.original ? '编辑书籍' : '加入书架'}</h3><button disabled={state.saving} aria-label="关闭书籍编辑" onClick={() => controller.close()}>×</button></div>
      <form onSubmit={event => { event.preventDefault(); controller.save(); }}>
        <fieldset disabled={state.saving} className="px-6 py-5 space-y-4">
          <label className="block text-xs text-muted space-y-1">书名<input className={inp} value={f.title} onChange={event => controller.edit('title', event.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">{[['currentPage', '当前页数'], ['totalPage', '总页数']].map(([key, label]) => <label key={key} className="block text-xs text-muted space-y-1">{label}<input type="number" min="0" step="1" className={inp} value={f[key]} onChange={event => controller.edit(key, event.target.value)} /></label>)}</div>
          <label className="block text-xs text-muted space-y-1">状态<select className={inp} value={f.status} onChange={event => controller.edit('status', event.target.value)}><option value="reading">在读</option><option value="want">想读</option><option value="finished">已读完</option></select></label>
          <label className="block text-xs text-muted space-y-1">阅读备注<textarea rows="3" className={inp} value={f.notes} onChange={event => controller.edit('notes', event.target.value)} /></label>
        </fieldset>
        {state.error && <p role="alert" className="mx-6 mb-4 text-sm text-warning">{state.error}</p>}
        {state.conflict && <div className="mx-6 mb-4 bg-warning-soft rounded-lg p-3 text-sm space-y-3">
          {cloud ? <><p>云端：{cloud.title} · {cloud.currentPage || 0}/{cloud.totalPage || 0} 页</p><p className="whitespace-pre-wrap">{cloud.notes}</p>
            <div className="flex gap-3"><button type="button" disabled={state.saving} className="underline" onClick={() => controller.resolve(true)}>使用云端内容</button><button type="button" disabled={state.saving} className="underline" onClick={() => controller.resolve(false)}>核对后保留我的修改</button></div></>
            : <p>这本书已不在云端书架，草稿已保留，可复制内容后关闭。</p>}
        </div>}
        {state.closing ? <div className="px-6 pb-5 text-sm space-y-3"><p>还有未保存的修改。</p><div className="flex flex-wrap gap-3"><button type="button" className="underline" onClick={() => controller.keepAndClose()}>保留草稿并关闭</button><button type="button" className="underline text-danger" onClick={() => controller.discardAndClose()}>放弃修改</button><button type="button" className="underline" onClick={() => controller.publish({ closing: false })}>继续编辑</button></div></div>
          : <div className="px-6 py-4 border-t border-line flex justify-end gap-3"><button type="button" disabled={state.saving} onClick={() => controller.close()}>关闭</button><button type="submit" disabled={state.saving || state.conflict} className="px-5 py-2 bg-accent text-white rounded-lg disabled:opacity-50">{state.saving ? '保存中…' : '保存'}</button></div>}
      </form>
    </div>
  </div>;
}

export function BookDeleteDialog({ controller, state }) {
  if (!state.deleting) return null;
  return <div role="dialog" aria-modal="true" aria-label="删除学习书籍" className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"><div className="bg-paper rounded-xl p-6 max-w-sm space-y-4"><p>删除「{state.deleting.title}」？</p><div className="flex justify-end gap-4"><button disabled={state.saving} onClick={() => controller.publish({ deleting: null })}>取消</button><button disabled={state.saving} className="text-danger" onClick={() => controller.deleteBook()}>{state.saving ? '删除中…' : '删除'}</button></div></div></div>;
}
