'use strict';
// Read-only Slurm collector. No VSCode dependency: `node collector.js` prints a JSON snapshot.
const { execFile } = require('child_process');

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) resolve({ ok: false, error: `${cmd}: ${err.message.split('\n')[0]}`, out: '' });
      else resolve({ ok: true, out: stdout });
    });
  });
}

const lines = (s) => s.split('\n').filter(Boolean);
const num = (x) => (x === undefined || x === '' || isNaN(+x) ? 0 : +x);

// "cpu=288,mem=488000M,gres/gpu=4" -> gpu count
const tresGpu = (t) => num((/gres\/gpu=(\d+)/.exec(t || '') || [])[1]);

const UNAVAILABLE = /DOWN|DRAIN|FAIL|MAINT|RESERVED|NOT_RESPONDING|INVAL|POWER/;
const NOT_ELIGIBLE = /Dependency|Held|BeginTime|Reservation|launch failed/i;

function parseNodes(out) {
  return lines(out).map((l) => {
    const kv = {};
    for (const m of l.matchAll(/(\w+)=(\S*)/g)) if (!(m[1] in kv)) kv[m[1]] = m[2];
    return {
      name: kv.NodeName,
      state: kv.State || '',
      partitions: (kv.Partitions || '').split(',').filter(Boolean),
      cpuAlloc: num(kv.CPUAlloc),
      cpuTot: num(kv.CPUTot),
      gpuTot: tresGpu(kv.CfgTRES),
      gpuAlloc: tresGpu(kv.AllocTRES),
    };
  });
}

function aggregatePartitions(nodes, wanted) {
  const parts = {};
  for (const n of nodes) {
    for (const p of n.partitions) {
      if (wanted.length && !wanted.includes(p)) continue;
      const a = (parts[p] ||= { name: p, nodes: 0, nodesUnavail: 0, cpuAlloc: 0, cpuTot: 0, gpuAlloc: 0, gpuTot: 0, pending: 0 });
      a.nodes++;
      if (UNAVAILABLE.test(n.state)) { a.nodesUnavail++; continue; }
      a.cpuAlloc += n.cpuAlloc; a.cpuTot += n.cpuTot;
      a.gpuAlloc += n.gpuAlloc; a.gpuTot += n.gpuTot;
    }
  }
  return parts;
}

async function collect({ partitions = [], recentHours = 24, user = process.env.USER } = {}) {
  const [nodesR, pendR, mineR, prioR, shareR, histR] = await Promise.all([
    run('scontrol', ['show', 'node', '-o']),
    run('squeue', ['-h', '-t', 'PD', '-o', '%i|%P|%u|%Q|%r']),
    run('squeue', ['-h', '--me', '-o', '%i|%j|%P|%T|%M|%l|%D|%C|%b|%R|%V|%Q']),
    run('sprio', ['-h', '-u', user, '-o', '%i|%Y|%A|%F|%J|%P|%Q']),
    run('sshare', ['-U', '-h', '-P', '-u', user, '-o', 'Account,FairShare,NormShares,EffectvUsage']),
    run('sacct', ['-u', user, '-S', `now-${recentHours}hours`, '-X', '-n', '-P',
      '-o', 'JobID,JobName,Partition,State,Elapsed,End,ExitCode']),
  ]);
  const errors = [nodesR, pendR, mineR, prioR, shareR, histR].filter((r) => !r.ok).map((r) => r.error);

  const parts = aggregatePartitions(parseNodes(nodesR.out), partitions);

  const pending = lines(pendR.out).map((l) => {
    const [id, part, u, prio, reason] = l.split('|');
    return { id, parts: part.split(','), user: u, prio: num(prio), reason };
  });
  for (const j of pending) for (const p of j.parts) if (parts[p]) parts[p].pending++;

  const prio = {};
  for (const l of lines(prioR.out)) {
    const [id, total, age, fair, size, part, qos] = l.split('|').map((s) => s.trim());
    prio[id] = { total: num(total), age: num(age), fairshare: num(fair), jobsize: num(size), partition: num(part), qos: num(qos) };
  }

  const jobs = lines(mineR.out).map((l) => {
    const [id, name, part, state, elapsed, limit, nodes, cpus, gres, reason, submit, p] = l.split('|');
    const j = { id, name, partition: part, state, elapsed, limit, nodes: num(nodes), cpus: num(cpus),
      gres: gres.replace('gres/', ''), reason, submit, priority: num(p) };
    if (state === 'PENDING') {
      j.prio = prio[id] || null;
      const myParts = part.split(',');
      const queue = pending.filter((q) => q.parts.some((x) => myParts.includes(x)) && !NOT_ELIGIBLE.test(q.reason));
      j.eligible = !NOT_ELIGIBLE.test(reason);
      j.queueSize = queue.length;
      j.rank = j.eligible ? queue.filter((q) => q.prio > j.priority).length + 1 : null;
    }
    return j;
  });

  const fairshare = lines(shareR.out).map((l) => {
    const [account, fs, norm, usage] = l.split('|');
    return { account, fairshare: num(fs), normShares: num(norm), usage: num(usage) };
  });

  const history = lines(histR.out).map((l) => {
    const [id, name, part, state, elapsed, end, exit] = l.split('|');
    return { id, name, partition: part, state, elapsed, end, exit };
  }).filter((h) => !/^(RUNNING|PENDING)/.test(h.state)).reverse().slice(0, 15);

  return { time: new Date().toISOString(), user, partitions: Object.values(parts), jobs, fairshare, history, errors };
}

module.exports = { collect };

if (require.main === module) {
  collect().then((d) => console.log(JSON.stringify(d, null, 2)));
}
