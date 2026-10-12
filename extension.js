'use strict';
const vscode = require('vscode');
const { collect } = require('./collector');

let panel, statusItem, timer, last, busy = false;

const cfg = () => vscode.workspace.getConfiguration('clusterMonitor');

async function refresh() {
  if (busy) return;
  busy = true;
  try {
    last = await collect({
      partitions: cfg().get('partitions'),
      recentHours: cfg().get('recentHours'),
    });
    updateStatus(last);
    if (panel) panel.webview.postMessage({ type: 'data', data: last });
  } catch (e) {
    statusItem.text = '$(warning) Slurm';
    statusItem.tooltip = String(e);
  } finally {
    busy = false;
  }
}

function updateStatus(d) {
  const run = d.jobs.filter((j) => j.state === 'RUNNING').length;
  const pend = d.jobs.filter((j) => j.state === 'PENDING').length;
  const gpu = d.partitions.find((p) => p.gpuTot > 0);
  const free = gpu ? gpu.gpuTot - gpu.gpuAlloc : null;
  statusItem.text = `$(server) R${run} PD${pend}` + (free !== null ? ` · ${free} GPU free` : '');
  statusItem.tooltip = `Slurm: ${run} running, ${pend} pending (${d.user}). Click to open Cluster Monitor.`;
}

function openPanel(context) {
  if (panel) { panel.reveal(); return; }
  panel = vscode.window.createWebviewPanel('clusterMonitor', 'Cluster Monitor',
    vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = html();
  panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
  panel.webview.onDidReceiveMessage((m) => { if (m.type === 'ready' && last) panel.webview.postMessage({ type: 'data', data: last }); });
  refresh();
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(refresh, Math.max(10, cfg().get('refreshSeconds')) * 1000);
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = 'clusterMonitor.open';
  statusItem.text = '$(server) Slurm…';
  statusItem.show();
  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('clusterMonitor.open', () => openPanel(context)),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('clusterMonitor')) { schedule(); refresh(); } }),
    { dispose: () => clearInterval(timer) },
  );
  schedule();
  refresh();
}

function deactivate() { clearInterval(timer); }

function html() {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 16px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; opacity: .7; margin: 22px 0 8px; }
  .meta { opacity: .6; font-size: 12px; }
  .err { color: var(--vscode-errorForeground); font-size: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 3px 10px 3px 0; white-space: nowrap; }
  th { opacity: .6; font-weight: normal; border-bottom: 1px solid var(--vscode-panel-border); }
  td.name { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
  .bar { position: relative; height: 14px; width: 220px; background: var(--vscode-input-background); border-radius: 3px; overflow: hidden; }
  .bar > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--vscode-charts-blue); }
  .bar.hot > i { background: var(--vscode-charts-orange); }
  .bar.full > i { background: var(--vscode-charts-red); }
  .row { display: flex; align-items: center; gap: 10px; margin: 4px 0; font-size: 12px; }
  .row .lbl { width: 130px; } .row .val { opacity: .8; }
  .seg { display: flex; height: 10px; width: 220px; border-radius: 3px; overflow: hidden; background: var(--vscode-input-background); }
  .seg > i { display: block; height: 100%; }
  .RUNNING, .COMPLETED { color: var(--vscode-charts-green); }
  .PENDING { color: var(--vscode-charts-yellow); }
  .FAILED, .TIMEOUT, .OUT_OF_MEMORY, .NODE_FAIL { color: var(--vscode-errorForeground); }
  .CANCELLED { opacity: .6; }
</style></head><body>
<div class="meta" id="meta">loading…</div><div class="err" id="err"></div>
<h2>Cluster load</h2><div id="load"></div>
<h2>My jobs</h2><div id="jobs"></div>
<h2>Pending priority breakdown</h2><div id="prio"></div>
<h2>Fair-share (accounts)</h2><div id="fs"></div>
<h2>Recently finished</h2><div id="hist"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const cls = (p) => (p >= 95 ? 'full' : p >= 80 ? 'hot' : '');
const bar = (a, b) => { const p = pct(a, b); return '<div class="bar ' + cls(p) + '"><i style="width:' + p + '%"></i></div>'; };
const table = (head, rows) => rows.length
  ? '<table><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr>' + rows.join('') + '</table>'
  : '<div class="meta">none</div>';

