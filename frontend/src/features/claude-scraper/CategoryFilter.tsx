import { useMemo } from 'react';
import { MultiSelectFilter } from '../../shared/MultiSelectFilter';
import type { FilterOption } from '../../shared/MultiSelectFilter';
import { humanize } from './claudeDirectory';

/** Value that stands for the rows that have no category. */
export const NO_CATEGORY = '__none__';

interface Props {
  /** The categories this tab has, and whether some rows have none. */
  options: { list: string[]; none: boolean };
  /** The ticked ones. Empty means all. */
  value: string[];
  onChange: (next: string[]) => void;
}

/** A dropdown of checkboxes: tick as many categories as you like, and a row matches if it has any of them. */
export function CategoryFilter({ options, value, onChange }: Props) {
  const opts = useMemo<FilterOption[]>(
    () => [...(options.none ? [{ value: NO_CATEGORY, label: 'No category', none: true }] : []), ...options.list.map((v) => ({ value: v, label: humanize(v) }))],
    [options]
  );
  return <MultiSelectFilter options={opts} value={value} onChange={onChange} noun="category" nounPlural="categories" />;
}
