const DEFAULT_REFRESH_SECONDS = 120;
const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttr = escapeHtml;

const asNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const signedClass = (value) => {
    const parsed = parseInt(String(value ?? '0').replace(/[^\d-]/g, ''), 10);
    if (parsed > 0) return 'win';
    if (parsed < 0) return 'loss';
    return 'muted';
};

const shortText = (value, fallback = 'N/A') => {
    const text = String(value ?? '').trim();
    return text || fallback;
};

const stripWidgetPrefixes = (value) => shortText(value)
    .replace(/^BEST TODAY:\s*/i, '')
    .replace(/^PEAK TODAY:\s*/i, '')
    .replace(/^TODAY:\s*/i, '');

const getLevelBadge = (level, top) => {
    const lvl = asNumber(level);
    const rank = asNumber(top, null);
    const challenger = lvl >= 10 && rank && rank <= 1000;
    const podium = challenger && rank <= 3 ? ` top${rank}` : '';
    const label = challenger ? `#${rank}` : `LVL ${lvl || '?'}`;
    const sub = challenger ? 'TOP' : 'FACEIT';
    const icon = challenger ? FACEIT_LEVEL_ICONS.challenger : FACEIT_LEVEL_ICONS[lvl];

    return `
        <div class="level-wrap ${challenger ? 'challenger' : ''}${podium}">
            <div class="level-badge">
                ${icon ? `<img src="${escapeAttr(icon)}" alt="">` : ''}
            </div>
            <div class="level-text">${escapeHtml(label)}</div>
            <small>${escapeHtml(sub)}</small>
        </div>
    `;
};

const statCell = (label, value, className = '') => `
    <div class="cell ${className}">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
    </div>
`;

const statCellRaw = (label, value, className = '') => `
    <div class="cell ${className}">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${value}</div>
    </div>
`;

const wlValue = (wins, losses) => `<span class="win-text">${escapeHtml(wins)}W</span>/<span class="loss-text">${escapeHtml(losses)}L</span>`;
const formValue = (form) => String(form || '')
    .split('')
    .map(letter => {
        if (letter === 'W') return '<span class="win-text">W</span>';
        if (letter === 'L') return '<span class="loss-text">L</span>';
        return escapeHtml(letter);
    })
    .join('');
const ALLOWED_TYPES = ['summary', 'last', 'maps', 'form', 'rank', 'premades'];

const FACEIT_LEVEL_ICONS = {
    1: 'https://support.faceit.com/hc/article_attachments/11345678874012',
    2: 'https://support.faceit.com/hc/article_attachments/11345678917276',
    3: 'https://support.faceit.com/hc/article_attachments/11345675415452',
    4: 'https://support.faceit.com/hc/article_attachments/11345678909852',
    5: 'https://support.faceit.com/hc/article_attachments/11345675403932',
    6: 'https://support.faceit.com/hc/article_attachments/11345678900764',
    7: 'https://support.faceit.com/hc/article_attachments/11345675389340',
    8: 'https://support.faceit.com/hc/article_attachments/11345675386140',
    9: 'https://support.faceit.com/hc/article_attachments/11345675381916',
    10: 'https://support.faceit.com/hc/article_attachments/11345678883740',
    challenger: 'https://support.faceit.com/hc/article_attachments/11345678886940'
};

const getHeaderNext = (api) => {
    const nextLevel = api.next_level || {};

    if (nextLevel.next_level === 'top' && nextLevel.available) {
        return `TOP #${api.top || 'N/A'} -> #${nextLevel.target_top || 'N/A'}: +${nextLevel.elo_needed ?? 'N/A'} ELO`;
    }

    if (nextLevel.next_level) {
        return `LVL ${nextLevel.current_level}->${nextLevel.next_level}: +${nextLevel.elo_needed ?? 'N/A'} ELO`;
    }

    return api.trend ? `FORM ${api.trend}` : '';
};

