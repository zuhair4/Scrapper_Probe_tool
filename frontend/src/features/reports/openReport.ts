const PREPARING_HTML =
  '<!doctype html><meta charset="utf-8"><title>Preparing report…</title>' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6fa;color:#475467;font:16px system-ui,sans-serif}' +
  '.s{width:34px;height:34px;border:4px solid #dbe1ec;border-top-color:#86bc25;border-radius:50%;animation:r .8s linear infinite;margin:0 auto 14px}' +
  '@keyframes r{to{transform:rotate(360deg)}}</style>' +
  '<div style="text-align:center"><div class="s"></div>Preparing your report…</div>';

export interface BuiltReport {
  html: string;
  fileName: string;
}

/**
 * Opens a report in a new tab. The tab has to be opened inside the click (otherwise pop-up
 * blockers stop it), so it opens first with a "preparing" page and is pointed at the report once
 * built. If the tab is blocked or closed, the report is downloaded instead so it is never lost.
 * Call from a click handler.
 */
export async function openReport(build: () => BuiltReport | Promise<BuiltReport>): Promise<void> {
  const tab = window.open('', '_blank');
  if (tab) tab.document.write(PREPARING_HTML);
  tab?.document.close();
  // Let the caller's spinner paint before the (synchronous) build starts.
  await new Promise((r) => setTimeout(r, 50));
  try {
    const { html, fileName } = await build();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    if (tab && !tab.closed) {
      tab.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      window.alert('Your browser blocked the new tab, so the report was downloaded instead. Allow pop-ups for this site to open it in a tab.');
    }
  } catch (e) {
    tab?.close();
    window.alert(`Could not generate the report: ${e instanceof Error ? e.message : String(e)}`);
  }
}
