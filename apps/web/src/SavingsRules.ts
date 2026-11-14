import type { FieldDef } from './types';
export function savingsFields(g: any, unit: string, decimal: (s: string) => string): FieldDef[] {
  return [
    {
      id: 'contributionMode',
      label: 'Contribution type',
      type: 'select',
      value: g?.contributionMode || 'PERCENT',
      options: [
        { value: 'PERCENT', label: 'Percentage' },
        { value: 'FIXED', label: 'Fixed amount' },
      ],
    },
    {
      id: 'contributionValue',
      label: 'Contribution: % or amount (' + unit + ')',
      type: 'number',
      min: '0',
      step: '0.01',
      value:
        g?.contributionMode === 'FIXED'
          ? decimal(g.contributionValue)
          : String(Number(g?.contributionValue ?? 10000) / 100),
      hint:
        'Percentage uses the basis below. Fixed uses ' +
        unit +
        '. Priority clips contributions to the available goals budget.',
    },
    {
      id: 'percentBasis',
      label: 'Percentage is measured against',
      type: 'select',
      value: g?.percentBasis || 'GOAL_BUDGET',
      options: [
        { value: 'GOAL_BUDGET', label: 'Goals budget in this salary' },
        { value: 'SALARY', label: 'Entire salary received' },
      ],
    },
    {
      id: 'priority',
      label: 'Priority (1 is first)',
      type: 'number',
      min: '1',
      step: '1',
      value: String(g?.priority || 1),
    },
    {
      id: 'overflow',
      label: 'Contribution left over when this goal fills',
      type: 'select',
      value: g?.overflow || 'CASH',
      options: [
        { value: 'CASH', label: 'Keep as free cash' },
        { value: 'NEXT', label: 'Offer to the next active goal' },
      ],
    },
    {
      id: 'targetDate',
      label: 'Target date (optional planning date)',
      type: 'date',
      value: g?.targetDate || '',
      required: false,
    },
    {
      id: 'state',
      label: 'Goal status',
      type: 'select',
      value: g?.state === 'RELEASED' ? 'PAUSED' : g?.state || 'ACTIVE',
      options: [
        ...(g?.state === 'COMPLETED'
          ? [{ value: 'COMPLETED', label: 'Completed; do not restart' }]
          : []),
        { value: 'DRAFT', label: 'Draft; no salary contributions' },
        { value: 'ACTIVE', label: 'Active; fund from future salaries' },
        { value: 'PAUSED', label: 'Paused; keep existing savings' },
        { value: 'ARCHIVED', label: 'Archived; keep history and savings' },
      ],
    },
  ];
}
export function savingsValues(v: Record<string, string>, atomic: (s: string) => string) {
  return {
    contributionMode: v.contributionMode,
    contributionValue:
      v.contributionMode === 'FIXED'
        ? atomic(v.contributionValue)
        : String(Math.round(Number(v.contributionValue) * 100)),
    percentBasis: v.percentBasis,
    overflow: v.overflow,
    targetDate: v.targetDate || null,
    state: v.state,
    confirmChanges: true,
  };
}
export function savingsSummary(g: any, format: (s: string) => string) {
  return (
    (g.contributionMode === 'FIXED'
      ? format(g.contributionValue)
      : Number(g.contributionValue ?? 10000) / 100 +
        '% of ' +
        (g.percentBasis === 'SALARY' ? 'salary' : 'goals budget')) +
    ' · excess to ' +
    ((g.overflow ?? 'NEXT') === 'NEXT' ? 'next goal' : 'cash') +
    (g.targetDate ? ' · target ' + g.targetDate : '')
  );
}