const getRows = (type, api, data = {}) => {
    const today = api.today || {};
    const session = api.session_stats || {};
    const form = api.form || {};
    const nextLevel = api.next_level || {};
    const maps = api.maps || {};
    const lastMatch = data.last_matches?.[0] || {};
    const todayElo = shortText(today.elo, '0');
    const wins = asNumber(today.win);
    const losses = asNumber(today.lose);
    const todayCount = asNumber(today.count);
    const wr = todayCount ? `${Math.round((wins / todayCount) * 100)}%` : '0%';

    if (type === 'last') {
        const isWin = lastMatch.result === '1' || String(api.last_match || '').toLowerCase().includes('victory');
        const result = lastMatch.result ? (isWin ? 'WIN' : 'LOSS') : 'N/A';
        const score = lastMatch.score || 'N/A';
        const map = (lastMatch.map || '').replace('de_', '') || 'N/A';

        return [
            statCell('RESULT', result, isWin ? 'win' : 'loss'),
            statCell('SCORE', `${score} ${map}`),
            statCell('STATS', `${lastMatch.kills ?? 0}/${lastMatch.deaths ?? 0} ${lastMatch.kd_ratio ?? 0} KD`)
        ].join('');
    }

    if (type === 'maps') {
        return [
            statCell('BEST MAP', maps.best ? `${maps.best.name}: ${maps.best.winrate}, ${maps.best.kd} KD, ${maps.best.avg_kills} AVG` : 'N/A', 'win'),
            statCell('WORST MAP', maps.worst ? `${maps.worst.name}: ${maps.worst.winrate}, ${maps.worst.kd} KD, ${maps.worst.avg_kills} AVG` : 'N/A', 'loss')
        ].join('');
    }

    if (type === 'form') {
        return [
            statCellRaw('FORM', formValue(form.last5 || api.trend || 'N/A'), 'accent'),
            statCell('STREAK', shortText(form.current_streak, 'N/A')),
            statCell('5 WR', shortText(form.last5_winrate, '0%')),
            statCell('ELO 5', shortText(form.last5_elo, '0'), signedClass(form.last5_elo))
        ].join('');
    }

    if (type === 'rank') {
        const target = nextLevel.next_level === 'top'
            ? `#${nextLevel.target_top || 'N/A'}: ${nextLevel.elo_needed ?? 'N/A'} ELO`
            : nextLevel.next_level
                ? `LVL ${nextLevel.current_level}->${nextLevel.next_level}: ${nextLevel.elo_needed} ELO`
                : 'MAX LEVEL';

        return [
            statCell('NEXT', target, 'accent'),
            statCell('TARGET', nextLevel.target_nickname || nextLevel.next_level || 'N/A'),
            statCell('PEAK', `${api.peak_today?.peak_elo ?? api.elo ?? 0} ELO`)
        ].join('');
    }

    if (type === 'premades') {
        const premades = api.premades || {};
        const best = premades.best_overall || premades.best;
        const modeLabel = best?.label === 'SOLO' ? 'SOLO' : best?.label;

        return [
            statCell('BEST MODE', best ? `${modeLabel}` : 'No data', 'accent'),
            statCellRaw('RECORD', best ? `${wlValue(best.wins, best.losses)} ${escapeHtml(best.winrate)}` : 'N/A'),
            statCell('ELO DIFF', best ? best.elo_text || '0' : 'N/A', best ? signedClass(best.elo_text || best.elo_change || 0) : '')
        ].join('');
    }

    return [
        statCellRaw('W / L', wlValue(wins, losses)),
        statCell('WINRATE', `${wr} (${todayCount}M)`, wins >= losses ? 'win' : 'loss'),
        statCell('ELO DIFF', todayElo, signedClass(todayElo)),
        statCell('AVG STATS', `${shortText(session.avg_kills, '0')} AVG / ${shortText(session.avg_kd, '0')} KD`)
    ].join('');
};

