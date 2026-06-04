export default async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');

    const nickname = request.query.nick;
    const theme = request.query.theme || 'dark';
    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    if (!nickname) {
        response.status(400).send('Missing nick query parameter');
        return;
    }

    try {
        const protocol = request.headers['x-forwarded-proto'] || 'https';
        const host = request.headers.host;
        const apiUrl = `${protocol}://${host}/api/faceit?nick=${encodeURIComponent(nickname)}&full&compact`;
        const apiResponse = await fetch(apiUrl);

        if (!apiResponse.ok) {
            response.status(apiResponse.status).send('Failed to load FACEIT data');
            return;
        }

        const data = await apiResponse.json();
        const api = data.api;
        const player = data.player_info || {};
        const isLight = theme === 'light';
        const avatar = player.avatar || '';
        const today = api.today || {};
        const nextLevel = escapeHtml(api.presets?.next_level || '');
        const mapPick = escapeHtml(api.presets?.map_pick || '');
        const lastMatch = escapeHtml(api.last_match || 'No last match data');
        const safeNickname = escapeHtml(data.nickname);
        const safeTrend = escapeHtml(api.trend || 'N/A');
        const safeRegion = escapeHtml(data.faceit_stats?.region || '');
        const safeTodayElo = escapeHtml(today.elo || '0');

        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="120" />
  <title>FACEIT Widget</title>
  <style>
    :root {
      color-scheme: ${isLight ? 'light' : 'dark'};
      --bg: ${isLight ? 'rgba(245,247,250,.92)' : 'rgba(13,17,23,.88)'};
      --panel: ${isLight ? 'rgba(255,255,255,.72)' : 'rgba(22,27,34,.72)'};
      --text: ${isLight ? '#111827' : '#f5f7fb'};
      --muted: ${isLight ? '#5b6472' : '#9aa4b2'};
      --line: ${isLight ? 'rgba(17,24,39,.14)' : 'rgba(255,255,255,.12)'};
      --accent: #ff6a00;
      --good: #34d399;
      --bad: #fb7185;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; background: transparent; font-family: Inter, Segoe UI, Arial, sans-serif; }
    .widget {
      width: min(720px, 100vw);
      min-height: 132px;
      color: var(--text);
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      backdrop-filter: blur(10px);
      box-shadow: 0 18px 42px rgba(0,0,0,.28);
    }
    .top {
      display: grid;
      grid-template-columns: 72px 1fr auto;
      gap: 14px;
      align-items: center;
      padding: 14px;
      border-bottom: 1px solid var(--line);
    }
    .avatar {
      width: 72px;
      height: 72px;
      border-radius: 8px;
      object-fit: cover;
      background: var(--panel);
    }
    .name {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .nick {
      font-size: 24px;
      font-weight: 800;
      line-height: 1.05;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .level {
      flex: 0 0 auto;
      padding: 5px 8px;
      border-radius: 6px;
      background: var(--accent);
      color: white;
      font-weight: 800;
      font-size: 13px;
    }
    .sub {
      margin-top: 7px;
      color: var(--muted);
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .elo {
      text-align: right;
      font-size: 30px;
      font-weight: 900;
      line-height: 1;
    }
    .toprank {
      margin-top: 7px;
      color: var(--muted);
      font-size: 13px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      background: var(--line);
    }
    .cell {
      min-width: 0;
      background: var(--panel);
      padding: 10px 12px;
    }
    .label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .value {
      margin-top: 5px;
      font-size: 14px;
      font-weight: 800;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .good { color: var(--good); }
    .bad { color: var(--bad); }
    @media (max-width: 520px) {
      .top { grid-template-columns: 52px 1fr; }
      .avatar { width: 52px; height: 52px; }
      .elo { grid-column: 1 / -1; text-align: left; font-size: 24px; }
      .grid { grid-template-columns: repeat(2, 1fr); }
      .nick { font-size: 20px; }
    }
  </style>
</head>
<body>
  <main class="widget">
    <section class="top">
      <img class="avatar" src="${avatar}" alt="" />
      <div>
        <div class="name">
        <div class="nick">${safeNickname}</div>
          <div class="level">LVL ${api.lvl}</div>
        </div>
        <div class="sub">${nextLevel}</div>
      </div>
      <div>
        <div class="elo">${api.elo}</div>
        <div class="toprank">#${api.top || 'N/A'} ${safeRegion}</div>
      </div>
    </section>
    <section class="grid">
      <div class="cell">
        <div class="label">Today</div>
        <div class="value ${String(today.elo || '').startsWith('-') ? 'bad' : 'good'}">${today.win || 0}W/${today.lose || 0}L ${safeTodayElo}</div>
      </div>
      <div class="cell">
        <div class="label">Trend</div>
        <div class="value">${safeTrend}</div>
      </div>
      <div class="cell">
        <div class="label">Map Pick</div>
        <div class="value">${mapPick}</div>
      </div>
      <div class="cell">
        <div class="label">Last Match</div>
        <div class="value">${lastMatch}</div>
      </div>
    </section>
  </main>
</body>
</html>`);
    } catch (error) {
        response.status(500).send(`Widget error: ${error.message}`);
    }
}
