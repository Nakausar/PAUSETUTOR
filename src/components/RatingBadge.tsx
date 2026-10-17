import type { MetacognitiveRating } from '@/lib/types';

export const RATING_LABELS: Record<MetacognitiveRating, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_improvement: 'Needs Improvement',
  not_observed: 'Not Observed',
  not_applicable: 'Not Applicable',
};

const RATING_STYLES: Record<MetacognitiveRating, string> = {
  excellent: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  good: 'bg-sky-100 text-sky-800 border-sky-200',
  needs_improvement: 'bg-amber-100 text-amber-800 border-amber-200',
  not_observed: 'bg-slate-100 text-slate-600 border-slate-200',
  not_applicable: 'bg-slate-50 text-slate-400 border-slate-200',
};

export function RatingBadge({ rating, small }: { rating: MetacognitiveRating | null; small?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-md border font-medium ${small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'} ${rating ? RATING_STYLES[rating] : 'bg-white text-slate-300 border-slate-100'}`}>
      {rating ? RATING_LABELS[rating] : '—'}
    </span>
  );
}