const renderWidget = ({ data, type, types, theme, refresh, rotate }) => {
    const api = data.api || {};
    const info = data.player_info || {};
    const stats = data.faceit_stats || {};
    const nick = shortText(data.nickname);
    const avatar = info.avatar || EMPTY_IMAGE;
    const level = api.lvl || stats.skill_level || 0;
    const elo = api.elo || stats.faceit_elo || 0;
    const top = api.top || stats.region_ranking;
    const next = getHeaderNext(api);
    const activeTypes = types.length ? types : [type];
    const rows = activeTypes.map((rowType, index) => `
        <section class="grid widget-panel type-${escapeAttr(rowType)} ${index === 0 ? 'active' : ''}" data-panel="${index}">
            ${getRows(rowType, api, data)}
        </section>
    `).join('');
    const carouselScript = activeTypes.length > 1 ? `
<script>
(() => {
    const panels = [...document.querySelectorAll('.widget-panel')];
    let index = 0;
    setInterval(() => {
        panels[index].classList.remove('active');
        index = (index + 1) % panels.length;
        panels[index].classList.add('active');
    }, ${JSON.stringify(rotate * 1000)});
})();
</script>` : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${escapeAttr(refresh)}">
<title>${escapeHtml(nick)} FACEIT Widget</title>
<style>
    :root {
        --bg: rgba(12, 15, 20, .94);
        --panel: rgba(25, 29, 38, .98);
        --line: rgba(255, 255, 255, .09);
        --text: #f5f7fb;
        --muted: #9ba6b8;
        --accent: #ff6a00;
        --green: #19d37f;
        --red: #ff4d5e;
    }
    body.light {
        --bg: rgba(246, 248, 251, .96);
        --panel: rgba(235, 239, 246, .98);
        --line: rgba(10, 20, 35, .11);
        --text: #101722;
        --muted: #5d6878;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: transparent; font-family: Inter, Arial, sans-serif; color: var(--text); }
    .widget {
        width: min(710px, 100vw);
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--bg);
        box-shadow: 0 10px 36px rgba(0,0,0,.28);
    }
    .head {
        display: grid;
        grid-template-columns: 72px 56px minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        padding: 8px 14px 10px 8px;
        min-height: 92px;
    }
    .avatar {
        width: 68px;
        height: 68px;
        border-radius: 8px;
        object-fit: cover;
        background: #202633;
    }
    .level-wrap {
        width: 54px;
        display: grid;
        justify-items: center;
        gap: 2px;
        color: white;
        font-weight: 900;
        line-height: 1;
        text-align: center;
    }
    .level-badge {
        position: relative;
        width: 46px;
        height: 46px;
        display: block;
        border-radius: 8px;
        background: rgba(12, 15, 20, .35);
        border: 1px solid rgba(255,255,255,.14);
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.24);
        overflow: hidden;
    }
    .level-badge img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        padding: 2px;
    }
    .level-text {
        width: 54px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10px;
    }
    .level-wrap small { display: none; }
    .level-wrap.challenger .level-text {
        color: #fff4cc;
    }
    .level-wrap.top1 .level-badge { border-color: #ffd45a; box-shadow: 0 0 16px rgba(255, 191, 0, .55), inset 0 0 0 1px rgba(0,0,0,.24); }
    .level-wrap.top2 .level-badge { border-color: #dce7f6; box-shadow: 0 0 14px rgba(207, 221, 238, .45), inset 0 0 0 1px rgba(0,0,0,.24); }
    .level-wrap.top3 .level-badge { border-color: #d99b6c; box-shadow: 0 0 14px rgba(216, 135, 76, .45), inset 0 0 0 1px rgba(0,0,0,.24); }
    .name { min-width: 0; }
    .nick {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-size: 24px;
        font-weight: 900;
        letter-spacing: 0;
    }
    .nick span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .next {
        margin-top: 6px;
        color: var(--muted);
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .elo { text-align: right; }
    .elo strong { display: block; font-size: 32px; line-height: 1; font-weight: 950; }
    .elo span { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; }
    .grid {
        display: none;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        border-top: 1px solid var(--line);
        background: var(--panel);
    }
    .grid.active { display: grid; }
    .grid.type-last,
    .grid.type-maps,
    .grid.type-rank,
    .grid.type-premades {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .grid.type-maps {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .cell {
        min-width: 0;
        padding: 10px 12px;
        border-left: 1px solid var(--line);
    }
    .cell:first-child { border-left: 0; }
    .label {
        margin-bottom: 5px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
    }
    .value {
        min-height: 18px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 15px;
        font-weight: 900;
    }
    .win .value { color: var(--green); }
    .loss .value { color: var(--red); }
    .accent .value { color: var(--accent); }
    .muted .value { color: var(--muted); }
    .win-text { color: var(--green); }
    .loss-text { color: var(--red); }
    @media (max-width: 520px) {
        .widget { border-radius: 0; }
        .head { grid-template-columns: 58px 48px minmax(0, 1fr) auto; gap: 9px; min-height: 78px; padding: 7px 10px 8px 7px; }
        .avatar { width: 54px; height: 54px; }
        .level-wrap { width: 46px; }
        .level-badge { width: 40px; height: 40px; }
        .level-text { width: 46px; font-size: 9px; }
        .nick { font-size: 19px; }
        .next { font-size: 11px; }
        .elo strong { font-size: 25px; }
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .cell:nth-child(odd) { border-left: 0; }
        .cell:nth-child(n+3) { border-top: 1px solid var(--line); }
    }
</style>
</head>
<body class="${escapeAttr(theme)}">
<main class="widget type-${escapeAttr(activeTypes[0])}">
    <section class="head">
        <img class="avatar" src="${escapeAttr(avatar)}" alt="">
        ${getLevelBadge(level, top)}
        <div class="name">
            <div class="nick"><span>${escapeHtml(nick)}</span></div>
            <div class="next">${escapeHtml(next)}</div>
        </div>
        <div class="elo">
            <strong>${escapeHtml(elo)}</strong>
            <span>${top ? `#${escapeHtml(top)} EU` : 'EU rank N/A'}</span>
        </div>
    </section>
    ${rows}
</main>
${carouselScript}
</body>
</html>`;
};

export default async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

    const { nick, theme = 'dark' } = request.query;
    const type = String(request.query.type || request.query.widget || 'summary').toLowerCase();
    const refresh = Math.max(30, Math.min(600, asNumber(request.query.refresh, DEFAULT_REFRESH_SECONDS)));
    const rotate = Math.max(3, Math.min(60, asNumber(request.query.rotate || request.query.interval, 8)));
    const allowedTypes = new Set(ALLOWED_TYPES);
    const normalizedType = allowedTypes.has(type) ? type : 'summary';
    const requestedTypes = String(request.query.types || '')
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(item => allowedTypes.has(item));
    const carouselEnabled = 'carousel' in request.query || requestedTypes.length > 0;
    const carouselTypes = carouselEnabled
        ? (requestedTypes.length ? requestedTypes : ALLOWED_TYPES)
        : [];
    const normalizedTheme = theme === 'light' ? 'light' : 'dark';

    if (!nick) {
        response.status(400).send('Missing nick. Example: /api/widget?nick=Lezi');
        return;
    }

    try {
        const protocol = request.headers['x-forwarded-proto'] || 'https';
        const host = request.headers.host;
        const baseUrl = `${protocol}://${host}`;
        const needsPremades = normalizedType === 'premades' || carouselTypes.includes('premades');
        const premadesParams = needsPremades
            ? `&premades=true${request.query.premades_min ? `&premades_min=${encodeURIComponent(request.query.premades_min)}` : ''}`
            : '';
        const apiUrl = `${baseUrl}/api/faceit?nick=${encodeURIComponent(nick)}&full&compact${premadesParams}`;
        const apiResponse = await fetch(apiUrl);
        const contentType = apiResponse.headers.get('content-type') || '';

        if (!apiResponse.ok || !contentType.includes('application/json')) {
            const text = await apiResponse.text().catch(() => '');
            response.status(apiResponse.status || 500).send(escapeHtml(text || 'FACEIT API error'));
            return;
        }

        const data = await apiResponse.json();
        response.status(200).send(renderWidget({
            data,
            type: normalizedType,
            types: carouselTypes,
            theme: normalizedTheme,
            refresh,
            rotate
        }));
    } catch (error) {
        console.error('[widget:error]', error);
        response.status(500).send('Widget error');
    }
}
