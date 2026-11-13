interface Props {
  onNavigate: (to: string) => void;
}

function ScraperIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
      <path d="M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8 1.2 0 2.3-.1 3.3-.3" />
      <path d="M18.5 15.5v5m0 0-2-2m2 2 2-2" />
    </svg>
  );
}

function ProbeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="5.5" opacity=".75" />
      <circle cx="12" cy="12" r="9.5" opacity=".45" />
      <path d="M12 12l6.2-6.2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M8.5 8.5h7M8.5 11.5h4.5" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10h12m0 0-5-5m5 5-5 5" />
    </svg>
  );
}

function ToolCard({
  href,
  icon,
  eyebrow,
  title,
  body,
  chips,
  cta,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  chips: string[];
  cta: string;
  onClick: () => void;
}) {
  return (
    // The card itself is not a link: only the green button is, so the page does not hint that the whole card is clickable.
    <div className="relative flex flex-col text-left bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="h-1.5 shrink-0 bg-gradient-to-r from-[#86BC25] via-[#a8d44e] to-[#86EB22]" />
      <div className="flex flex-1 flex-col p-7 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="shrink-0 h-14 w-14 rounded-xl bg-[#282728] text-[#86BC25] flex items-center justify-center shadow-md ring-1 ring-black/10">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.14em] uppercase text-[#6a9a1c]">{eyebrow}</div>
            <h2 className="text-xl font-bold text-[#282728] leading-tight mt-0.5">{title}</h2>
          </div>
        </div>

        <p className="text-sm text-gray-600 leading-relaxed mt-5">{body}</p>

        <div className="flex flex-wrap gap-2 mt-5">
          {chips.map((c) => (
            <span key={c} className="text-xs font-medium px-2.5 py-1 rounded-full bg-[#f0f7e6] text-[#4f6e14] border border-[#dcebc0]">
              {c}
            </span>
          ))}
        </div>

        <div className="mt-auto pt-7">
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onClick();
            }}
            className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#86BC25] text-white font-semibold shadow-sm transition
                       hover:bg-[#6a9a1c] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#86BC25] focus-visible:ring-offset-2"
          >
            {cta}
            <Arrow />
          </a>
        </div>
      </div>
    </div>
  );
}

const GOOD_TO_KNOW = [
  'Nothing is stored unless you click Save scrape or Save probe. Saved work lives in this browser only.',
  'ChatGPT is fetched live through this app’s local server. If chatgpt.com refuses a request, copy the capture script, run it in a signed-in chatgpt.com/plugins tab and upload the file it saves, which holds no cookies or headers.',
  'Each page keeps its work while you move between pages, so you can collect, send to the Probe and come back.',
];

const PILL = {
  ready: 'border border-[#dcebc0] bg-[#f0f7e6] text-[#4f6e14]',
  plain: 'border border-gray-200 bg-gray-50 text-gray-600',
};

type Output = { label: string };

function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${PILL[tone]}`}>{children}</span>;
}

/** Arrow between two stages: pointing right on wide screens, down on narrow ones. Padded so it sits level with the cards, not the output arrows below them. */
function FlowArrow() {
  return (
    <li role="presentation" aria-hidden="true" className="flex shrink-0 items-center justify-center text-[#86BC25] lg:w-10 lg:pb-24">
      <svg viewBox="0 0 24 24" className="h-7 w-7 rotate-90 lg:rotate-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h16m0 0-6-6m6 6-6 6" />
      </svg>
    </li>
  );
}

/** Both collect cards lead into Send to Probe: two curves that merge into one arrow (wide screens), a plain down arrow otherwise. */
function MergeArrow() {
  return (
    <li role="presentation" aria-hidden="true" className="flex shrink-0 items-center justify-center text-[#86BC25] lg:w-14 lg:self-stretch lg:pb-24">
      <svg viewBox="0 0 24 24" className="h-7 w-7 rotate-90 lg:hidden" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h16m0 0-6-6m6 6-6 6" />
      </svg>
      <div className="relative hidden h-full w-full lg:block">
        <svg viewBox="0 0 56 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M2 25 C30 25 30 50 46 50" vectorEffect="non-scaling-stroke" />
          <path d="M2 75 C30 75 30 50 46 50" vectorEffect="non-scaling-stroke" />
        </svg>
        <svg viewBox="0 0 24 24" className="absolute right-0 top-1/2 h-6 w-6 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </li>
  );
}

/*
 * The output lines (wide screens). Each of Claude, ChatGPT and the Probe has two plain straight lines of its own into the
 * output band: one for Report, one for Export CSV (Report on the left, CSV on the right). Each line says which it is.
 * They are 96px tall: the h-24 corridor at the bottom of each column.
 */

/** A straight arrow from a card down into the output band. */
function LineArrow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 96" className={`h-24 w-5 text-[#86BC25] ${className}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 0v86" />
      <path d="M4 79l6 8 6-8" />
    </svg>
  );
}

