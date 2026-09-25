import { Check, Lock } from 'lucide-react';
import { PHASES, PHASE_COLORS } from '@/lib/constants';
import type { PausePhase } from '@/lib/types';

export type PhaseStatus = 'locked' | 'available' | 'active' | 'completed';

interface PhaseProgressProps {
  currentPhase: PausePhase;
  completedPhases?: Set<PausePhase>;
  /** Which phases the student may currently enter (flexible navigation). */
  enabledPhases?: Set<PausePhase>;
  /** Optional revisit counts to show natural context, e.g. "visited 2×". */
  visitCounts?: Partial<Record<PausePhase, number>>;
  onPhaseSelect?: (phase: PausePhase) => void;
  size?: 'sm' | 'md' | 'lg';
}

function phaseStatus(phase: PausePhase, currentPhase: PausePhase, completedPhases: Set<PausePhase>, enabledPhases: Set<PausePhase> | undefined): PhaseStatus {
  if (currentPhase === phase) return 'active';
  if (completedPhases.has(phase)) return 'completed';
  if (enabledPhases === undefined) return 'available';
  return enabledPhases.has(phase) ? 'available' : 'locked';
}

const FALLBACK_COLOR = { accent: '#475569', accentSoft: 'rgba(71, 85, 105, 0.12)', accentSofter: 'rgba(71, 85, 105, 0.06)', label: 'Slate' };
function colorFor(key: PausePhase) {
  return key in PHASE_COLORS ? PHASE_COLORS[key as keyof typeof PHASE_COLORS] : FALLBACK_COLOR;
}

export default function PhaseProgress({ currentPhase, completedPhases = new Set(), enabledPhases, visitCounts, onPhaseSelect, size = 'md' }: PhaseProgressProps) {
  const sizes = {
    sm: { circle: 'w-7 h-7 text-xs', label: 'text-[10px]', icon: 'w-3 h-3' },
    md: { circle: 'w-9 h-9 text-sm', icon: 'w-4 h-4', label: 'text-xs' },
    lg: { circle: 'w-11 h-11 text-base', icon: 'w-5 h-5', label: 'text-sm' },
  };
  const s = sizes[size];
  const interactive = typeof onPhaseSelect === 'function';

  return (
    <nav aria-label="PAUSE phases" className="flex items-center justify-between w-full">
      {PHASES.map((phase, i) => {
        const status = phaseStatus(phase.key, currentPhase, completedPhases, enabledPhases);
        const color = colorFor(phase.key);
        const clickable = interactive && status !== 'locked';
        const visits = visitCounts?.[phase.key] ?? 0;
        const tooltip =
          status === 'locked'
            ? `${phase.full} — available later`
            : `${phase.full}${status === 'active' ? ' (current)' : ''}${clickable ? ' — click to go' : ''}`;
        const nextDoneOrActive = status === 'completed' || status === 'active';

        return (
          <div key={phase.key} className="flex items-center flex-1 last:flex-none">
            <button
              type="button"
              disabled={!clickable}
              title={tooltip}
              aria-current={status === 'active' ? 'step' : undefined}
              onClick={() => clickable && onPhaseSelect?.(phase.key)}
              className={`flex flex-col items-center text-center rounded-lg px-1.5 py-1 -mx-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                clickable ? 'cursor-pointer hover:bg-slate-50' : status === 'locked' ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              style={{ minWidth: size === 'sm' ? 52 : 68 }}
            >
              <span
                className={`${s.circle} rounded-full flex items-center justify-center font-semibold border-2 transition-all duration-300 ${
                  status === 'active' ? 'scale-110 text-white' : ''
                }`}
                style={{
                  backgroundColor: status === 'active' ? color.accent : status === 'completed' ? '#059669' : undefined,
                  borderColor: status === 'active' ? color.accent : status === 'completed' ? '#059669' : undefined,
                  color: status === 'locked' ? '#94A3B8' : status === 'active' ? '#FFFFFF' : status === 'completed' ? '#FFFFFF' : color.accent,
                  background: status === 'available' ? color.accentSoft : undefined,
                }}
              >
                {status === 'completed' ? (
                  <Check className={s.icon} aria-label={`${phase.label} completed`} />
                ) : status === 'locked' ? (
                  <Lock className={s.icon} aria-label={`${phase.label} not yet available`} />
                ) : (
                  phase.letter
                )}
              </span>
              <span
                className={`${s.label} mt-1.5 font-medium leading-tight`}
                style={{ color: status === 'active' ? color.accent : status === 'completed' ? '#059669' : status === 'locked' ? '#94A3B8' : '#334155' }}
              >
                {phase.label}
              </span>
              {visits > 1 && status !== 'active' && (
                <span className="text-[10px] text-slate-400 leading-none mt-0.5">{visits}×</span>
              )}
              {!visits && status === 'active' && null}
            </button>
            {i < PHASES.length - 1 && (
              <div
                className="flex-1 h-0.5 mx-1 rounded-full transition-colors duration-500"
                style={{ backgroundColor: nextDoneOrActive ? color.accent : '#E2E8F0' }}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
