import { Check } from 'lucide-react';
import { PHASES } from '@/lib/constants';
import type { PausePhase } from '@/lib/types';

interface PhaseProgressProps {
  currentPhase: PausePhase;
  completedPhases?: Set<PausePhase>;
  size?: 'sm' | 'md' | 'lg';
}

export default function PhaseProgress({ currentPhase, completedPhases = new Set(), size = 'md' }: PhaseProgressProps) {
  const sizes = {
    sm: { circle: 'w-7 h-7 text-xs', label: 'text-[10px]', gap: 'gap-0.5', icon: 'w-3 h-3' },
    md: { circle: 'w-9 h-9 text-sm', label: 'text-xs', gap: 'gap-1', icon: 'w-4 h-4' },
    lg: { circle: 'w-11 h-11 text-base', label: 'text-sm', gap: 'gap-1.5', icon: 'w-5 h-5' },
  };
  const s = sizes[size];

  return (
    <div className="flex items-center justify-between w-full">
      {PHASES.map((phase, i) => {
        const isCurrent = currentPhase === phase.key;
        const isCompleted = completedPhases.has(phase.key);
        const showCheck = isCompleted;

        return (
          <div key={phase.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center text-center" style={{ minWidth: size === 'sm' ? 48 : 64 }}>
              <div
                className={`${s.circle} rounded-full flex items-center justify-center font-semibold border-2 transition-all duration-300 ${
                  isCurrent
                    ? 'bg-slate-900 text-white border-slate-900 ring-4 ring-slate-200 scale-110'
                    : showCheck
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-400 border-slate-200'
                }`}
              >
                {showCheck ? <Check className={s.icon} /> : phase.letter}
              </div>
              <span className={`${s.label} mt-1.5 font-medium ${
                isCurrent ? 'text-slate-900' : showCheck ? 'text-emerald-600' : 'text-slate-400'
              }`}>
                {phase.label}
              </span>
            </div>
            {i < PHASES.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 rounded-full transition-colors duration-500 ${
                showCheck ? 'bg-emerald-400' : 'bg-slate-200'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