/** The name of a line, written up the side of it. */
function LineLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`absolute text-[11px] leading-3 [writing-mode:vertical-rl] text-gray-500 ${className}`}>{children}</span>;
}

/** A source's name, written beside its lines. */
function SourceName({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`absolute text-[11px] font-semibold leading-4 text-[#282728] ${className}`}>{children}</span>;
}


/** The Probe's two lines, from the bottom of its card (which is shorter than the Collect cards) down to where the 96px lines begin. */
function ArrowLead() {
  return (
    <div className="relative hidden min-h-3 flex-1 lg:block" aria-hidden="true">
      <div className="absolute inset-y-0 left-[27px] w-0.5 bg-[#86BC25]" />
      <div className="absolute inset-y-0 left-[55px] w-0.5 bg-[#86BC25]" />
    </div>
  );
}

/** What a step can produce, written on the card. Shown on narrow screens, where the arrows are not drawn. */
function Outputs({ items }: { items: Output[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 lg:hidden">
      {items.map((o) => (
        <Pill key={o.label} tone="ready">
          {o.label}
        </Pill>
      ))}
    </div>
  );
}

/** Where you can begin: a label with an arrow down into the step. Always 56px tall (24px label, 32px arrow), which the Claude lines below rely on. */
function EntryArrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start">
      <span className="inline-flex h-6 items-center rounded-full border border-[#86BC25] bg-[#f0f7e6] px-3 text-[11px] font-semibold text-[#4f6e14]">{children}</span>
      <svg viewBox="0 0 20 32" className="ml-5 h-8 w-5 text-[#86BC25]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 0v24" />
        <path d="M4 17l6 8 6-8" />
      </svg>
    </div>
  );
}

function Eyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#282728] text-xs font-bold text-[#86BC25]">{n}</span>
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">{children}</span>
    </div>
  );
}

