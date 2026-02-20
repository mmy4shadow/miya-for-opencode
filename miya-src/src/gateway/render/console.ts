export function renderConsoleHtml(snapshot: unknown): string {
  const payload = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miya Gateway React</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #0f172a; color: #e2e8f0; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 16px; }
    .row { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); margin-bottom: 12px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; }
    .title { color: #93c5fd; font-size: 12px; text-transform: uppercase; }
    .value { font-size: 20px; font-weight: 700; margin-top: 6px; }
    .ok { color: #4ade80; }
    .bad { color: #f87171; }
    textarea { width: 100%; min-height: 220px; resize: vertical; background: #020617; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 8px; font-family: Consolas, monospace; }
    button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .line { margin: 6px 0; color: #cbd5e1; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h2>Miya Gateway</h2>
    <div id="daemonStatus" class="line">loading...</div>
    <div class="row">
      <div class="card">
        <div class="title">Daemon CPU/VRAM/Uptime</div>
        <div id="daemonStats" class="value">--</div>
        <div id="daemonJob" class="line">Active Job: --</div>
      </div>
      <div class="card">
        <div class="title">Sessions</div>
        <div id="sessionsValue" class="value">0/0</div>
      </div>
      <div class="card">
        <div class="title">Jobs</div>
        <div id="jobsValue" class="value">0/0</div>
      </div>
      <div class="card">
        <div class="title">Autoflow</div>
        <div id="autoflowValue" class="value">0 active</div>
        <div id="autoflowPhase" class="line">phase: --</div>
      </div>
      <div class="card">
        <div class="title">Routing Cost</div>
        <div id="routingValue" class="value">--</div>
        <div id="routingStage" class="line">stage: --</div>
      </div>
      <div class="card">
        <div class="title">Learning HitRate</div>
        <div id="learningValue" class="value">--</div>
        <div id="learningDrafts" class="line">drafts: --</div>
      </div>
      <div class="card">
        <div class="title">Policy Hash</div>
        <div id="policyHash" class="line">--</div>
      </div>
    </div>
    <div class="card">
      <div class="title">Configuration Center (read/write .opencode/miya/config.json)</div>
      <div class="line">Patch JSON format: { set: {"ui.language":"zh-CN"}, unset: [] }</div>
      <textarea id="patchText">{"set":{},"unset":[]}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
        <button id="saveButton">保存配置</button>
        <span id="saveState" class="line">idle</span>
      </div>
      <pre id="configJson" class="line" style="white-space:pre-wrap;max-height:220px;overflow:auto"></pre>
    </div>
  </div>
  <script>window.__MIYA_SNAPSHOT__ = ${payload};</script>
  <script>
    (function () {
      let state = window.__MIYA_SNAPSHOT__ || {};
      const patchInput = document.getElementById('patchText');
      const saveButton = document.getElementById('saveButton');
      const saveState = document.getElementById('saveState');
      const daemonStatus = document.getElementById('daemonStatus');
      const daemonStats = document.getElementById('daemonStats');
      const daemonJob = document.getElementById('daemonJob');
      const sessionsValue = document.getElementById('sessionsValue');
      const jobsValue = document.getElementById('jobsValue');
      const autoflowValue = document.getElementById('autoflowValue');
      const autoflowPhase = document.getElementById('autoflowPhase');
      const routingValue = document.getElementById('routingValue');
      const routingStage = document.getElementById('routingStage');
      const learningValue = document.getElementById('learningValue');
      const learningDrafts = document.getElementById('learningDrafts');
      const policyHash = document.getElementById('policyHash');
      const configJson = document.getElementById('configJson');

      let ws = null;
      let reqID = 1;
      const pending = new Map();

      function updateSave(value) {
        saveState.textContent = value;
        saveButton.disabled = value === 'saving';
      }

      function render(next) {
        state = next || {};
        const daemonOk = Boolean(state.daemon && state.daemon.connected);
        const label = daemonOk
          ? 'Miya Daemon Connected'
          : ((state.daemon && state.daemon.statusText) || 'Miya Daemon Disconnected');
        daemonStatus.textContent = label;
        daemonStatus.className = 'line ' + (daemonOk ? 'ok' : 'bad');

        const cpu =
          state.daemon && typeof state.daemon.cpuPercent === 'number'
            ? state.daemon.cpuPercent.toFixed(1) + '%'
            : '--';
        const vramUsed =
          state.daemon && typeof state.daemon.vramUsedMB === 'number' ? state.daemon.vramUsedMB : '--';
        const vramTotal =
          state.daemon && typeof state.daemon.vramTotalMB === 'number' ? state.daemon.vramTotalMB : '--';
        const uptime =
          state.daemon && typeof state.daemon.uptimeSec === 'number' ? state.daemon.uptimeSec + 's' : '--';
        daemonStats.textContent = cpu + ' | ' + vramUsed + '/' + vramTotal + ' MB | ' + uptime;

        const jobID = state.daemon && state.daemon.activeJobID ? state.daemon.activeJobID : '--';
        const jobProgress =
          state.daemon && typeof state.daemon.activeJobProgress === 'number'
            ? state.daemon.activeJobProgress + '%'
            : '--';
        daemonJob.textContent = 'Active Job: ' + jobID + ' | ' + jobProgress;

        sessionsValue.textContent =
          String((state.sessions && state.sessions.active) || 0) +
          '/' +
          String((state.sessions && state.sessions.total) || 0);
        jobsValue.textContent =
          String((state.jobs && state.jobs.enabled) || 0) +
          '/' +
          String((state.jobs && state.jobs.total) || 0);
        const activeAutoflow = (state.autoflow && state.autoflow.active) || 0;
        autoflowValue.textContent = String(activeAutoflow) + ' active';
        const firstAutoflow = state.autoflow && state.autoflow.sessions && state.autoflow.sessions[0];
        autoflowPhase.textContent =
          'phase: ' + (firstAutoflow && firstAutoflow.phase ? firstAutoflow.phase : '--');
        const routingCost =
          state.routing && state.routing.cost ? state.routing.cost : null;
        if (routingCost) {
          routingValue.textContent =
            String(routingCost.totalTokensEstimate || 0) +
            ' tk | save ' +
            String(routingCost.savingsPercentEstimate || 0) +
            '%';
        } else {
          routingValue.textContent = '--';
        }
        routingStage.textContent =
          'stage: ' + ((state.routing && state.routing.forcedStage) || (state.routing && state.routing.ecoMode ? 'eco' : 'auto') || '--');
        const learningStats =
          state.learning && state.learning.stats ? state.learning.stats : null;
        if (learningStats) {
          learningValue.textContent =
            (Number(learningStats.hitRate || 0) * 100).toFixed(1) + '%';
          learningDrafts.textContent =
            'drafts: ' + String(learningStats.total || 0) + ' | uses: ' + String(learningStats.totalUses || 0);
        } else {
          learningValue.textContent = '--';
          learningDrafts.textContent = 'drafts: --';
        }
        policyHash.textContent = state.policyHash || '--';
        configJson.textContent = JSON.stringify(state.configCenter || {}, null, 2);
      }

      function sendReq(method, params) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return Promise.reject(new Error('ws_not_open'));
        }
        const id = 'r-' + reqID++;
        ws.send(JSON.stringify({ type: 'request', id, method, params }));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('request_timeout'));
          }, 8000);
          pending.set(id, { resolve, reject, timer });
        });
      }

      async function loadStatus() {
        try {
          const res = await fetch('/api/status', { cache: 'no-store' });
          const data = await res.json();
          render(data);
        } catch {}
      }

      function openWs() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const token =
          new URLSearchParams(location.search).get('token') ||
          localStorage.getItem('miya_gateway_token') ||
          '';
        if (token) localStorage.setItem('miya_gateway_token', token);

        ws = new WebSocket(proto + '://' + location.host + '/ws');
        ws.onopen = function () {
          ws.send(
            JSON.stringify({
              type: 'hello',
              role: 'ui',
              protocolVersion: '1.0',
              auth: token ? { token } : undefined,
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'request',
              id: 'sub',
              method: 'gateway.subscribe',
              params: { events: ['*'] },
            }),
          );
        };
        ws.onmessage = function (evt) {
          try {
            const frame = JSON.parse(evt.data);
            if (frame.type === 'event' && frame.event === 'gateway.snapshot') {
              render(frame.payload);
              return;
            }
            if (frame.type === 'response') {
              const entry = pending.get(frame.id);
              if (!entry) return;
              pending.delete(frame.id);
              clearTimeout(entry.timer);
              if (frame.ok) entry.resolve(frame.result);
              else entry.reject(new Error((frame.error && frame.error.message) || 'request_failed'));
            }
          } catch {}
        };
        ws.onclose = function () {
          for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new Error('ws_closed'));
          }
          pending.clear();
        };
      }

      saveButton.addEventListener('click', async function () {
        updateSave('saving');
        try {
          const patch = JSON.parse(patchInput.value || '{}');
          await sendReq('config.center.patch', { patch, policyHash: state ? state.policyHash : undefined });
          updateSave('ok');
        } catch (err) {
          updateSave('error:' + String((err && err.message) || err));
        }
      });

      render(state);
      loadStatus();
      setInterval(loadStatus, 3000);
      openWs();
    })();
  </script>
</body>
</html>`;
}
