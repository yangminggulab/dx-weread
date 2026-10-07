import { React, useEffect, useRef } from '../../core/react.mjs';
import { DiaryPage } from './DiaryPage.jsx';

export function DiaryDialog({ controller, state, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const close = () => { controller.flush(); onClose(); };
  return <dialog ref={ref} className="dashboard-diary-dialog" aria-label="展开日记" onCancel={event => { event.preventDefault(); close(); }}><div className="dashboard-card-heading"><h2>日记本</h2><button autoFocus onClick={close}>收起</button></div><DiaryPage controller={controller} state={state} /></dialog>;
}