function LaneCard({ icon, title, steps, outputs }: { icon: React.ReactNode; title: string; steps: string[]; outputs: Output[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#282728] text-[#86BC25] [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
        <span className="text-sm font-semibold text-[#282728]">{title}</span>
      </div>
      <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-gray-600">
        {steps.map((s) => (
          <li key={s} className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#86BC25]" />
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <Outputs items={outputs} />
    </div>
  );
}

function StepCard({ title, children, outputs }: { title: string; children: React.ReactNode; outputs?: Output[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-[#282728]">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-gray-600">{children}</div>
      {outputs && <Outputs items={outputs} />}
    </div>
  );
}

export default function Landing({ onNavigate }: Props) {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-[#282728]">
        <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_85%_20%,rgba(134,188,37,0.28),transparent_60%)]" />
        <svg
          className="absolute -right-16 -top-10 h-[26rem] w-[26rem] hidden sm:block opacity-80"
          viewBox="0 0 400 400"
          fill="none"
          aria-hidden="true"
        >
          {[60, 110, 160, 210].map((r, i) => (
            <circle key={r} cx="200" cy="200" r={r} stroke="#86BC25" strokeOpacity={0.5 - i * 0.11} strokeWidth="1.5" />
          ))}
          <circle cx="200" cy="200" r="9" fill="#86BC25" />
        </svg>

        <div className="relative max-w-6xl mx-auto px-6 pt-14 pb-24 sm:pt-20 sm:pb-28">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] uppercase text-[#86BC25] bg-white/5 ring-1 ring-white/10 rounded-full px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#86BC25]" />
            MCP Directory and Client Registration Analysis
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white leading-[1.1] mt-5 max-w-2xl">
            Track connector <span className="text-[#86BC25]">launch pace</span> and how MCP servers handle{' '}
            <span className="text-[#86BC25]">client registration</span>.
          </h1>
          <p className="text-[15px] sm:text-base text-gray-300 mt-5 max-w-xl leading-relaxed">
            Collect the Claude and ChatGPT directories to track connector and plugin launch trends. Then probe each MCP
            endpoint to identify its client registration method: Dynamic Client Registration (DCR), Client ID Metadata Documents
            (CIMD), or possibly a pre-registered OAuth client. Compile the findings into reports and CSV exports.
          </p>
        </div>
      </section>

      {/* Cards, overlapping the hero */}
      <section className="max-w-6xl mx-auto px-6 -mt-14 sm:-mt-16 relative">
        <div className="grid gap-6 md:grid-cols-3">
          <ToolCard
            href="/claude"
            icon={<ScraperIcon />}
            eyebrow="Collect · Claude"
            title="Claude Directory Scraper"
            body="One click scrapes Anthropic's public directory and classifies every entry as a Connector, Plugin or Extension."
            chips={['Live progress', 'Search and filter', 'Save and History', 'Launch pace report', 'Export CSV', 'Send to Probe']}
            cta="Open Claude scraper"
            onClick={() => onNavigate('/claude')}
          />
          <ToolCard
            href="/chatgpt"
            icon={<ChatIcon />}
            eyebrow="Collect · ChatGPT"
            title="ChatGPT Plugin Scraper"
            body="One click reads the chatgpt.com plugin directory live, then fetches every plugin's developer, website and MCP servers and lists them by category."
            chips={['Every category', 'Search and filter', 'Save and History', 'Endpoint report', 'Export CSV', 'Send to Probe']}
            cta="Open ChatGPT scraper"
            onClick={() => onNavigate('/chatgpt')}
          />
          <ToolCard
            href="/probe"
            icon={<ProbeIcon />}
            eyebrow="Analyse · OAuth"
            title="OAuth Client Registration Scanner"
            body="Checks each MCP endpoint to identify its client registration method: Dynamic Client Registration (DCR), Client ID Metadata Documents (CIMD) or possibly a pre-registered OAuth client. Paste URLs, upload a CSV or send them from the scrapers."
            chips={['DCR and CIMD', 'Public clients', 'Request details', 'Save and History', 'Probe report', 'Export CSV']}
            cta="Open probe"
            onClick={() => onNavigate('/probe')}
          />
        </div>

        {/* How to use. Claude, ChatGPT and the Probe each have their own arrow down into the Report / CSV band. */}
        <div className="mt-14 mb-16">
          <div className="text-center">
            <div className="text-[11px] font-bold tracking-[0.16em] uppercase text-gray-500">How to use</div>
            <h2 className="mt-1 text-xl font-bold text-[#282728]">From directory to findings</h2>
            <p className="mx-auto mt-1 max-w-xl text-sm text-gray-500">
              Use the app in either of two ways. Collect from Claude, ChatGPT or both and send the endpoints you care about to the Probe, or go straight to the Probe if you already have the MCP endpoints you want to check. Then build a report or export a CSV from any of the three.
            </p>
          </div>

          <ol className="mt-8 grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_3.5rem_1fr_2.5rem_1fr] lg:gap-y-0">
            <li className="relative flex flex-col lg:pl-12">
              <EntryArrow>Start here: collect first, then probe</EntryArrow>
              <Eyebrow n="1">Collect</Eyebrow>
              <div className="space-y-3">
                <LaneCard
                  icon={<ScraperIcon />}
                  title="Claude"
                  steps={['Open Claude and click Fetch All Pages.', 'Search and filter, then Save scrape to keep it in History.']}
                  outputs={[{ label: 'Report' }, { label: 'Export CSV' }]}
                />
                <LaneCard
                  icon={<ChatIcon />}
                  title="ChatGPT"
                  steps={['Open ChatGPT and click Fetch live. Every category and each plugin’s details are read for you.', 'Search and filter, then Save scrape to keep it in History.']}
                  outputs={[{ label: 'Report' }, { label: 'Export CSV' }]}
                />
              </div>

              {/* Claude's two lines (wide screens): both leave the left edge of its card, run down the margin past the ChatGPT card and end in the band.
                  The outer one (Report) leaves higher than the inner one (CSV), so they never cross. */}
              <span className="pointer-events-none absolute left-2 top-[118px] hidden h-0.5 w-10 bg-[#86BC25] lg:block" aria-hidden="true" />
              <span className="pointer-events-none absolute bottom-3 left-[7px] top-[118px] hidden w-0.5 bg-[#86BC25] lg:block" aria-hidden="true" />
              <svg viewBox="0 0 16 12" className="pointer-events-none absolute bottom-0 left-0 hidden h-3 w-4 text-[#86BC25] lg:block" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 2l6 8 6-8" />
              </svg>
              <span className="pointer-events-none absolute left-6 top-[134px] hidden h-0.5 w-6 bg-[#86BC25] lg:block" aria-hidden="true" />
              <span className="pointer-events-none absolute bottom-3 left-[25px] top-[134px] hidden w-0.5 bg-[#86BC25] lg:block" aria-hidden="true" />
              <svg viewBox="0 0 16 12" className="pointer-events-none absolute bottom-0 left-[18px] hidden h-3 w-4 text-[#86BC25] lg:block" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 2l6 8 6-8" />
              </svg>
              <LineLabel className="bottom-5 left-[11px] hidden lg:block">Report</LineLabel>
              <LineLabel className="bottom-5 left-[29px] hidden lg:block">CSV</LineLabel>
              <SourceName className="bottom-[78px] left-[34px] hidden lg:block">Claude</SourceName>

              {/* ChatGPT's two lines: straight down from under its card. */}
              <div className="relative hidden h-24 lg:block" aria-hidden="true">
                <LineArrow className="absolute left-[112px] top-0" />
                <LineArrow className="absolute left-[140px] top-0" />
                <LineLabel className="left-[130px] top-6">
                  Report
                </LineLabel>
                <LineLabel className="left-[158px] top-6">CSV</LineLabel>
                <SourceName className="left-[176px] top-1">ChatGPT</SourceName>
              </div>
            </li>

            <MergeArrow />

            <li className="lg:self-center lg:pb-24">
              <Eyebrow n="2">Send</Eyebrow>
              <StepCard title="Send to Probe">
                Filter to the endpoints you care about and click <b>Send to Probe</b>. They arrive with their names, and Claude connectors also bring their category. On Claude, only the Connectors tab can be sent.
              </StepCard>
            </li>

            <FlowArrow />

            <li className="flex flex-col lg:self-stretch">
              <div className="flex flex-col justify-end lg:flex-1">
                <EntryArrow>Or start here: probe endpoints you already have</EntryArrow>
              </div>
              <Eyebrow n="3">Probe</Eyebrow>
              <StepCard title="Check the OAuth setup" outputs={[{ label: 'Report' }, { label: 'Export CSV' }]}>
                Start the probe to identify each endpoint’s client registration method: DCR, CIMD or possibly a pre-registered OAuth client. Save the run to Probe history.
                <div className="mt-2">
                  <Pill tone="plain">You can also paste URLs or upload a CSV</Pill>
                </div>
              </StepCard>
              <ArrowLead />
              {/* The Probe's two lines: straight down from under its card. */}
              <div className="relative hidden h-24 lg:block" aria-hidden="true">
                <LineArrow className="absolute left-[18px] top-0" />
                <LineArrow className="absolute left-[46px] top-0" />
                <LineLabel className="left-[35px] top-6">Report</LineLabel>
                <LineLabel className="left-[63px] top-6">CSV</LineLabel>
                <SourceName className="left-[78px] top-1">Probe</SourceName>
              </div>
            </li>

            <li className="lg:col-span-5">
              <div className="mb-2 text-center text-xs text-gray-500 lg:hidden">Each step can then produce:</div>
              <div className="space-y-3 rounded-xl border-2 border-[#86BC25]/40 bg-[#f0f7e6]/70 p-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#86BC25] text-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  </span>
                  <div>
                    <div className="text-sm font-bold text-[#282728]">HTML report</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-gray-600">
                      One self-contained HTML page with charts and tables. It opens in a new tab, so you can read it, share it or save it.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 border-t border-[#86BC25]/30 pt-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#86BC25] text-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 4v11 M7 11l5 5 5-5 M5 20h14" />
                    </svg>
                  </span>
                  <div>
                    <div className="text-sm font-bold text-[#282728]">CSV export</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-gray-600">
                      A spreadsheet file of your results. On the Claude and ChatGPT pages it follows your search and filters, so you export just what you chose. The Probe exports its whole run.
                    </div>
                  </div>
                </div>
              </div>
            </li>
          </ol>

          <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white/60 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">Good to know</div>
            <ul className="mt-2 grid gap-x-6 gap-y-2 text-xs leading-relaxed text-gray-600 md:grid-cols-3">
              {GOOD_TO_KNOW.map((g) => (
                <li key={g} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#86BC25]" />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
