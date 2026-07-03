// today-data.mjs — pure view-model builder for the Lin Today dashboard page.
// Input: tracker rows from lib/tracker-data.mjs buildRows(); output: a dashboard-ui
// `sectioned` view-model + a stage snapshot used to diff "what changed" next run.
// Read-only companion (spec 2026-07-03); the actionable table stays in tracker-html.
export const FOLLOWUP_DAYS = 7;
export const SECOND_NUDGE_DAYS = 14;
const APP_URL = '/job-applications/';
const FUNNEL_STAGES = ['staged', 'built', 'ready', 'applied', 'interviewing', 'offer'];
const TERMINAL = new Set(['rejected', 'withdrew', 'declined', 'expired']);

const daysSince = (ymd, now) => ymd ? Math.floor((now - new Date(`${ymd}T00:00:00Z`)) / 86400000) : null;
const jobCell = (r) => ({ t: `${r.company} — ${r.role}${r.id ? ` #${r.id}` : ''}`, href: APP_URL });

export function followupsDue(rows, now) {
  return rows.filter((r) => r.stage === 'applied' && r.outcome == null
    && daysSince(r.updated, now) >= FOLLOWUP_DAYS)
    .sort((a, b) => daysSince(b.updated, now) - daysSince(a.updated, now));
}

export function deriveToday({ rows, prev, now = new Date() }) {
  const live = rows.filter((r) => r.company && r.role);
  const interviewing = live.filter((r) => ['interviewing', 'offer'].includes(r.stage));
  const due = followupsDue(live, now);
  const topStaged = live.filter((r) => ['staged', 'built', 'ready'].includes(r.stage) && !r.geoBlocked)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);

  const prevStages = prev?.stages ?? {};
  const changes = prev ? live.filter((r) => prevStages[r.key] && prevStages[r.key] !== r.stage) : [];
  const newRejections = changes.filter((r) => TERMINAL.has(r.stage) || TERMINAL.has(r.outcome));

  const stageCount = (s) => live.filter((r) => r.stage === s).length;
  const nudge = (d) => d >= SECOND_NUDGE_DAYS ? '2nd nudge' : 'follow up';

  const viewModel = {
    page: 'lin-today', title: 'Lin — Today', crumb: 'Lin Today',
    generated_at: now.toISOString(), cadence_hours: 16,
    kpis: [
      { label: 'Interviewing', value: String(interviewing.length) },
      { label: 'Follow-ups due', value: String(due.length), sub: `≥${FOLLOWUP_DAYS}d, no reply` },
      { label: 'New rejections', value: String(newRejections.length), sub: 'since last refresh' },
      { label: 'Staged ready', value: String(topStaged.length) },
    ],
    sections: [
      { id: 'attention', title: 'Needs attention', kind: 'table', collapsed: false,
        note: interviewing.length ? undefined : 'nothing in interview stage',
        columns: [{ label: 'Job' }, { label: 'Stage' }, { label: 'Depth' }],
        rows: interviewing.map((r) => [jobCell(r), { t: r.stage, chip: r.stage === 'offer' ? '🎉' : undefined }, { t: r.depthLabel || '—' }]) },
      { id: 'followups', title: 'Follow-ups due', kind: 'table', collapsed: false,
        columns: [{ label: 'Job' }, { label: 'Applied', align: 'r' }, { label: 'Action' }],
        rows: due.map((r) => { const d = daysSince(r.updated, now);
          return [jobCell(r), { t: `${d}d ago` }, { t: nudge(d) }]; }) },
      { id: 'changes', title: 'Changed since last refresh', kind: 'table', collapsed: false,
        columns: [{ label: 'Job' }, { label: 'Was' }, { label: 'Now' }],
        rows: changes.map((r) => [jobCell(r), { t: prevStages[r.key] }, { t: r.stage, tone: TERMINAL.has(r.stage) ? 'down' : 'up' }]) },
      { id: 'funnel', title: 'Pipeline funnel', kind: 'bars', collapsed: false,
        rows: FUNNEL_STAGES.map((s) => ({ label: s, value: stageCount(s), display: String(stageCount(s)) })) },
      { id: 'topstaged', title: 'Top staged — awaiting your go', kind: 'table', collapsed: false,
        columns: [{ label: 'Job' }, { label: 'Score', align: 'r' }, { label: 'Stage' }],
        rows: topStaged.map((r) => [jobCell(r), { t: r.score == null ? '—' : r.score.toFixed(1) }, { t: r.stage }]) },
    ],
  };
  const snapshot = { generated_at: now.toISOString(),
    stages: Object.fromEntries(live.map((r) => [r.key, r.stage])) };
  return { viewModel, snapshot };
}