function render(d) {
  $('meta').textContent = 'user ' + d.user + ' · updated ' + new Date(d.time).toLocaleTimeString();
  $('err').textContent = d.errors.join(' | ');

  $('load').innerHTML = d.partitions.map((p) => {
    const res = (p.nodesUnavail ? ' · ' + p.nodesUnavail + ' nodes unavailable' : '');
    let h = '<div style="margin-bottom:10px"><b>' + esc(p.name) + '</b> <span class="meta">' + p.nodes + ' nodes' + res + ' · ' + p.pending + ' pending jobs</span>';
    h += '<div class="row"><span class="lbl">CPU</span>' + bar(p.cpuAlloc, p.cpuTot) + '<span class="val">' + p.cpuAlloc + ' / ' + p.cpuTot + ' (' + pct(p.cpuAlloc, p.cpuTot) + '%)</span></div>';
    if (p.gpuTot) h += '<div class="row"><span class="lbl">GPU</span>' + bar(p.gpuAlloc, p.gpuTot) + '<span class="val">' + p.gpuAlloc + ' / ' + p.gpuTot + ' (' + pct(p.gpuAlloc, p.gpuTot) + '%) · ' + (p.gpuTot - p.gpuAlloc) + ' free</span></div>';
    return h + '</div>';
  }).join('') || '<div class="meta">no partitions</div>';

  $('jobs').innerHTML = table(['ID', 'Name', 'Part', 'State', 'Elapsed / Limit', 'CPU', 'GPU', 'Node / Reason', 'Priority', 'Queue pos'],
    d.jobs.map((j) => '<tr><td>' + esc(j.id) + '</td><td class="name" title="' + esc(j.name) + '">' + esc(j.name) + '</td><td>' + esc(j.partition) +
      '</td><td class="' + esc(j.state) + '">' + esc(j.state) + '</td><td>' + esc(j.elapsed) + ' / ' + esc(j.limit) + '</td><td>' + j.cpus +
      '</td><td>' + esc(j.gres.replace('gpu:', '')) + '</td><td>' + esc(j.reason) + '</td><td>' + j.priority + '</td><td>' +
      (j.state !== 'PENDING' ? '' : j.rank ? '#' + j.rank + ' of ' + j.queueSize : 'held') + '</td></tr>'));

  const pend = d.jobs.filter((j) => j.state === 'PENDING' && j.prio);
  const colors = { age: 'var(--vscode-charts-blue)', fairshare: 'var(--vscode-charts-green)', jobsize: 'var(--vscode-charts-purple)', partition: 'var(--vscode-charts-orange)', qos: 'var(--vscode-charts-yellow)' };
  $('prio').innerHTML = pend.length
    ? '<div class="meta" style="margin-bottom:6px">' + Object.keys(colors).map((k) => '<span style="color:' + colors[k] + '">■</span> ' + k).join(' &nbsp; ') + '</div>' +
      pend.map((j) => {
        const tot = Object.keys(colors).reduce((s, k) => s + j.prio[k], 0) || 1;
        return '<div class="row"><span class="lbl">' + esc(j.id) + '</span><div class="seg">' +
          Object.keys(colors).map((k) => '<i title="' + k + ' ' + j.prio[k] + '" style="width:' + (100 * j.prio[k] / tot) + '%;background:' + colors[k] + '"></i>').join('') +
          '</div><span class="val">total ' + j.prio.total + ' · age ' + j.prio.age + ' · fairshare ' + j.prio.fairshare + ' · size ' + j.prio.jobsize + ' · part ' + j.prio.partition + ' · qos ' + j.prio.qos + '</span></div>';
      }).join('')
    : '<div class="meta">no schedulable pending jobs (dependency-held jobs have no priority breakdown)</div>';

  $('fs').innerHTML = table(['Account', 'FairShare', 'NormShares', 'EffectvUsage'],
    d.fairshare.map((f) => '<tr><td>' + esc(f.account) + '</td><td>' + f.fairshare.toFixed(3) + '</td><td>' + f.normShares.toFixed(3) + '</td><td>' + f.usage.toFixed(3) + '</td></tr>'));

  $('hist').innerHTML = table(['ID', 'Name', 'Part', 'State', 'Elapsed', 'Ended', 'Exit'],
    d.history.map((h) => '<tr><td>' + esc(h.id) + '</td><td class="name" title="' + esc(h.name) + '">' + esc(h.name) + '</td><td>' + esc(h.partition) +
      '</td><td class="' + esc(h.state.split(' ')[0]) + '">' + esc(h.state) + '</td><td>' + esc(h.elapsed) + '</td><td>' + esc(h.end.replace('T', ' ')) + '</td><td>' + esc(h.exit) + '</td></tr>'));
}

window.addEventListener('message', (e) => { if (e.data.type === 'data') render(e.data.data); });
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}

module.exports = { activate, deactivate };
