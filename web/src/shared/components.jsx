import { React } from '../core/react.mjs';
const Pill = ({text,cls,extra=''}) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls} ${extra}`}>{text}</span>
);

const SectionHead = ({title, sub, right}) => (
  <div className="workspace-section-heading">
    <div>
      <h2 className="serif text-[17px] font-semibold tracking-wide text-ink">{title}</h2>
      {sub && <p className="text-xs text-muted mt-2">{sub}</p>}
    </div>
    {right}
  </div>
);

export { Pill, SectionHead };
