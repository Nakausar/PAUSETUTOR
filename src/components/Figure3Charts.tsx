import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { WeekPoint, MarkPoint, BoxGroup } from '@/lib/figure3Data';

export const F3_PINK = '#F2A0BD';
export const F3_TEAL = '#7CD4C0';
const F3_GRID = '#E5E7EB';
const F3_BG = '#F5F5F4';
const F3_TEXT = '#6B7280';

const tooltipStyle = {
  backgroundColor: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 6,
  fontSize: 11,
  padding: '4px 8px',
};

/** Figure-3 style dual line chart: participant (pink, markers) vs cohort (turquoise, shaded feel via area-like width). */
export function WeeklyLineChart({ data, height = 130, legendStudent, legendCohort, yMax }: {
  data: WeekPoint[];
  height?: number;
  legendStudent: string;
  legendCohort: string;
  yMax?: number;
}) {
  if (data.length === 0) {
    return <div className="text-[11px] text-slate-400 py-8 text-center" style={{ background: F3_BG }}>No recorded activity in scope.</div>;
  }
  return (
    <div style={{ background: F3_BG }} className="rounded px-1 pt-1 pb-0.5">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={F3_GRID} strokeDasharray="2 3" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 9, fill: F3_TEXT }} tickLine={false} axisLine={{ stroke: F3_GRID }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: F3_TEXT }} tickLine={false} axisLine={false} allowDecimals={false} domain={yMax ? [0, yMax] : [0, 'auto']} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 9, color: F3_TEXT }} iconSize={7} />
          <Line type="monotone" dataKey="student" name={legendStudent} stroke={F3_PINK} strokeWidth={2} dot={{ r: 2.5, fill: F3_PINK, stroke: 'none' }} activeDot={{ r: 3.5 }} connectNulls />
          <Line type="monotone" dataKey="cohort" name={legendCohort} stroke={F3_TEAL} strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Approved-marks line: participant marks (pink) vs cohort mean (turquoise). */
export function MarksLineChart({ data, height = 130, legendStudent, legendCohort }: {
  data: MarkPoint[];
  height?: number;
  legendStudent: string;
  legendCohort: string;
}) {
  if (data.length === 0) {
    return <div className="text-[11px] text-slate-400 py-8 text-center" style={{ background: F3_BG }}>No approved marks in scope.</div>;
  }
  const hasStudent = data.some((d) => d.student !== null);
  return (
    <div style={{ background: F3_BG }} className="rounded px-1 pt-1 pb-0.5">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={F3_GRID} strokeDasharray="2 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: F3_TEXT }} tickLine={false} axisLine={{ stroke: F3_GRID }} interval={0} angle={data.length > 8 ? -35 : 0} height={data.length > 8 ? 26 : 16} textAnchor={data.length > 8 ? 'end' : 'middle'} />
          <YAxis tick={{ fontSize: 9, fill: F3_TEXT }} tickLine={false} axisLine={false} domain={[0, 100]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => (v === '' || v === null ? '—' : String(v))} />
          <Legend wrapperStyle={{ fontSize: 9, color: F3_TEXT }} iconSize={7} />
          {hasStudent && <Line type="monotone" dataKey="student" name={legendStudent} stroke={F3_PINK} strokeWidth={2} dot={{ r: 3, fill: F3_PINK, stroke: 'none' }} connectNulls />}
          <Line type="monotone" dataKey="cohort" name={legendCohort} stroke={F3_TEAL} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Compact horizontal side-by-side box plots (SVG, no dependency) for approved mark distributions. */
export function BoxPlotChart({ groups, height = 150 }: { groups: BoxGroup[]; height?: number }) {
  if (groups.length === 0) {
    return <div className="text-[11px] text-slate-400 py-8 text-center" style={{ background: F3_BG }}>No approved marks in scope.</div>;
  }
  const plotW = 100;
  const plotH = 100;
  const pad = 8;
  const x = (v: number) => pad + (v / 100) * (plotW - 2 * pad);
  const rowH = plotH / groups.length;

  return (
    <div style={{ background: F3_BG }} className="rounded px-2 pt-2 pb-1">
      <svg viewBox={`0 0 ${plotW + 4} ${plotH + 10}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="assessment mark distributions">
        {/* axis */}
        <line x1={pad} y1={plotH + 2} x2={plotW - pad} y2={plotH + 2} stroke={F3_GRID} strokeWidth={0.5} />
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={plotH + 1.5} x2={x(t)} y2={plotH + 3} stroke={F3_GRID} strokeWidth={0.4} />
            <text x={x(t)} y={plotH + 7.5} fontSize={4.2} fill={F3_TEXT} textAnchor="middle">{t}</text>
          </g>
        ))}
        {groups.map((g, i) => {
          const y = i * rowH + rowH / 2;
          const { min, q1, median, q3, max } = g.stats;
          const alt = i % 2 === 1;
          const fill = alt ? F3_TEAL : F3_PINK;
          return (
            <g key={g.name}>
              <text x={1} y={y + 1.4} fontSize={4.2} fill="#374151" fontWeight={600}>{g.name}</text>
              {/* whiskers */}
              <line x1={x(min)} y1={y} x2={x(q1)} y2={y} stroke="#9CA3AF" strokeWidth={0.5} />
              <line x1={x(q3)} y1={y} x2={x(max)} y2={y} stroke="#9CA3AF" strokeWidth={0.5} />
              <line x1={x(min)} y1={y - 1.5} x2={x(min)} y2={y + 1.5} stroke="#9CA3AF" strokeWidth={0.5} />
              <line x1={x(max)} y1={y - 1.5} x2={x(max)} y2={y + 1.5} stroke="#9CA3AF" strokeWidth={0.5} />
              {/* box */}
              <rect x={x(q1)} y={y - 2.6} width={Math.max(x(q3) - x(q1), 0.6)} height={5.2} fill={fill} fillOpacity={0.75} stroke={fill} strokeWidth={0.4} rx={0.6} />
              {/* median */}
              <line x1={x(median)} y1={y - 2.6} x2={x(median)} y2={y + 2.6} stroke="#4B5563" strokeWidth={0.6} />
            </g>
          );
        })}
      </svg>
      <div className="text-right text-[9px] text-slate-400 -mt-1">0–100 scale · n={groups[0]?.n ?? 0}</div>
    </div>
  );
}

/** Figure-3 bracket separator: thin black line with end ticks, labelled panel heading below. */
export function BracketHeading({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="relative h-2">
        <div className="absolute left-0 right-0 top-0 border-t-2 border-slate-900" />
        <div className="absolute left-0 top-0 h-2 border-l-2 border-slate-900" />
        <div className="absolute right-0 top-0 h-2 border-r-2 border-slate-900" />
      </div>
      <h2 className="text-center text-sm font-bold text-slate-900 mt-1.5 tracking-wide">{label}</h2>
      {sub && <p className="text-center text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}
