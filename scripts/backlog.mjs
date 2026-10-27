#!/usr/bin/env node
/**
 * Backlog tooling for the voice-form-engine backlog.
 *
 * The single source of truth is `docs/backlog/tickets/*.md` (one file per ticket,
 * YAML-ish frontmatter + markdown body).
 *
 *   node scripts/backlog.mjs build              # regenerate BACKLOG.md
 *   node scripts/backlog.mjs sync --dry-run     # print what would happen
 *   node scripts/backlog.mjs sync --apply       # create/update labels, milestones, issues
 *
 * `sync` is idempotent: existing issues are matched by their `[P0-1]` style
 * prefix and patched in place instead of duplicated. Issue numbers are written
 * back into each ticket's frontmatter.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TICKET_DIR = join(ROOT, 'docs', 'backlog', 'tickets');
const BACKLOG_MD = join(ROOT, 'BACKLOG.md');
const ISSUE_DIR = join(ROOT, 'docs', 'backlog', 'issues');

const PHASE_META = {
  0: { key: 'phase-0', title: 'Phase 0 — Foundation & Universal Contract', short: 'Foundation (sequential)', desc: 'Blocks every other track. Lock the monorepo and the protocol.' },
  1: { key: 'phase-1', title: 'Phase 1 — Parallel Component Tracks', short: 'Tracks A–E (parallel)', desc: 'Five independent tracks coding against the frozen protocol.' },
  2: { key: 'phase-2', title: 'Phase 2 — System Integration & Orchestration', short: 'Integration (sequential)', desc: 'Wire the pillars into one voice-to-form loop.' },
  3: { key: 'phase-3', title: 'Phase 3 — QA & Synthetic Torture Testbed', short: 'QA (starts early)', desc: 'Hostile forms that prove the engine is universal.' },
};

const TRACK_META = {
  foundation: { label: 'Foundation', emoji: '🧱' },
  'a-eyes': { label: 'Track A — The Eyes (DOM Distiller)', emoji: '👁️' },
  'b-hands': { label: 'Track B — The Hands (Action Executor)', emoji: '🤚' },
  'c-brain': { label: 'Track C — The Brain (LLM Service)', emoji: '🧠' },
  'd-ears': { label: 'Track D — The Ears (Audio & STT)', emoji: '👂' },
  'e-hud': { label: 'Track E — The HUD (Visual Overlay)', emoji: '🖥️' },
  integration: { label: 'Integration & Orchestration', emoji: '🔌' },
  qa: { label: 'QA & Testbed', emoji: '🧪' },
};

const LABEL_COLORS = {
  'phase:0-foundation': '0b3d91',
  'phase:1-tracks': '1d76db',
  'phase:2-integration': '8250df',
  'phase:3-qa': 'bf8700',
  'track:foundation': '6e7781',
  'track:a-eyes': '1a7f37',
  'track:b-hands': 'bc4c00',
  'track:c-brain': 'a40e26',
  'track:d-ears': '0969da',
  'track:e-hud': '6f42c1',
  'track:integration': '8250df',
  'track:qa': 'bf8700',
  'type:feature': '1d76db',
  'type:chore': '8b949e',
  'type:test': '0e8a16',
  'type:spike': 'd4c5f9',
  'priority:p0': 'b60205',
  'priority:p1': 'e36209',
  'priority:p2': 'fbcA04',
  'area:protocol': '006b75',
  'area:dom-engine': '1a7f37',
  'area:brain': 'a40e26',
  'area:llm': '6f42c1',
  'area:extension': '0969da',
  'area:audio': '0e8a16',
  'area:ui': 'd876e3',
  'area:performance': 'c2e0c6',
  'area:a11y': 'f143ab',
  'area:security': 'b60205',
  'area:testbed': 'bf8700',
  'area:e2e': '5319e7',
  'area:integration': '8250df',
  'area:tooling': '8b949e',
  'agent-ready': '2ea44f',
};

// ---------------------------------------------------------------- frontmatter

function parseScalar(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseScalar(s));
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseTicket(file) {
  const raw = readFileSync(join(TICKET_DIR, file), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1));
  }
  return { file, meta, body: m[2].trim() };
}

function loadTickets() {
  const files = readdirSync(TICKET_DIR).filter((f) => f.endsWith('.md'));
  const tickets = files.map(parseTicket);
  for (const t of tickets) {
    t.meta.phase = Number(t.meta.phase);
    t.meta.labels = t.meta.labels ?? [];
    t.meta.blocked_by = t.meta.blocked_by ?? [];
  }
  // KANBAN order: phase asc, then id letter-group, then number
  tickets.sort((a, b) => {
    if (a.meta.phase !== b.meta.phase) return a.meta.phase - b.meta.phase;
    const ga = a.meta.id.replace(/[-_]\d+$/, '');
    const gb = b.meta.id.replace(/[-_]\d+$/, '');
    if (ga !== gb) return ga.localeCompare(gb);
    return Number(a.meta.id.match(/(\d+)$/)?.[1] ?? 0) - Number(b.meta.id.match(/(\d+)$/)?.[1] ?? 0);
  });
  return tickets;
}

function topoSort(tickets) {
  const byId = new Map(tickets.map((t) => [t.meta.id, t]));
  const out = [];
  const seen = new Set();
  const visiting = new Set();
  const visit = (t) => {
    if (!t || seen.has(t.meta.id)) return;
    if (visiting.has(t.meta.id)) throw new Error(`dependency cycle at ${t.meta.id}`);
    visiting.add(t.meta.id);
    for (const dep of t.meta.blocked_by) visit(byId.get(dep));
    visiting.delete(t.meta.id);
    seen.add(t.meta.id);
    out.push(t);
  };
  for (const t of tickets) visit(t);
  return out;
}

// ---------------------------------------------------------------- markdown

function issueTitle(t) {
  return `[${t.meta.id}] ${t.meta.title}`;
}

function issueBody(t, tickets) {
  const byId = new Map(tickets.map((x) => [x.meta.id, x]));
  const phase = PHASE_META[t.meta.phase];
  const track = TRACK_META[t.meta.track] ?? { label: t.meta.track, emoji: '•' };
  const dep = (id) => {
    const d = byId.get(id);
    if (!d) return `- \`${id}\` (missing ticket)`;
    const num = d.meta.github_issue;
    return num ? `- [ ] #${num} — ${d.meta.title}` : `- [ ] \`${id}\` — ${d.meta.title}`;
  };
  const lines = [
    `<!-- AUTO-GENERATED from docs/backlog/tickets/${t.meta.id}.md. Do not edit this issue by hand. -->`,
    `<!-- Edit the ticket file, then run: node scripts/backlog.mjs sync --apply -->`,
    '',
    `> **Ticket \`${t.meta.id}\`** · ${phase.title} · ${track.emoji} ${track.label} · priority \`${t.meta.priority}\` · estimate \`${t.meta.estimate_hours}h (${t.meta.estimate})\``,
    '',
    '| | |',
    '| --- | --- |',
    `| **Phase** | ${phase.short} |`,
    `| **Track** | ${track.emoji} ${track.label} |`,
    `| **Owner role** | ${t.meta.owner_role} |`,
    `| **Estimate** | ${t.meta.estimate_hours} h (${t.meta.estimate}) |`,
    `| **Parallel-safe** | ${t.meta.parallel_safe ? '✅ yes' : '⚠️ no — coordinate merges'} |`,
    `| **Source** | [\`docs/backlog/tickets/${t.meta.id}.md\`](https://github.com/${repoSlug()}/blob/main/docs/backlog/tickets/${t.meta.id}.md) |`,
    '',
    '### Dependencies',
    '',
    '**Blocked by:**',
    ...(t.meta.blocked_by.length ? t.meta.blocked_by.map(dep) : ['- none — can start immediately']),
    '',
    '**Unblocks:**',
    ...(t.meta.blocks?.length
      ? t.meta.blocks.map((id) => {
          const b = byId.get(id);
          const num = b?.meta.github_issue;
          return num ? `- ${num ? `#${num}` : id} — ${b.meta.title}` : `- ${id}`;
        })
      : ['- (leaf)']),
    '',
    '---',
    '',
    t.body,
    '',
    '---',
    '',
    '### Live status',
    '',
    '- [ ] Design reviewed by another track owner',
    '- [ ] Implementation complete',
    '- [ ] Unit tests green + coverage gate met',
    '- [ ] Browser/E2E tests green (where applicable)',
    '- [ ] Docs updated',
    '- [ ] Acceptance criteria all checked',
    '',
    `_Generated by \`scripts/backlog.mjs\`. Source of truth: \`docs/backlog/tickets/${t.meta.id}.md\`._`,
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

let cachedSlug = null;
function repoSlug() {
  if (cachedSlug) return cachedSlug;
  try {
    cachedSlug = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    cachedSlug = process.env.GITHUB_REPOSITORY || 'OWNER/REPO';
  }
  return cachedSlug;
}

function buildIndex(tickets) {
  const out = [];
  const withIssue = tickets.filter((t) => t.meta.github_issue).length;
  out.push('# Backlog — Voice Form Engine (Zero → MVP)');
  out.push('');
  out.push(
    '> **Generated file — do not edit.** Source of truth: `docs/backlog/tickets/*.md`.' +
      ' Regenerate with `node scripts/backlog.mjs build`; publish to GitHub with `node scripts/backlog.mjs sync --apply`.',
  );
  out.push('');
  out.push(
    `**${tickets.length} tickets** · ${withIssue} linked to GitHub issues · ` +
      `${tickets.reduce((n, t) => n + Number(t.meta.estimate_hours || 0), 0)} estimated engineer-hours.`,
  );
  out.push('');
  out.push('## At a glance');
  out.push('');
  out.push('| Phase | Track | Ticket | Estimate | Priority | Depends on | Issue |');
  out.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const t of tickets) {
    const phase = PHASE_META[t.meta.phase];
    const track = TRACK_META[t.meta.track] ?? { label: t.meta.track, emoji: '•' };
    const issue = t.meta.github_issue ? `[#${t.meta.github_issue}](https://github.com/${repoSlug()}/issues/${t.meta.github_issue})` : '—';
    const deps = t.meta.blocked_by.length ? t.meta.blocked_by.map((d) => `\`${d}\``).join(', ') : '—';
    out.push(
      `| ${phase.key} | ${track.emoji} ${track.label} | **[\`${t.meta.id}\`](tickets/${t.meta.id}.md)** ${escapePipes(t.meta.title)} | ${t.meta.estimate_hours}h | ${t.meta.priority} | ${deps} | ${issue} |`,
    );
  }
  out.push('');
  out.push('## Execution summary');
  out.push('');
  out.push('```text');
  out.push('PHASE 0 (sequential, blocks everything)');
  out.push('  P0-1 → P0-2 ─────────────────────────────► protocol frozen');
  out.push('');
  out.push('PHASE 1 (5 tracks in parallel, independent branches)');
  out.push('  Track A  A-1 → A-2 → A-3        DOM distiller');
  out.push('  Track B  B-1 ─┬→ B-3            action executor');
  out.push('               B-2 ┘');
  out.push('  Track C  C-1 → C-2              LLM brain');
  out.push('           C-3 (edge proxy, parallel)');
  out.push('  Track D  D-1 → D-2              audio & STT');
  out.push('  Track E  E-1 → E-2              HUD & badges');
  out.push('  QA       QA-1 (starts on day 1) testbed');
  out.push('');
  out.push('PHASE 2 (sequential integration)');
  out.push('  INT-1 → INT-2');
  out.push('');
  out.push('PHASE 3 (verification)');
  out.push('  QA-1 acceptance: 5 hostile forms, 100% voice');
  out.push('```');
  out.push('');
  for (const phase of Object.values(PHASE_META)) {
    const inPhase = tickets.filter((t) => PHASE_META[t.meta.phase].key === phase.key);
    if (!inPhase.length) continue;
    out.push(`## ${phase.title}`);
    out.push('');
    out.push(`_${phase.desc}_`);
    out.push('');
    out.push('| Ticket | Title | Type | Est. | Owner | Parallel |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const t of inPhase) {
      out.push(
        `| [\`${t.meta.id}\`](tickets/${t.meta.id}.md) | ${escapePipes(t.meta.title)} | ${t.meta.type} | ${t.meta.estimate_hours}h | ${t.meta.owner_role} | ${t.meta.parallel_safe ? '✅' : '—'} |`,
      );
    }
    out.push('');
  }
  out.push('## Conventions');
  out.push('');
  out.push('- Branch per ticket: `feat/<ticket-id>-<slug>` (e.g. `feat/b-1-value-injector`). PR title: `[B-1] Value injector`.');
  out.push('- Every ticket is **agent-ready**: exact algorithms, acceptance criteria, test plan, non-goals.');
  out.push('- Definition of Ready: dependencies merged, protocol contract unchanged, fixtures exist.');
  out.push('- Definition of Done: acceptance criteria checked + tests green + docs updated + issue closed by the PR (`Closes #N`).');
  out.push('- Cross-track changes to `@vfe/protocol` are **additive only** (see `docs/architecture.md` → ADR-010).');
  out.push('');
  return out.join('\n');
}

function escapePipes(s) {
  return String(s).replace(/\|/g, '\\|');
}

// ---------------------------------------------------------------- github

const warnings = [];

function gh(args, { json = false, input, allowFail = false } = {}) {
  try {
    const res = execFileSync('gh', args, {
      cwd: ROOT,
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    if (!json) return res;
    return res.trim() ? JSON.parse(res) : null;
  } catch (e) {
    if (!allowFail) throw e;
    const msg = String(e.stderr ?? e.message ?? '').trim().split('\n')[0];
    return { __error: msg };
  }
}

function warn(msg) {
  if (!warnings.includes(msg)) {
    warnings.push(msg);
    console.warn(`  ! ${msg}`);
  }
}

function ensureLabel(name) {
  const color = LABEL_COLORS[name] ?? 'ededed';
  const res = gh(['label', 'create', name, '--color', color, '--force'], { allowFail: true });
  if (res && res.__error) {
    warn(`cannot create label "${name}" (${res.__error}) — token lacks permission; metadata stays in issue bodies`);
    return 'failed';
  }
  return 'created';
}

function ensureMilestone(title, description) {
  const list = gh(['api', `repos/${repoSlug()}/milestones?state=all&per_page=100`, '--paginate'], {
    json: true,
    allowFail: true,
  });
  if (list?.__error) {
    warn(`cannot list milestones (${list.__error}) — continuing without milestones`);
    return null;
  }
  const found = (list ?? []).find((m) => m.title === title);
  if (found) return found.number;
  const created = gh(
    ['api', `repos/${repoSlug()}/milestones`, '-f', `title=${title}`, '-f', `description=${description}`, '-f', 'state=open'],
    { json: true, allowFail: true },
  );
  if (created?.__error) {
    warn(`cannot create milestone "${title}" (${created.__error}) — continuing without milestones`);
    return null;
  }
  return created.number;
}

function existingIssues() {
  const res = gh(
    ['api', `repos/${repoSlug()}/issues?state=all&per_page=100`, '-H', 'Accept: application/vnd.github+json'],
    { json: true, allowFail: true },
  );
  if (res?.__error) {
    warn(`cannot list issues (${res.__error})`);
    return [];
  }
  return res ?? [];
}

function createOrUpdateIssue(t, body, labels, milestoneNumber, knownIssues) {
  const title = issueTitle(t);
  const found = knownIssues.find((i) => !i.pull_request && i.title === title);
  if (found) {
    const payload = JSON.stringify({
      body,
      ...(labels.length ? { labels } : {}),
      ...(milestoneNumber ? { milestone: milestoneNumber } : {}),
    });
    const res = gh(['api', '--method', 'PATCH', `repos/${repoSlug()}/issues/${found.number}`, '--input', '-'], {
      json: true,
      input: payload,
      allowFail: true,
    });
    if (res?.__error) {
      warn(
        'token cannot update existing issues (403) — issue bodies are not refreshed, only missing issues are created',
      );
      return { number: found.number, action: 'unchanged' };
    }
    return { number: found.number, action: 'updated' };
  }
  const payload = JSON.stringify({
    title,
    body,
    ...(labels.length ? { labels } : {}),
    ...(milestoneNumber ? { milestone: milestoneNumber } : {}),
  });
  const created = gh(['api', '--method', 'POST', `repos/${repoSlug()}/issues`, '--input', '-'], {
    json: true,
    input: payload,
    allowFail: true,
  });
  if (created?.__error) throw new Error(`cannot create issue ${title}: ${created.__error}`);
  knownIssues.push({ number: created.number, title });
  return { number: created.number, action: 'created' };
}

function writeBack(t, number) {
  const path = join(TICKET_DIR, t.file);
  let raw = readFileSync(path, 'utf8');
  const line = `github_issue: ${number}`;
  if (/^github_issue:.*$/m.test(raw)) {
    raw = raw.replace(/^github_issue:.*$/m, line);
  } else {
    raw = raw.replace(/^---\n/, `---\n${line}\n`);
  }
  writeFileSync(path, raw);
  t.meta.github_issue = number;
}

// ---------------------------------------------------------------- commands

function cmdBuild() {
  const tickets = loadTickets();
  mkdirSync(ISSUE_DIR, { recursive: true });
  writeFileSync(BACKLOG_MD, buildIndex(tickets) + '\n');
  for (const t of tickets) {
    writeFileSync(join(ISSUE_DIR, `${t.meta.id}.md`), issueBody(t, tickets) + '\n');
  }
  console.log(`BACKLOG.md written (${tickets.length} tickets) + docs/backlog/issues/*.md`);
}

function cmdSync({ apply }) {
  const tickets = topoSort(loadTickets());
  const slug = repoSlug();
  console.log(`${apply ? 'SYNC' : 'DRY RUN'} against ${slug} — ${tickets.length} tickets\n`);

  if (!apply) {
    for (const t of tickets) {
      console.log(
        `[${t.meta.id}] #? ${issueTitle(t)}\n      labels: ${t.meta.labels.join(', ')}\n      milestone: ${PHASE_META[t.meta.phase].title}\n      blocked_by: ${t.meta.blocked_by.join(', ') || '—'}`,
      );
    }
    console.log('\nRun with --apply to create/update labels, milestones and issues.');
    return;
  }

  // 1. labels
  const allLabels = new Set(['backlog']);
  for (const t of tickets) for (const l of t.meta.labels) allLabels.add(l);
  let labelsOk = true;
  for (const l of allLabels) {
    const r = ensureLabel(l);
    if (r === 'created') console.log(`label  + ${l}`);
    if (r === 'failed') labelsOk = false;
  }
  if (!labelsOk) console.log('labels: SKIPPED (token cannot manage labels)');

  // 2. milestones
  const milestones = new Map();
  for (const phase of Object.values(PHASE_META)) {
    const n = ensureMilestone(phase.title, phase.desc);
    milestones.set(phase.key, n);
    if (n) console.log(`milestone ${phase.title} → #${n}`);
  }
  if ([...milestones.values()].every((v) => v === null)) console.log('milestones: SKIPPED (token cannot manage milestones)');

  // 3. issues (topological order so dependencies already have numbers)
  const known = existingIssues();
  for (const t of tickets) {
    const body = issueBody(t, tickets);
    const labels = [...new Set([...t.meta.labels, 'backlog'])];
    const ms = milestones.get(PHASE_META[t.meta.phase].key);
    const { number, action } = createOrUpdateIssue(t, body, labels, ms, known);
    writeBack(t, number);
    console.log(`issue  ${action === 'created' ? '+' : '~'} #${number} [${t.meta.id}]`);
  }

  writeFileSync(BACKLOG_MD, buildIndex(loadTickets()) + '\n');
  console.log('\nBACKLOG.md regenerated with issue links.');
}

const [, , cmd, ...rest] = process.argv;
if (cmd === 'build') cmdBuild();
else if (cmd === 'sync') cmdSync({ apply: rest.includes('--apply') });
else {
  console.log('usage: node scripts/backlog.mjs <build|sync> [--apply|--dry-run]');
  process.exit(1);
}
