import { buildCsv } from '../lib/exportCsv';
import { Count, Icon, ICONS, look } from '../../../shared/toolbar';
import type { RunState } from '../lib/probeTypes';

export default function ExportButtons({ run }: { run: RunState }) {
  const download = () => {
    // BOM so Excel opens non-ASCII app names (e.g. "Deník") correctly.
    const blob = new Blob(['﻿', buildCsv(run)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auth-discovery-${run.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button onClick={download} className={look.primary} title="Download the probe results as CSV">
      <Icon d={ICONS.download} />
      Export CSV
      <Count tone="onPrimary">{run.endpoints.length}</Count>
    </button>
  );
}
