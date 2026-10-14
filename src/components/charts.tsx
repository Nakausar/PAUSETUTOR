import type { ReactNode } from 'react';

const STUDENT_COLOR = '#2563EB';
const COHORT_COLOR = '#CBD5E1';

export const CHART_COLORS = { student: STUDENT_COLOR, cohort: COHORT_COLOR };

/** Shared title/legend header for every visualisation card. */
export function CardHeader({ title, subtitle, legend }: { title: string; subtitle?: string; legend?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {legend}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex items-center gap-3 shrink-0">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-slate-600">
          {item.dashed
            ? <span className="w-4 h-0 border-t-2 border-dashed" style={{ borderColor: item.color }} />
            : <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />}
          {item.label}
        </span>
      ))}
    </div>
  );
}

export const STUDENT_VS_COHORT_LEGEND = <Legend items={[{ label: 'You', color: STUDENT_COLOR }, { label: 'Cohort average', color: COHORT_COLOR }]} />;

/** Horizontal bar comparing a value against a reference value (cohort avg). */
export function BarCompare({ label, value, reference, referenceLabel }: { label: string; value: number; reference: number | null; referenceLabel?: string }) {
  const scale = Math.max(value, reference ?? 0, 1);
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">{value}{reference !== null && <span className="text-slate-400"> vs {reference}{referenceLabel ? ` ${referenceLabel}` : ''}</span>}</span>
      </div>
      <div className="space-y-1">
        <div className="h-4 rounded bg-slate-100 overflow-hidden" role="img" aria-label={`${label}: ${value}${reference !== null ? `, cohort average ${reference}` : ''}`}>
          <div className="h-full rounded transition-all duration-500" style={{ width: `${(value / scale) * 100}%`, backgroundColor: STUDENT_COLOR }} />
        </div>
        {reference !== null && (
          <div className="h-1.5 rounded bg-slate-50 overflow-hidden">
            <div className="h-full rounded" style={{ width: `${Math.min((reference / scale) * 100, 100)}%`, backgroundColor: COHORT_COLOR }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Grouped bar chart: weeks on the x-axis, two series with tooltips. */
export function GroupedBarChart({ data, series, height = 160 }: {
  data: { label: string; values: Record<string, number> }[];
  series: { key: string; label: string; color: string }[];
  height?: number;
}) {
  if (data.length === 0) return <EmptyChart height={height} />;
  const max = Math.max(...data.flatMap((d) => Object.values(d.values)), 1);
  return (
    <div className="relative">
      <div className="flex items-end gap-3" style={{ height }} role="img" aria-label="Bar chart">
        {data.map((d) => (
          <div key={d.label} className="flex-1 flex flex-col items-center gap-1 min-w-0 group">
            <div className="w-full flex items-end justify-center gap-1 h-full" title={`${d.label}: ${series.map((s) => `${s.label} ${d.values[s.key] ?? 0}`).join(', ')}`}>
              {series.map((s) => (
                <div key={s.key} className="w-full max-w-[14px] rounded-t transition-all duration-500" style={{ height: `${Math.max(((d.values[s.key] ?? 0) / max) * 100, d.values[s.key] ? 3 : 0)}%`, backgroundColor: s.color }} />
              ))}
            </div>
            <span className="text-[10px] text-slate-400 truncate w-full text-center">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 justify-center">
        {series.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-slate-600"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}

/** Line chart with one or two series, an area fill, tooltips and dots. */
export function LineChart({ data, series, height = 150, yMax }: {
  data: { label: string; values: Record<string, number | null> }[];
  series: { key: string; label: string; color: string; dashed?: boolean }[];
  height?: number;
  yMax?: number;
}) {
  if (data.length === 0) return <EmptyChart height={height} />;
  if (data.length === 1) {
    const v = data[0];
    return (
      <div style={{ height }} className="flex flex-col justify-end">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-2 mb-2 text-xs text-solid-slate-700">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="text-slate-600">{s.label}:</span>
            <span className="font-semibold text-slate-900">{v.values[s.key] ?? 0}</span>
          </div>
        ))}
        <p className="text-[11px] text-slate-400">More data points will appear as you continue working through tasks.</p>
      </div>
    );
  }
  const max = yMax ?? Math.max(...data.flatMap((d) => Object.values(d.values).map((v) => v ?? 0)), 1);
  const w = 100;
  const paddingTop = 8;
  const plotH = height - paddingTop;
  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => paddingTop + (1 - Math.min(v / max, 1)) * plotH;
  return (
    <div className="relative" style={{ height }} role="img" aria-label="Line chart">
      <div className="absolute inset-0 flex flex-col justify-between">
        {[max, max / 2, 0].map((v, i) => <div key={i} className="border-t border-slate-100 flex"><span className="absolute -translate-y-2 text-[9px] text-slate-300">{Math.round(v)}</span></div>)}
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
        {series.map((s) => {
          const pts = data.map((d, i) => ({ i, v: d.values[s.key] ?? 0 }));
          const line = pts.map((p) => `${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
          const areaPath = `M ${x(0)},${height} L ${pts.slice(0, 1).map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} L ${line.split(' ').slice(1).join(' ')} L ${x(data.length - 1)},${height} Z`;
          return s.dashed ? (
            <polyline key={s.key} points={line} fill="none" stroke={s.color} strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          ) : (
            <g key={s.key}>
              {!s.dashed && data.length > 1 && <path d={areaPath} fill={s.color} opacity="0.07" />}
              <polyline points={line} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="2.5" fill={s.color}><title>{`${data[p.i].label}: ${s.label} ${p.v}`}</title></circle>)}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between mt-1">
        {data.filter((_, i) => i % Math.ceil(data.length / 5) === 0 || i === data.length - 1).map((d) => <span key={d.label} className="text-[10px] text-slate-400">{d.label}</span>)}
      </div>
      <div className="flex flex-wrap gap-3 mt-2 justify-center">
        {series.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-slate-600">{s.dashed ? <span className="w-4 h-0 border-t-2 border-dashed" style={{ borderColor: s.color }} /> : <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />}{s.label}</span>)}
      </div>
    </div>
  );
}

/** Horizontal box-plot style summary of a distribution with the student's position marked. */
export function BoxPlot({ min, q1, median, q3, max, student, height = 90 }: { min: number; q1: number; median: number; q3: number; max: number; student: number | null; height?: number }) {
  const scaleMax = Math.max(max, student ?? 0, 100);
  const pos = (v: number) => (Math.min(v, scaleMax) / scaleMax) * 100;
  return (
    <div style={{ height }} role="img" aria-label={`Marks distribution: minimum ${min}, lower quartile ${q1}, median ${median}, upper quartile ${q3}, maximum ${max}${student !== null ? `, your marks shown separately` : ''}`}>
      <div className="relative h-10 mt-4">
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-px bg-slate-200" />
        <div className="absolute top-1/2 -translate-y-1/2 h-2.5 bg-slate-200 rounded-sm" style={{ left: `${pos(min)}%`, width: `${Math.max(pos(max) - pos(min), 0.5)}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 h-8 w-[10px] -translate-x-1/2 bg-slate-100 border-x border-slate-300" style={{ left: `${pos(q1)}%` }} title={`Lower quartile: ${q1}`} />
        <div className="absolute top-1/2 -translate-y-1/2 h-8 w-[10px] -translate-x-1/2 bg-slate-300 border-x border-slate-400" style={{ left: `${pos(median)}%` }} title={`Median: ${median}`} />
        <div className="absolute top-1/2 -translate-y-1/2 h-8 w-[10px] -translate-x-1/2 bg-slate-100 border-x border-slate-300" style={{ left: `${pos(q3)}%` }} title={`Upper quartile: ${q3}`} />
        <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 -translate-x-1/2 rounded-full bg-slate-800" style={{ left: `${pos(max)}%` }} title={`Highest mark: ${max}`} />
        {student !== null && (
          <div className="absolute -top-5 -translate-x-1/2 flex flex-col items-center transition-all" style={{ left: `${pos(student)}%` }} title={`Your average mark: ${student}`}>
            <div className="w-3.5 h-3.5 rounded-full border-2 border-white shadow-md" style={{ backgroundColor: STUDENT_COLOR }} />
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-2">
        <span>0</span><span>Lowest {min}</span><span>Median {median}</span><span>Highest {max}</span><span>{scaleMax}</span>
      </div>
      {student !== null && <p className="text-[11px] text-slate-500 mt-1 text-center">The blue dot marks your average mark within the cohort.</p>}
    </div>
  );
}

export function EmptyChart({ height = 160, message = 'No data recorded yet.' }: { height?: number; message?: string }) {
  return (
    <div className="flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg" style={{ height }}>
      {message}
    </div>
  );
}