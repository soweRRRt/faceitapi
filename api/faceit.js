export default async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET');

    const { nick: nickname, view: viewTemplate, preset: presetName } = request.query;
    const fullMode = 'full' in request.query;
    const compactMode = 'compact' in request.query;
    const premadesMode = 'premades' in request.query || presetName === 'premades';
    const { FACEIT_API_KEY, DEEP_FACEIT_API_KEY } = process.env;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const log = (level, event, payload = {}) => {
        console[level](`[faceit:${requestId}] ${event}`, JSON.stringify({
            nick: nickname,
            ...payload
        }));
    };

    const getBeautifulMapName = (defaultMapName) => {
        return defaultMapName
            .replace('de_', '')
            .replace(/_/g, ' ')
            .replace(/(\D+)(\d+)/, '$1 $2')
            .replace(/(\d)/g, (digit) => {
                return 'I'.repeat(parseInt(digit));
            })
            .replace(/\b\w/g, l => l.toUpperCase());
    };

    const fetchWithAuth = (url, apiKey = FACEIT_API_KEY, extraHeaders = {}) => {
        return fetch(url, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...extraHeaders
            }
        });
    };

    const calculateEloChange = (currentElo, previousElo) => {
        return currentElo - previousElo;
    };

    const calculateHSPercentage = (headshots, kills) => {
        return Math.round((headshots / kills) * 100) || 0;
    };

    const formatScore = (scoreString) => {
        return (scoreString || '0 / 0')
            .split(' / ')
            .map(num => parseInt(num) || 0)
            .join(':');
    };

    const formatHistoryScore = (score) => {
        if (!score) return '0:0';

        if (typeof score === 'string') {
            return score.includes(' / ') ? formatScore(score) : score;
        }

        if (Array.isArray(score)) {
            return score.map(value => parseInt(value) || 0).join(':');
        }

        if (typeof score === 'object') {
            const values = Object.values(score).map(value => parseInt(value) || 0);
            return values.length ? values.join(':') : '0:0';
        }

        return '0:0';
    };

    const parseFaceitDate = (dateValue) => {
        if (!dateValue) return null;

        if (typeof dateValue === 'number') {
            return new Date(dateValue < 1000000000000 ? dateValue * 1000 : dateValue);
        }

        const parsed = new Date(dateValue);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatPercent = (value) => {
        return `${Math.round(value || 0)}%`;
    };

    const levelThresholds = {
        1: 100,
        2: 501,
        3: 751,
        4: 901,
        5: 1051,
        6: 1201,
        7: 1351,
        8: 1531,
        9: 1751,
        10: 2001
    };

    const getNextLevelProgress = (elo, level, rankingTarget = null) => {
        const currentLevel = parseInt(level || 0);
        const currentElo = parseInt(elo || 0);

        if (currentLevel >= 10) {
            if (rankingTarget) {
                return {
                    current_level: currentLevel,
                    next_level: "top",
                    available: true,
                    elo_needed: rankingTarget.elo >= currentElo ? rankingTarget.elo - currentElo + 1 : 0,
                    next_level_elo: rankingTarget.elo || null,
                    progress: null,
                    target_top: rankingTarget.position || null,
                    target_nickname: rankingTarget.nickname || null
                };
            }

            return {
                current_level: currentLevel,
                next_level: "top",
                available: false,
                elo_needed: 0,
                next_level_elo: null,
                progress: null,
                target_top: null,
                target_nickname: null
            };
        }

        const nextLevel = currentLevel + 1;
        const currentLevelElo = levelThresholds[currentLevel] || 0;
        const nextLevelElo = levelThresholds[nextLevel] || 0;
        const levelRange = Math.max(nextLevelElo - currentLevelElo, 1);
        const progress = Math.max(0, Math.min(100, ((currentElo - currentLevelElo) / levelRange) * 100));

        return {
            current_level: currentLevel,
            next_level: nextLevel,
            available: true,
            elo_needed: Math.max(nextLevelElo - currentElo, 0),
            next_level_elo: nextLevelElo,
            progress: `${Math.round(progress)}%`
        };
    };

    const getRankingPlayerElo = (rankingPlayer) => {
        return parseInt(
            rankingPlayer?.faceit_elo ??
            rankingPlayer?.elo ??
            rankingPlayer?.games?.cs2?.faceit_elo ??
            0
        ) || 0;
    };

    const getRankingPlayerNickname = (rankingPlayer) => {
        return rankingPlayer?.nickname || rankingPlayer?.player?.nickname || rankingPlayer?.name || null;
    };

    const calculateMatchAverages = (matches) => {
        if (!matches.length) {
            return {
                matches: 0,
                winrate: "0%",
                avg_kills: 0,
                avg_kd: 0,
                avg_kr: 0,
                avg_adr: 0,
                avg_hs: "0%",
                wins: 0,
                losses: 0
            };
        }

        const totals = matches.reduce((acc, match) => ({
            kills: acc.kills + (parseInt(match.kills) || 0),
            kdRatio: acc.kdRatio + (parseFloat(match.kd_ratio) || 0),
            adr: acc.adr + (parseFloat(match.adr) || 0),
            hsPercent: acc.hsPercent + (parseFloat(match.hs_percent ?? match.hs_percentage) || 0),
            rounds: acc.rounds + (parseInt(match.rounds) || 0),
            wins: acc.wins + (match.result === '1' || match.result === 'WIN' ? 1 : 0),
            losses: acc.losses + (match.result === '0' || match.result === 'LOSE' ? 1 : 0)
        }), { kills: 0, kdRatio: 0, adr: 0, hsPercent: 0, rounds: 0, wins: 0, losses: 0 });

        return {
            matches: matches.length,
            winrate: formatPercent((totals.wins / matches.length) * 100),
            avg_kills: (totals.kills / matches.length).toFixed(0),
            avg_kd: (totals.kdRatio / matches.length).toFixed(2),
            avg_kr: totals.rounds ? (totals.kills / totals.rounds).toFixed(2) : "0.00",
            avg_adr: (totals.adr / matches.length).toFixed(2),
            avg_hs: formatPercent(totals.hsPercent / matches.length),
            wins: totals.wins,
            losses: totals.losses
        };
    };

    const getCurrentStreak = (matches) => {
        if (!matches.length) return "";

        const firstResult = matches[0].result;
        const normalized = firstResult === '1' || firstResult === 'WIN' ? 'W' : 'L';
        let count = 0;

        for (const match of matches) {
            const result = match.result === '1' || match.result === 'WIN' ? 'W' : 'L';
            if (result !== normalized) break;
            count++;
        }

        return `${normalized}${count}`;
    };

    const normalizeResult = (result) => {
        return result === '1' || result === 'WIN' ? 'WIN' : 'LOSE';
    };

    const getMatchPerformanceScore = (match) => {
        const kills = parseInt(match.kills || 0);
        const assists = parseInt(match.assists || 0);
        const deaths = parseInt(match.deaths || 0);
        const kd = parseFloat(match.kd_ratio || 0);
        const adr = parseFloat(match.adr || 0);
        const mvps = parseInt(match.mvps || 0);

        return Number((kills * 1.2 + assists * 0.45 - deaths * 0.55 + kd * 8 + adr * 0.08 + mvps * 1.5).toFixed(2));
    };

    const getPeakToday = (matches, currentElo, todayStr) => {
        const todayEloMatches = matches
            .filter(match => {
                const date = parseFaceitDate(match.date);
                return date && date.toLocaleDateString('ru-RU') === todayStr && match.elo;
            })
            .map(match => ({
                elo: parseInt(match.elo || 0),
                date: match.date,
                result: match.result,
                map: match.map,
                score: match.score
            }))
            .filter(match => match.elo > 0);

        if (!todayEloMatches.length) {
            return {
                peak_elo: currentElo,
                lowest_elo: currentElo,
                current_from_peak: 0,
                peak_match: null
            };
        }

        const peakMatch = todayEloMatches.reduce((best, match) => match.elo > best.elo ? match : best, todayEloMatches[0]);
        const lowMatch = todayEloMatches.reduce((worst, match) => match.elo < worst.elo ? match : worst, todayEloMatches[0]);

        return {
            peak_elo: peakMatch.elo,
            lowest_elo: lowMatch.elo,
            current_from_peak: currentElo - peakMatch.elo,
            peak_match: peakMatch
        };
    };

    const getTiltMeter = (matches, detailedMatches = []) => {
        const last5 = matches.slice(0, 5);
        const losses = last5.filter(match => normalizeResult(match.result) === 'LOSE').length;
        const avgKd = last5.length
            ? last5.reduce((sum, match) => sum + (parseFloat(match.kd_ratio) || 0), 0) / last5.length
            : 0;
        const eloChange = detailedMatches.slice(0, 5).reduce((sum, match) => sum + (parseInt(match.elo_change) || 0), 0);
        const currentStreak = getCurrentStreak(matches);
        const score = losses * 20 + (avgKd < 0.9 ? 20 : 0) + (eloChange < -50 ? 25 : 0) + (currentStreak.startsWith('L') ? parseInt(currentStreak.slice(1)) * 10 : 0);

        return {
            status: score >= 60 ? "tilted" : score >= 30 ? "warning" : "calm",
            score: Math.min(score, 100),
            last5_losses: losses,
            last5_avg_kd: avgKd.toFixed(2),
            last5_elo: eloChange,
            streak: currentStreak
        };
    };

    const getMapSummaries = (segments = []) => {
        const maps = segments
            .filter(segment => segment.type === 'Map' && segment.stats)
            .map(segment => {
                const matches = parseInt(segment.stats.Matches || segment.stats['Total Matches'] || 0);
                const wins = parseInt(segment.stats.Wins || 0);
                const winrate = parseFloat(segment.stats['Win Rate %'] || 0);
                const kd = parseFloat(segment.stats['Average K/D Ratio'] || segment.stats['K/D Ratio'] || 0);
                const adr = parseFloat(segment.stats.ADR || 0);
                const avgKills = parseFloat(segment.stats['Average Kills'] || 0);
                const confidence = Math.min(1, Math.log10(matches + 1) / 2);
                const score = (
                    winrate * 1.0 +
                    kd * 35 +
                    adr * 0.3 +
                    avgKills * 1.0 +
                    wins * 0.05 +
                    matches * 0.03 +
                    confidence * 15
                );

                return {
                    name: segment.label,
                    matches,
                    wins,
                    winrate: `${Math.round(winrate)}%`,
                    kd: kd.toFixed(2),
                    adr: adr.toFixed(2),
                    avg_kills: avgKills.toFixed(0),
                    score: Number(score.toFixed(2)),
                    score_formula: "WR*1.0 + KD*35 + ADR*0.3 + AVG_KILLS*1.0 + WINS*0.05 + MATCHES*0.03 + CONFIDENCE*15",
                    confidence: Number(confidence.toFixed(2))
                };
            })
            .filter(map => map.matches > 0);

        const sortedByBest = [...maps].sort((a, b) =>
            b.score - a.score || b.matches - a.matches || parseFloat(b.kd) - parseFloat(a.kd)
        );
        const sortedByWorst = [...maps].sort((a, b) =>
            a.score - b.score || b.matches - a.matches || parseFloat(a.kd) - parseFloat(b.kd)
        );

        return {
            best: sortedByBest[0] || null,
            worst: sortedByWorst[0] || null,
            recommended: sortedByBest.slice(0, 3),
            all: maps
        };
    };

    const getCombinations = (items) => {
        const result = [];

        for (let size = 1; size <= items.length; size++) {
            const walk = (start, combo) => {
                if (combo.length === size) {
                    result.push(combo);
                    return;
                }

                for (let index = start; index < items.length; index++) {
                    walk(index + 1, [...combo, items[index]]);
                }
            };

            walk(0, []);
        }

        return result;
    };

    const extractPlayerId = (player) => {
        return player?.player_id ||
            player?.playerId ||
            player?.id ||
            player?.player_stats?.player_id ||
            player?.player_stats?.['Player Id'] ||
            null;
    };

    const extractPlayerNickname = (player) => {
        return player?.nickname ||
            player?.game_player_name ||
            player?.name ||
            player?.player_stats?.Nickname ||
            player?.player_stats?.nickname ||
            extractPlayerId(player);
    };

    const extractPlayerStats = (player) => {
        const stats = player?.player_stats || player?.stats || {};

        return {
            kills: parseInt(stats.Kills || stats.kills || 0) || 0,
            kd: parseFloat(stats['K/D Ratio'] || stats.kd_ratio || stats.KD || 0) || 0,
            adr: parseFloat(stats.ADR || stats.adr || 0) || 0
        };
    };

    const normalizePremadeGroups = (premade) => {
        if (!premade) return [];

        if (Array.isArray(premade)) {
            if (premade.every(item => typeof item === 'string')) {
                return [premade];
            }

            if (premade.every(Array.isArray)) {
                return premade.map(group => group.map(String));
            }

            if (premade.every(item => typeof item === 'object')) {
                return premade
                    .map(group => {
                        if (Array.isArray(group?.players)) return group.players;
                        if (Array.isArray(group?.player_ids)) return group.player_ids;
                        if (Array.isArray(group?.members)) return group.members;
                        return [];
                    })
                    .filter(group => group.length)
                    .map(group => group.map(String));
            }
        }

        if (typeof premade === 'object') {
            return Object.values(premade)
                .filter(value => Array.isArray(value))
                .map(group => group.map(item => typeof item === 'object' ? extractPlayerId(item) : item).filter(Boolean).map(String));
        }

        return [];
    };

    const collectPremadeGroups = (...sources) => {
        return sources.flatMap(source => normalizePremadeGroups(source));
    };

    const getPlayerPartyValue = (player) => {
        return player?.party_id ||
            player?.partyId ||
            player?.premade_id ||
            player?.premadeId ||
            player?.premade ||
            player?.player_stats?.party_id ||
            player?.player_stats?.premade_id ||
            null;
    };

    const getPremadeTeammates = (team, playerId, details = {}) => {
        const players = team.players || team.roster || [];
        const playerIds = players.map(extractPlayerId);
        const explicitGroups = collectPremadeGroups(
            team.premade,
            team.premades,
            team.party,
            team.parties,
            details.premade,
            details.premades,
            details.party,
            details.parties,
            details.entity?.premade,
            details.entity?.premades,
            details.entity?.party,
            details.entity?.parties,
            details.match?.premade,
            details.match?.premades,
            details.match?.party,
            details.match?.parties,
            details.payload?.premade,
            details.payload?.premades,
            details.payload?.party,
            details.payload?.parties
        );
        const explicitPlayerGroup = explicitGroups.find(group => group.includes(playerId));

        if (explicitPlayerGroup) {
            return players.filter(player => {
                const id = extractPlayerId(player);
                return id && id !== playerId && explicitPlayerGroup.includes(id);
            });
        }

        const currentPlayer = players.find(player => extractPlayerId(player) === playerId);
        const currentParty = getPlayerPartyValue(currentPlayer);

        if (currentParty && typeof currentParty !== 'boolean') {
            return players.filter(player => {
                const id = extractPlayerId(player);
                return id && id !== playerId && getPlayerPartyValue(player) === currentParty;
            });
        }

        const teamPremadeIsFullParty = team.premade === true || team.premade === 'true';
        if (teamPremadeIsFullParty && playerIds.includes(playerId)) {
            return players.filter(player => extractPlayerId(player) !== playerId);
        }

        return [];
    };

    const hasPremadeSignal = (team) => {
        const players = team.players || team.roster || [];
        return team.premade === true ||
            collectPremadeGroups(team.premade, team.premades, team.party, team.parties).length > 0 ||
            players.some(player => getPlayerPartyValue(player));
    };

    const normalizeTeams = (details = {}) => {
        const teams = details.teams ||
            details.payload?.teams ||
            details.match?.teams ||
            details.entity?.teams ||
            {};

        return Array.isArray(teams) ? teams : Object.values(teams);
    };

    const fetchPremadeMatchDetails = async (matchId) => {
        const internalHeaders = {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': `https://www.faceit.com/en/cs2/room/${matchId}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
        };
        const internalUrls = [
            `https://www.faceit.com/api/match/v2/match/${matchId}`,
            `https://api.faceit.com/match/v2/match/${matchId}`
        ];

        for (const url of internalUrls) {
            const response = await fetchWithAuth(url, DEEP_FACEIT_API_KEY || FACEIT_API_KEY, internalHeaders);

            if (response.ok) {
                return {
                    source: url.includes('/api/match/v2') ? 'faceit-internal-www-match-v2' : 'faceit-internal-api-match-v2',
                    details: await response.json()
                };
            }
        }

        const openResponse = await fetchWithAuth(`https://open.faceit.com/data/v4/matches/${matchId}`);

        if (openResponse.ok) {
            return {
                source: 'open-v4-match',
                details: await openResponse.json()
            };
        }

        return null;
    };

    const getPremadeEloChange = (match, eloChangesByMatchId, eloChangesBySignature) => {
        if (eloChangesByMatchId.has(match.match_id)) {
            return eloChangesByMatchId.get(match.match_id);
        }

        const date = parseFaceitDate(match.date);
        const signature = date
            ? `${date.getTime()}|${match.map}|${match.score}`
            : null;

        return signature && eloChangesBySignature.has(signature)
            ? eloChangesBySignature.get(signature)
            : null;
    };

    const calculatePremades = async (matches, playerId, options = {}) => {
        const candidates = matches
            .filter(match => match.match_id)
            .slice(0, 50);
        const minimumSharedMatches = Math.max(2, parseInt(options.minSharedMatches || 3) || 3);
        const minimumComboMatches = Math.max(1, parseInt(options.minComboMatches || 2) || 2);
        const eloChangesByMatchId = options.eloChangesByMatchId || new Map();
        const eloChangesBySignature = options.eloChangesBySignature || new Map();

        const premadeMap = new Map();
        const solo = {
            key: 'solo',
            players: [],
            size: 0,
            matches: 0,
            wins: 0,
            losses: 0,
            kills: 0,
            kd: 0,
            adr: 0,
            elo_change: 0,
            elo_matches: 0,
            mateKills: 0,
            mateKd: 0,
            mateAdr: 0
        };

        const matchDetails = await Promise.allSettled(candidates.map(async (match) => ({
            match,
            ...(await fetchPremadeMatchDetails(match.match_id) || {})
        })));

        const normalizedMatches = [];
        const teammateTotals = new Map();
        let matchesWithRoster = 0;
        let exactPartyMatches = 0;
        const detailSources = {};

        for (const item of matchDetails) {
            if (item.status !== 'fulfilled' || !item.value?.details) continue;

            const { match, details, source } = item.value;
            const teams = normalizeTeams(details);
            if (!teams.length) continue;
            const playerTeam = teams.find(team =>
                (team.players || team.roster || []).some(player => extractPlayerId(player) === playerId)
            );

            if (!playerTeam) continue;

            detailSources[source || 'unknown'] = (detailSources[source || 'unknown'] || 0) + 1;

            const allTeammates = (playerTeam.players || playerTeam.roster || [])
                .filter(player => extractPlayerId(player) !== playerId)
                .map(player => ({
                    id: extractPlayerId(player),
                    nickname: extractPlayerNickname(player)
                }))
                .filter(player => player.id)
                .sort((a, b) => a.nickname.localeCompare(b.nickname));
            const exactTeammates = getPremadeTeammates(playerTeam, playerId, details)
                .map(player => ({
                    id: extractPlayerId(player),
                    nickname: extractPlayerNickname(player)
                }))
                .filter(player => player.id)
                .sort((a, b) => a.nickname.localeCompare(b.nickname));

            matchesWithRoster++;
            if (exactTeammates.length || hasPremadeSignal(playerTeam)) {
                exactPartyMatches++;
            }
            normalizedMatches.push({ match, teammates: allTeammates, exactTeammates });

            for (const teammate of allTeammates) {
                if (!teammateTotals.has(teammate.id)) {
                    teammateTotals.set(teammate.id, {
                        id: teammate.id,
                        nickname: teammate.nickname,
                        matches: 0
                    });
                }

                teammateTotals.get(teammate.id).matches++;
            }
        }

        const recurringTeammates = new Map(
            [...teammateTotals.values()]
                .filter(teammate => teammate.matches >= minimumSharedMatches)
                .map(teammate => [teammate.id, teammate])
        );

        for (const { match, teammates, exactTeammates } of normalizedMatches) {
            const premadeTeammates = exactPartyMatches
                ? exactTeammates
                : teammates.filter(teammate => recurringTeammates.has(teammate.id));
            const isWin = normalizeResult(match.result) === 'WIN';
            const addStats = (entry) => {
                entry.matches++;
                isWin ? entry.wins++ : entry.losses++;
                entry.kills += parseInt(match.kills || 0);
                entry.kd += parseFloat(match.kd_ratio || 0);
                entry.adr += parseFloat(match.adr || 0);
                const eloChange = getPremadeEloChange(match, eloChangesByMatchId, eloChangesBySignature);
                if (eloChange !== null) {
                    entry.elo_change += eloChange;
                    entry.elo_matches++;
                }
            };

            if (!premadeTeammates.length) {
                addStats(solo);
                continue;
            }

            for (const combo of getCombinations(premadeTeammates)) {
                const key = combo.map(player => player.id).join('|');

                if (!premadeMap.has(key)) {
                    premadeMap.set(key, {
                        key,
                        players: combo.map(player => player.nickname),
                        size: combo.length,
                        matches: 0,
                        wins: 0,
                        losses: 0,
                        kills: 0,
                        kd: 0,
                        adr: 0,
                        elo_change: 0,
                        elo_matches: 0
                    });
                }

                addStats(premadeMap.get(key));
            }
        }

        const finalize = (entry) => {
            const winrate = entry.matches ? (entry.wins / entry.matches) * 100 : 0;
            const avgKills = entry.matches ? entry.kills / entry.matches : 0;
            const avgKd = entry.matches ? entry.kd / entry.matches : 0;
            const avgAdr = entry.matches ? entry.adr / entry.matches : 0;
            const eloPerMatch = entry.elo_matches ? entry.elo_change / entry.elo_matches : 0;
            const score = entry.elo_change * 4 +
                eloPerMatch * 20 +
                winrate * 0.5 +
                entry.matches * 1.2 +
                entry.wins -
                entry.losses * 0.8 +
                avgKills * 0.25 +
                avgKd * 4 +
                avgAdr * 0.03 +
                entry.size;

            return {
                players: entry.players,
                label: entry.players.length ? entry.players.join(' + ') : 'SOLO',
                size: entry.size,
                matches: entry.matches,
                wins: entry.wins,
                losses: entry.losses,
                winrate: formatPercent(winrate),
                avg_kills: avgKills.toFixed(0),
                avg_kd: avgKd.toFixed(2),
                avg_adr: avgAdr.toFixed(2),
                elo_change: entry.elo_change,
                elo_matches: entry.elo_matches,
                elo_per_match: Number(eloPerMatch.toFixed(2)),
                elo_text: entry.elo_change > 0 ? `+${entry.elo_change}` : entry.elo_change.toString(),
                score: Number(score.toFixed(2))
            };
        };

        const groups = [...premadeMap.values()]
            .filter(entry => entry.matches >= minimumComboMatches)
            .map(finalize)
            .sort((a, b) => b.score - a.score || b.matches - a.matches || parseFloat(b.avg_kd) - parseFloat(a.avg_kd));
        const soloFinal = solo.matches ? finalize(solo) : null;
        const comparison = [
            ...groups,
            soloFinal
        ]
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || b.matches - a.matches || parseFloat(b.avg_kd) - parseFloat(a.avg_kd));

        return {
            sample_matches: candidates.length,
            matches_with_roster: matchesWithRoster,
            exact_party_matches: exactPartyMatches,
            mode: exactPartyMatches ? "exact_faceit_party" : "inferred_recurring_teammates",
            detail_sources: detailSources,
            minimum_shared_matches: minimumSharedMatches,
            minimum_combo_matches: minimumComboMatches,
            recurring_teammates: [...recurringTeammates.values()]
                .sort((a, b) => b.matches - a.matches)
                .slice(0, 10),
            formula: "ELO_CHANGE*4 + ELO_PER_MATCH*20 + WR*0.5 + MATCHES*1.2 + WINS - LOSSES*0.8 + AVG*0.25 + KD*4 + ADR*0.03 + STACK_SIZE",
            source: exactPartyMatches
                ? "FACEIT match room/internal party data"
                : "inferred from repeated teammates; one-off random teammates are ignored",
            best: groups[0] || null,
            best_overall: comparison[0] || null,
            top: groups.slice(0, 5),
            comparison: comparison.slice(0, 6),
            solo: soloFinal
        };
    };

    try {
        log('info', 'request:start', {
            fullMode,
            hasView: Boolean(viewTemplate),
            hasFaceitKey: Boolean(FACEIT_API_KEY),
            hasDeepKey: Boolean(DEEP_FACEIT_API_KEY)
        });

        const playerResponse = await fetchWithAuth(
            `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`
        );

        if (!playerResponse.ok) {
            log('warn', 'player:failed', {
                status: playerResponse.status,
                statusText: playerResponse.statusText
            });
            throw new Error('Ошибка получения player_id');
        }

        const playerData = await playerResponse.json();
        const playerId = playerData.player_id;
        const region = playerData.games?.cs2?.region || 'EU';

        log('info', 'player:loaded', {
            playerId,
            region,
            elo: playerData.games?.cs2?.faceit_elo || 0,
            level: playerData.games?.cs2?.skill_level || 0
        });

        let regionRanking = null;
        let regionRankingItems = [];
        let nextRankingTarget = null;
        let rankProgress = [];
        try {
            const rankingResponse = await fetchWithAuth(
                `https://open.faceit.com/data/v4/rankings/games/cs2/regions/${region}/players/${playerId}?offset=0&limit=100`
            );

            if (rankingResponse.ok) {
                const rankingData = await rankingResponse.json();
                regionRanking = rankingData.position;
                regionRankingItems = rankingData.items || [];
            } else {
                log('warn', 'ranking:failed', {
                    status: rankingResponse.status,
                    statusText: rankingResponse.statusText,
                    region
                });
            }
        } catch (e) {
            log('error', 'ranking:error', {
                message: e.message,
                stack: e.stack
            });
        }

        if ((playerData.games?.cs2?.skill_level || 0) >= 10 && regionRanking) {
            try {
                const targetPosition = regionRanking > 1000 ? 1000 : Math.max(regionRanking - 1, 1);
                const targetFromPlayerRanking = regionRankingItems.find(item => item.position === targetPosition);

                if (targetFromPlayerRanking) {
                    const targetElo = getRankingPlayerElo(targetFromPlayerRanking);

                    if (targetElo) {
                        nextRankingTarget = {
                            position: targetFromPlayerRanking.position || targetPosition,
                            elo: targetElo,
                            nickname: getRankingPlayerNickname(targetFromPlayerRanking)
                        };
                    }
                } else {
                    const targetOffset = Math.max(targetPosition - 1, 0);
                    const nextRankResponse = await fetchWithAuth(
                        `https://open.faceit.com/data/v4/rankings/games/cs2/regions/${region}?offset=${targetOffset}&limit=1`
                    );

                    if (!nextRankResponse.ok) {
                        const bodyPreview = await nextRankResponse.text().catch(() => '');
                        log('warn', 'ranking:next-target-failed', {
                            status: nextRankResponse.status,
                            statusText: nextRankResponse.statusText,
                            region,
                            regionRanking,
                            targetPosition,
                            bodyPreview: bodyPreview.slice(0, 300)
                        });
                    } else {
                        const nextRankData = await nextRankResponse.json();
                        const rankingItems = nextRankData.items || [];
                        const targetPlayer = rankingItems.find(item => item.position === targetPosition) || rankingItems[0];
                        const targetElo = getRankingPlayerElo(targetPlayer);

                        if (targetPlayer && targetElo) {
                            nextRankingTarget = {
                                position: targetPlayer.position || targetPosition,
                                elo: targetElo,
                                nickname: getRankingPlayerNickname(targetPlayer)
                            };
                        }
                    }
                }

                if (nextRankingTarget) {
                    log('info', 'ranking:next-target-loaded', {
                        currentPosition: regionRanking,
                        targetPosition,
                        targetElo: nextRankingTarget.elo,
                        targetNickname: nextRankingTarget.nickname
                    });
                } else {
                    log('warn', 'ranking:next-target-missing', {
                        currentPosition: regionRanking,
                        targetPosition,
                        playerRankingItemsCount: regionRankingItems.length
                    });
                }
            } catch (e) {
                log('error', 'ranking:next-target-error', {
                    message: e.message,
                    stack: e.stack
                });
            }
        }

        if ((playerData.games?.cs2?.skill_level || 0) >= 10 && regionRanking) {
            const currentElo = playerData.games?.cs2?.faceit_elo || 0;
            const rankTargets = [1000, 500, 100, 10].filter(position => regionRanking > position);

            rankProgress = await Promise.all(rankTargets.map(async (position) => {
                try {
                    const targetResponse = await fetchWithAuth(
                        `https://open.faceit.com/data/v4/rankings/games/cs2/regions/${region}?offset=${position - 1}&limit=1`
                    );

                    if (!targetResponse.ok) {
                        return {
                            target_top: position,
                            available: false,
                            elo_needed: null,
                            target_elo: null,
                            target_nickname: null
                        };
                    }

                    const targetData = await targetResponse.json();
                    const targetPlayer = targetData.items?.[0];
                    const targetElo = getRankingPlayerElo(targetPlayer);

                    return {
                        target_top: position,
                        available: Boolean(targetPlayer && targetElo),
                        elo_needed: targetElo ? (targetElo >= currentElo ? targetElo - currentElo + 1 : 0) : null,
                        target_elo: targetElo || null,
                        target_nickname: getRankingPlayerNickname(targetPlayer)
                    };
                } catch (e) {
                    log('error', 'ranking:progress-error', {
                        targetTop: position,
                        message: e.message
                    });

                    return {
                        target_top: position,
                        available: false,
                        elo_needed: null,
                        target_elo: null,
                        target_nickname: null
                    };
                }
            }));
        }

        const todayMatches = {
            present: false,
            win: 0,
            lose: 0,
            elo: "0",
            elo_win: 0,
            elo_lose: 0,
            count: 0,
            start_elo: 0,
            end_elo: playerData.games?.cs2?.faceit_elo || 0,
            report: "",
            last_match: ""
        };

        let allMatchesReport = "";
        let allMatchesLastMatch = "";
        let lastMatchBeforeToday = null;
        let todayMatchesDetailed = [];
        let allMatchesDetailed = [];

        try {
            const now = new Date();
            const todayStr = now.toLocaleDateString('ru-RU');
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const deepStatsUrl = `https://www.faceit.com/api/stats/v1/stats/time/users/${playerId}/games/cs2?page=0&size=30&game_mode=5v5`;

            log('info', 'deep-stats:request', {
                todayStr,
                todayStart: todayStart.toISOString(),
                hasDeepKey: Boolean(DEEP_FACEIT_API_KEY)
            });

            const todayResponse = await fetchWithAuth(
                deepStatsUrl,
                DEEP_FACEIT_API_KEY,
                {
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': `https://www.faceit.com/en/players/${encodeURIComponent(nickname)}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
                }
            );

            if (todayResponse.ok) {
                const todayData = await todayResponse.json();
                const isArray = Array.isArray(todayData);

                log('info', 'deep-stats:loaded', {
                    isArray,
                    count: isArray ? todayData.length : null,
                    type: typeof todayData,
                    firstItemKeys: isArray && todayData[0] ? Object.keys(todayData[0]).slice(0, 20) : []
                });

                if (!isArray) {
                    log('warn', 'deep-stats:not-array', {
                        preview: JSON.stringify(todayData).slice(0, 500)
                    });
                }

                const allMatches = (isArray ? todayData : [])
                    .filter(match => match.date)
                    .map(match => ({
                        ...match,
                        dateObj: new Date(match.date),
                        eloValue: parseInt(match.elo || 0)
                    }))
                    .filter(match => !Number.isNaN(match.dateObj.getTime()))
                    .sort((a, b) => b.dateObj - a.dateObj);

                log('info', 'deep-stats:matches-normalized', {
                    allMatchesCount: allMatches.length,
                    matchesWithElo: allMatches.filter(match => match.eloValue).length,
                    newestDate: allMatches[0]?.dateObj?.toISOString() || null,
                    oldestDate: allMatches[allMatches.length - 1]?.dateObj?.toISOString() || null,
                    newestMap: allMatches[0]?.i1 || null,
                    newestResult: allMatches[0]?.i10 || null
                });

                allMatchesDetailed = allMatches.map((match, index, array) => {
                    const isWin = match.i10 === '1';
                    const kills = parseInt(match.i6 || 0);
                    const headshots = parseInt(match.i13 || 0);
                    const hsPercentage = calculateHSPercentage(headshots, kills);

                    let eloChange = 0;

                    if (index < array.length - 1 && match.eloValue && array[index + 1].eloValue) {
                        eloChange = calculateEloChange(match.eloValue, array[index + 1].eloValue);
                    }

                    return {
                        match_id: match.match_id || match.matchId || match.id || match.i64 || match.i65 || null,
                        result: isWin ? 'WIN' : 'LOSE',
                        score: formatScore(match.i18),
                        map: match.i1 || 'Unknown',
                        elo_change: eloChange,
                        kills: kills,
                        deaths: parseInt(match.i8 || 0),
                        assists: parseInt(match.i7 || 0),
                        headshots: headshots,
                        hs_percentage: hsPercentage,
                        kd_ratio: parseFloat(match.c2 || 0),
                        mvps: parseInt(match.i9 || 0),
                        date: match.dateObj,
                        signature: `${match.dateObj.getTime()}|${match.i1 || 'Unknown'}|${formatScore(match.i18)}`,
                        elo: match.eloValue
                    };
                });

                const last5Matches = allMatchesDetailed.slice(0, 5);
                allMatchesReport = last5Matches.map(match =>
                    `${match.result} ${match.score} ${getBeautifulMapName(match.map)}` +
                    (match.elo_change !== 0 ? ` (${match.elo_change > 0 ? '+' : ''}${match.elo_change})` : '')
                ).join(', ');

                if (allMatchesDetailed.length > 0) {
                    const lastMatch = allMatchesDetailed[0];
                    allMatchesLastMatch =
                        `${lastMatch.result === 'WIN' ? 'Victory' : 'Defeat'} on ${getBeautifulMapName(lastMatch.map)} (${lastMatch.score}), ` +
                        `KAD: ${lastMatch.kills}/${lastMatch.assists}/${lastMatch.deaths} ` +
                        `KDR: ${lastMatch.kd_ratio} HS: ${lastMatch.hs_percentage}% ` +
                        `MVP: ${lastMatch.mvps}` +
                        (lastMatch.elo_change !== 0 ? ` ELO: ${lastMatch.elo_change > 0 ? '+' : ''}${lastMatch.elo_change}` : '');
                }

                const matchesToday = allMatches.filter(match => {
                    const matchDay = match.dateObj.toLocaleDateString('ru-RU');
                    return matchDay === todayStr;
                });

                lastMatchBeforeToday = allMatches.find(match => {
                    const matchDay = match.dateObj.toLocaleDateString('ru-RU');
                    return matchDay !== todayStr && match.dateObj < todayStart;
                });

                todayMatches.start_elo = lastMatchBeforeToday?.eloValue ||
                    (matchesToday.length > 0 ? matchesToday[matchesToday.length - 1].eloValue : todayMatches.end_elo);

                log('info', 'today:calculated-inputs', {
                    matchesTodayCount: matchesToday.length,
                    lastMatchBeforeTodayDate: lastMatchBeforeToday?.dateObj?.toISOString() || null,
                    lastMatchBeforeTodayElo: lastMatchBeforeToday?.eloValue || null,
                    startElo: todayMatches.start_elo,
                    endElo: todayMatches.end_elo,
                    reportReady: Boolean(allMatchesReport),
                    lastMatchReady: Boolean(allMatchesLastMatch)
                });

                if (matchesToday.length > 0) {
                    todayMatches.present = true;
                    todayMatches.count = matchesToday.length;

                    const sortedMatches = matchesToday.sort((a, b) => a.dateObj - b.dateObj);

                    sortedMatches.forEach((match, index) => {
                        const isWin = match.i10 === '1';
                        isWin ? todayMatches.win++ : todayMatches.lose++;

                        let eloChange = 0;
                        if (match.eloValue) {
                            const previousElo = index === 0 ? todayMatches.start_elo : sortedMatches[index - 1].eloValue;
                            eloChange = previousElo ? calculateEloChange(match.eloValue, previousElo) : 0;
                        }

                        if (isWin) {
                            todayMatches.elo_win += eloChange;
                        } else {
                            todayMatches.elo_lose += eloChange;
                        }

                        todayMatchesDetailed.push({
                            result: isWin ? 'WIN' : 'LOSE',
                            score: formatScore(match.i18),
                            map: match.i1 || 'Unknown',
                            elo_change: eloChange > 0 ? `+${eloChange}` : eloChange.toString(),
                            kills: match.i6 || 0,
                            deaths: match.i8 || 0,
                            assists: match.i7 || 0,
                            headshots: match.i13 || 0,
                            kd_ratio: match.c2 || 0,
                            mvps: match.i9 || 0
                        });
                    });

                    if (lastMatchBeforeToday?.eloValue) {
                        const eloChange = calculateEloChange(todayMatches.end_elo, lastMatchBeforeToday.eloValue);
                        todayMatches.elo = eloChange > 0 ? `+${eloChange}` : eloChange.toString();
                    }

                    todayMatches.report = todayMatchesDetailed.reverse().map(match =>
                        `${match.result} ${match.score} ${getBeautifulMapName(match.map)}` +
                        (match.elo_change !== 0 && match.elo_change !== "0" ? ` (${match.elo_change})` : '')
                    ).join(', ');

                    if (todayMatchesDetailed.length > 0) {
                        const lastMatch = todayMatchesDetailed[0];
                        const hsPercentage = calculateHSPercentage(lastMatch.headshots, lastMatch.kills);

                        todayMatches.last_match =
                            `${lastMatch.result === 'WIN' ? 'Victory' : 'Defeat'} on ${getBeautifulMapName(lastMatch.map)} (${lastMatch.score}), ` +
                            `KAD: ${lastMatch.kills}/${lastMatch.assists}/${lastMatch.deaths} ` +
                            `KDR: ${lastMatch.kd_ratio} HS: ${hsPercentage}% ` +
                            `MVP: ${lastMatch.mvps}` +
                            (lastMatch.elo_change !== "0" ? ` ELO: ${lastMatch.elo_change}` : '');
                    }

                    const expectedTotalChange = calculateEloChange(todayMatches.end_elo, todayMatches.start_elo);
                    if (Math.abs(parseInt(todayMatches.elo) - expectedTotalChange) > 2) {
                        const logLevel = todayMatches.start_elo === 0 ? 'info' : 'warn';
                        log(logLevel, 'today:elo-reconciled', {
                            calculated: parseInt(todayMatches.elo),
                            expected: expectedTotalChange,
                            start: todayMatches.start_elo,
                            end: todayMatches.end_elo
                        });
                        todayMatches.elo = expectedTotalChange > 0 ? `+${expectedTotalChange}` : expectedTotalChange.toString();
                    }
                }
            } else {
                const bodyPreview = await todayResponse.text().catch(() => '');
                log('warn', 'deep-stats:failed', {
                    status: todayResponse.status,
                    statusText: todayResponse.statusText,
                    contentType: todayResponse.headers.get('content-type'),
                    bodyPreview: bodyPreview.slice(0, 500)
                });
            }
        } catch (e) {
            log('error', 'deep-stats:error', {
                message: e.message,
                stack: e.stack
            });
        }

        const statsResponse = await fetchWithAuth(
            `https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`
        );

        if (!statsResponse.ok) {
            log('warn', 'lifetime-stats:failed', {
                status: statsResponse.status,
                statusText: statsResponse.statusText
            });
            throw new Error('Ошибка получения статистики');
        }
        const statsData = await statsResponse.json();

        const matchesResponse = await fetchWithAuth(
            `https://open.faceit.com/data/v4/players/${playerId}/games/cs2/stats?offset=0&limit=50`
        );
        const historyResponse = await fetchWithAuth(
            `https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&offset=0&limit=50`
        );

        const last30Stats = { wins: 0, losses: 0, matches_count: 0 };
        let lastMatches = [];
        let premadeMatches = [];
        let last5MatchesTrend = '';

        if (matchesResponse.ok) {
            const matchesData = await matchesResponse.json();

            log('info', 'last-matches:loaded', {
                count: matchesData.items?.length || 0,
                firstStatsKeys: matchesData.items?.[0]?.stats ? Object.keys(matchesData.items[0].stats).slice(0, 40) : []
            });

            lastMatches = matchesData.items.slice(0, 50).map(match => ({
                match_id: match.match_id || match.stats['Match Id'],
                date: match.date || match.started_at || match.finished_at || match.stats['Match Finished At'] || match.stats['Created At'],
                result: match.stats.Result,
                score: formatScore(match.stats.Score || match.stats['Final Score'] || match.stats['Match Score']),
                map: match.stats.Map || match.stats.map || match.stats['Map Name'] || 'Unknown',
                kills: parseInt(match.stats.Kills) || 0,
                deaths: parseInt(match.stats.Deaths) || 0,
                assists: parseInt(match.stats.Assists) || 0,
                kd_ratio: parseFloat(match.stats['K/D Ratio']) || 0,
                hs_percent: parseFloat(match.stats['Headshots %']) || 0,
                rating: parseFloat(match.stats.Rating) || 0,
                mvps: parseInt(match.stats.MVPs) || 0,
                headshots: parseInt(match.stats.Headshots) || 0,
                adr: parseFloat(match.stats.ADR) || 0,
                rounds: parseInt(match.stats.Rounds) || 0
            }));
            premadeMatches = lastMatches;

            const last5 = lastMatches.slice(0, 5);
            last5MatchesTrend = last5.map(m => m.result === '1' ? 'W' : 'L').reverse().join('');

            last30Stats.matches_count = lastMatches.length;

            const totals = lastMatches.reduce((acc, match) => ({
                kills: acc.kills + match.kills,
                deaths: acc.deaths + match.deaths,
                kdRatio: acc.kdRatio + match.kd_ratio,
                adr: acc.adr + match.adr,
                hsPercent: acc.hsPercent + match.hs_percent,
                rounds: acc.rounds + match.rounds,
                wins: acc.wins + (match.result === '1' ? 1 : 0),
                losses: acc.losses + (match.result === '0' ? 1 : 0)
            }), { kills: 0, deaths: 0, kdRatio: 0, adr: 0, hsPercent: 0, rounds: 0, wins: 0, losses: 0 });

            last30Stats.wins = totals.wins;
            last30Stats.losses = totals.losses;
            last30Stats.avg_kills = (totals.kills / last30Stats.matches_count).toFixed(0);
            last30Stats.avg_kd = (totals.kdRatio / last30Stats.matches_count).toFixed(2);
            last30Stats.avg_kr = (totals.kills / totals.rounds).toFixed(2);
            last30Stats.avg_adr = (totals.adr / last30Stats.matches_count).toFixed(2);
            last30Stats.avg_hs = (totals.hsPercent / last30Stats.matches_count).toFixed(0);
            last30Stats.winrate_30 = ((totals.wins / last30Stats.matches_count) * 100).toFixed(0);

            if (!allMatchesReport && lastMatches.length > 0) {
                const fallbackLast5 = lastMatches.slice(0, 5);
                allMatchesReport = fallbackLast5.map(match =>
                    `${match.result === '1' ? 'WIN' : 'LOSE'} ${match.score} ${getBeautifulMapName(match.map)}`
                ).join(', ');

                const lastMatch = lastMatches[0];
                allMatchesLastMatch =
                    `${lastMatch.result === '1' ? 'Victory' : 'Defeat'} on ${getBeautifulMapName(lastMatch.map)} (${lastMatch.score}), ` +
                    `KAD: ${lastMatch.kills}/${lastMatch.assists}/${lastMatch.deaths} ` +
                    `KDR: ${lastMatch.kd_ratio} HS: ${lastMatch.hs_percent}% ` +
                    `MVP: ${lastMatch.mvps}`;

                log('warn', 'deep-stats:fallback-used', {
                    source: 'open-api-last-matches',
                    reportReady: Boolean(allMatchesReport),
                    lastMatchReady: Boolean(allMatchesLastMatch),
                    eloChangesAvailable: false
                });
            }

            if (!todayMatches.present && lastMatches.length > 0) {
                const todayStrFallback = new Date().toLocaleDateString('ru-RU');
                const fallbackTodayMatches = lastMatches.filter(match => {
                    const matchDate = parseFaceitDate(match.date);
                    return matchDate && matchDate.toLocaleDateString('ru-RU') === todayStrFallback;
                });

                if (fallbackTodayMatches.length > 0) {
                    todayMatches.present = true;
                    todayMatches.count = fallbackTodayMatches.length;
                    todayMatches.win = fallbackTodayMatches.filter(match => match.result === '1').length;
                    todayMatches.lose = fallbackTodayMatches.filter(match => match.result === '0').length;
                    todayMatches.start_elo = todayMatches.end_elo;
                    todayMatches.elo = "0";
                    todayMatches.report = fallbackTodayMatches.map(match =>
                        `${match.result === '1' ? 'WIN' : 'LOSE'} ${match.score} ${getBeautifulMapName(match.map)}`
                    ).join(', ');

                    const lastMatch = fallbackTodayMatches[0];
                    todayMatches.last_match =
                        `${lastMatch.result === '1' ? 'Victory' : 'Defeat'} on ${getBeautifulMapName(lastMatch.map)} (${lastMatch.score}), ` +
                        `KAD: ${lastMatch.kills}/${lastMatch.assists}/${lastMatch.deaths} ` +
                        `KDR: ${lastMatch.kd_ratio} HS: ${lastMatch.hs_percent}% ` +
                        `MVP: ${lastMatch.mvps}`;

                    log('warn', 'today:fallback-used', {
                        source: 'open-api-last-matches',
                        count: todayMatches.count,
                        wins: todayMatches.win,
                        losses: todayMatches.lose,
                        eloChangesAvailable: false
                    });
                }
            }
        } else {
            log('warn', 'last-matches:failed', {
                status: matchesResponse.status,
                statusText: matchesResponse.statusText
            });
        }

        if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            const statsByMatchId = new Map(lastMatches.map(match => [match.match_id, match]));
            const historyItems = historyData.items || [];

            log('info', 'history:loaded', {
                count: historyItems.length,
                firstKeys: historyItems[0] ? Object.keys(historyItems[0]).slice(0, 30) : []
            });

            premadeMatches = historyItems.slice(0, 50)
                .map(match => {
                    const matchId = match.match_id || match.matchId || match.id;
                    const statsMatch = statsByMatchId.get(matchId) || {};
                    const playerFaction = Object.entries(match.teams || {}).find(([, team]) =>
                        (team.players || []).some(player => player.player_id === playerId || player.player_id === playerData.player_id)
                    );
                    const factionKey = playerFaction?.[0];
                    const winner = match.results?.winner;
                    const result = statsMatch.result || (winner && factionKey ? (winner === factionKey ? '1' : '0') : '0');

                    return {
                        match_id: matchId,
                        date: statsMatch.date || match.finished_at || match.started_at || match.date,
                        result,
                        score: statsMatch.score || formatHistoryScore(match.results?.score || match.results?.final_score),
                        map: statsMatch.map || match.voting?.map?.pick?.[0] || match.voting?.map?.entities?.[0]?.game_map_id || 'Unknown',
                        kills: statsMatch.kills || 0,
                        deaths: statsMatch.deaths || 0,
                        assists: statsMatch.assists || 0,
                        kd_ratio: statsMatch.kd_ratio || 0,
                        hs_percent: statsMatch.hs_percent || 0,
                        rating: statsMatch.rating || 0,
                        mvps: statsMatch.mvps || 0,
                        headshots: statsMatch.headshots || 0,
                        adr: statsMatch.adr || 0,
                        rounds: statsMatch.rounds || 0
                    };
                })
                .filter(match => match.match_id);
        } else {
            log('warn', 'history:failed', {
                status: historyResponse.status,
                statusText: historyResponse.statusText
            });
        }

        log('info', 'request:result-summary', {
            reportReady: Boolean(allMatchesReport),
            lastMatchReady: Boolean(allMatchesLastMatch),
            allMatchesDetailedCount: allMatchesDetailed.length,
            todayPresent: todayMatches.present,
            todayCount: todayMatches.count,
            lastMatchesCount: lastMatches.length
        });

        const currentLevel = playerData.games?.cs2?.skill_level || 0;
        const currentElo = playerData.games?.cs2?.faceit_elo || 0;
        const last5Matches = lastMatches.slice(0, 5);
        const last10Matches = lastMatches.slice(0, 10);
        const todayStrForSession = new Date().toLocaleDateString('ru-RU');
        const openApiTodayMatches = lastMatches.filter(match => {
            const matchDate = parseFaceitDate(match.date);
            return matchDate && matchDate.toLocaleDateString('ru-RU') === todayStrForSession;
        });
        const sessionSourceMatches = openApiTodayMatches.length
            ? openApiTodayMatches
            : todayMatchesDetailed.map(match => ({
                ...match,
                result: match.result,
                hs_percent: calculateHSPercentage(match.headshots, match.kills)
            }));
        const sessionStats = calculateMatchAverages(sessionSourceMatches);
        const last5Stats = calculateMatchAverages(last5Matches);
        const last10Stats = calculateMatchAverages(last10Matches);
        const last5EloChange = allMatchesDetailed
            .slice(0, 5)
            .reduce((sum, match) => sum + (parseInt(match.elo_change || 0) || 0), 0);
        const form = {
            last5: last5MatchesTrend,
            last5_winrate: last5Stats.winrate,
            last10_winrate: last10Stats.winrate,
            last5_elo: last5EloChange > 0 ? `+${last5EloChange}` : last5EloChange.toString(),
            current_streak: getCurrentStreak(lastMatches)
        };
        const nextLevel = getNextLevelProgress(currentElo, currentLevel, nextRankingTarget);
        const maps = getMapSummaries(statsData.segments);
        const mapRecommendation = {
            pick: maps.recommended[0] || null,
            avoid: maps.worst || null,
            top3: maps.recommended
        };
        const bestMapText = maps.best
            ? `${maps.best.name}: ${maps.best.score} score, ${maps.best.winrate} WR, ${maps.best.kd} KD, ${maps.best.adr} ADR`
            : "No map data";
        const worstMapText = maps.worst
            ? `${maps.worst.name}: ${maps.worst.score} score, ${maps.worst.winrate} WR, ${maps.worst.kd} KD, ${maps.worst.adr} ADR`
            : "No map data";
        const bestMatchToday = sessionSourceMatches.length
            ? sessionSourceMatches
                .map(match => ({
                    result: normalizeResult(match.result),
                    score: match.score,
                    map: match.map,
                    kills: parseInt(match.kills || 0),
                    deaths: parseInt(match.deaths || 0),
                    assists: parseInt(match.assists || 0),
                    kd_ratio: parseFloat(match.kd_ratio || 0),
                    adr: parseFloat(match.adr || 0),
                    mvps: parseInt(match.mvps || 0),
                    performance_score: getMatchPerformanceScore(match)
                }))
                .sort((a, b) => b.performance_score - a.performance_score)[0]
            : null;
        const peakToday = getPeakToday(allMatchesDetailed, currentElo, todayStrForSession);
        const tiltMeter = getTiltMeter(lastMatches, allMatchesDetailed);
        const eloChangesByMatchId = new Map(
            allMatchesDetailed
                .filter(match => match.match_id)
                .map(match => [match.match_id, parseInt(match.elo_change || 0) || 0])
        );
        const eloChangesBySignature = new Map(
            allMatchesDetailed
                .filter(match => match.signature)
                .map(match => [match.signature, parseInt(match.elo_change || 0) || 0])
        );
        const premades = premadesMode
            ? await calculatePremades(premadeMatches.length ? premadeMatches : lastMatches, playerId, {
                minSharedMatches: request.query.premades_min,
                minComboMatches: request.query.premades_combo_min,
                eloChangesByMatchId,
                eloChangesBySignature
            })
            : null;
        const commandBaseUrl = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers.host || 'faceitapi.vercel.app'}/api/faceit`;
        const widgetBaseUrl = commandBaseUrl.replace('/api/faceit', '/api/widget');
        const makeStreamElementsCommand = (preset) =>
            `$(eval const data = '$(customapi ${commandBaseUrl}?nick=$(querystring)&preset=${preset})'; data.includes('500') || data.includes('Error') ? 'Player not found' : data)`;
        const makeNightbotAddcom = (command, preset) =>
            `!addcom !${command} $(eval const data = '$(customapi ${commandBaseUrl}?nick=$(querystring)&preset=${preset})'; data.includes('500') || data.includes('Error') ? 'Player not found' : data)`;
        const commandExamples = {
            streamelements_elo: makeStreamElementsCommand('elo'),
            streamelements_last: makeStreamElementsCommand('last'),
            streamelements_stats: makeStreamElementsCommand('stats'),
            direct_elo: `${commandBaseUrl}?nick=${encodeURIComponent(nickname)}&preset=elo`,
            direct_widget: `${widgetBaseUrl}?nick=${encodeURIComponent(nickname)}`,
            widgets: {
                main: `${widgetBaseUrl}?nick=${encodeURIComponent(nickname)}`,
                last: `${widgetBaseUrl}?nick=${encodeURIComponent(nickname)}&type=last`,
                maps: `${widgetBaseUrl}?nick=${encodeURIComponent(nickname)}&type=maps`,
                form: `${widgetBaseUrl}?nick=${encodeURIComponent(nickname)}&type=form`,
                rank: `${widgetBaseUrl}?nick=${encodeURIComponent(nickname)}&type=rank`,
                premades: `${widgetBaseUrl}?nick=${encodeURIComponent(nickname)}&type=premades`
            },
            nightbot_addcom: {
                elo: makeNightbotAddcom('elo', 'elo'),
                today: makeNightbotAddcom('today', 'today'),
                session: makeNightbotAddcom('session', 'session'),
                last: makeNightbotAddcom('last', 'last'),
                report: makeNightbotAddcom('report', 'report'),
                stats: makeNightbotAddcom('stats', 'stats'),
                form: makeNightbotAddcom('form', 'form'),
                next_level: makeNightbotAddcom('nextlevel', 'next_level'),
                rank_progress: makeNightbotAddcom('rank', 'rank_progress'),
                maps: makeNightbotAddcom('maps', 'maps'),
                map_pick: makeNightbotAddcom('mappick', 'map_pick'),
                peak_today: makeNightbotAddcom('peak', 'peak_today'),
                best_match_today: makeNightbotAddcom('besttoday', 'best_match_today'),
                tilt: makeNightbotAddcom('tilt', 'tilt')
            }
        };
        const todayShort = `${todayMatches.win}W/${todayMatches.lose}L ${todayMatches.elo}`;
        const nextLevelText = nextLevel.next_level === "top" && nextLevel.available
            ? `TOP #${regionRanking || 'N/A'} -> #${nextLevel.target_top || 'N/A'}: ${nextLevel.elo_needed} ELO left${nextLevel.target_nickname ? ` (${nextLevel.target_nickname})` : ''}`
            : nextLevel.next_level === "top"
            ? `TOP #${regionRanking || 'N/A'}: next target unavailable`
            : nextLevel.next_level
            ? `LVL ${nextLevel.current_level}->${nextLevel.next_level}: ${nextLevel.elo_needed} ELO left`
            : `LVL ${nextLevel.current_level}: max level`;
        const presets = {
            elo: `LVL: ${currentLevel}, ELO: ${currentElo} (#${regionRanking || 'N/A'}), TREND: ${last5MatchesTrend}, TODAY: ${todayMatches.elo}`,
            today: `TODAY: ${todayMatches.count} MATCHES, ${todayMatches.win} W, ${todayMatches.lose} L, ${todayMatches.elo} ELO`,
            session: `SESSION: ${sessionStats.matches} MATCHES, ${sessionStats.wins} W, ${sessionStats.losses} L, ${sessionStats.winrate} WR, ${sessionStats.avg_kd} KD, ${sessionStats.avg_adr} ADR, ${todayMatches.elo} ELO`,
            last: allMatchesLastMatch || "No last match data",
            report: allMatchesReport || "No report data",
            stats: `LAST ${last30Stats.matches_count} MATCHES STATS: ${last30Stats.wins} W, ${last30Stats.losses} L, ${last30Stats.winrate_30 || 0}% WR, ${last30Stats.avg_kills || 0} AVG, ${last30Stats.avg_kd || 0} KD, ${last30Stats.avg_kr || 0} KR, ${last30Stats.avg_adr || 0} ADR, ${last30Stats.avg_hs || 0}% HS`,
            form: `FORM: ${form.last5 || 'N/A'}, STREAK: ${form.current_streak || 'N/A'}, LAST 5 WR: ${form.last5_winrate}, LAST 10 WR: ${form.last10_winrate}`,
            next_level: nextLevelText,
            rank_progress: rankProgress.length ? rankProgress.map(target => target.available ? `TOP ${target.target_top}: ${target.elo_needed} ELO left` : `TOP ${target.target_top}: unavailable`).join(' | ') : nextLevelText,
            maps: `BEST MAP: ${bestMapText} | WORST MAP: ${worstMapText}`,
            best_map: bestMapText,
            worst_map: worstMapText,
            map_pick: mapRecommendation.pick ? `PICK: ${mapRecommendation.pick.name} (${mapRecommendation.pick.score} score, ${mapRecommendation.pick.winrate} WR)` : "No map data",
            peak_today: `PEAK TODAY: ${peakToday.peak_elo} ELO (${peakToday.current_from_peak >= 0 ? '+' : ''}${peakToday.current_from_peak} from peak)`,
            best_match_today: bestMatchToday ? `BEST TODAY: ${bestMatchToday.result} ${bestMatchToday.score} ${getBeautifulMapName(bestMatchToday.map)} ${bestMatchToday.kills}/${bestMatchToday.assists}/${bestMatchToday.deaths}, ${bestMatchToday.kd_ratio} KD` : "No matches today",
            tilt: `TILT: ${tiltMeter.status.toUpperCase()} (${tiltMeter.score}/100), ${tiltMeter.last5_losses}L last 5, ${tiltMeter.last5_avg_kd} KD`,
            premades: premades?.best ? `BEST PREMADE: ${premades.best.label}, ${premades.best.matches}M, ${premades.best.winrate} WR, ${premades.best.avg_kd} KD, ${premades.best.score} score` : "Premades data unavailable",
            avatar: playerData.avatar || "",
            cover: playerData.cover_image || "",
            fullbar: `LVL ${currentLevel} | ${currentElo} ELO | ${todayShort} | ${form.last5 || 'N/A'} | ${allMatchesLastMatch || 'No last match data'}`
        };

        const result = {
            nickname,
            player_id: playerId,
            api: {
                lvl: currentLevel,
                elo: currentElo,
                top: regionRanking,
                trend: last5MatchesTrend,
                last_30_stats: {
                    matches: last30Stats.matches_count,
                    winrate: `${last30Stats.winrate_30 || 0}%`,
                    avg_kills: last30Stats.avg_kills || 0,
                    avg_kd: last30Stats.avg_kd || 0,
                    avg_kr: last30Stats.avg_kr || 0,
                    avg_adr: last30Stats.avg_adr || 0,
                    avg_hs: `${last30Stats.avg_hs || 0}%`,
                    wins: last30Stats.wins,
                    losses: last30Stats.losses
                },
                today: todayMatches,
                session_stats: sessionStats,
                form,
                next_level: nextLevel,
                rank_progress: rankProgress,
                peak_today: peakToday,
                best_match_today: bestMatchToday,
                tilt_meter: tiltMeter,
                premades,
                maps,
                map_recommendation: mapRecommendation,
                command_examples: commandExamples,
                presets,
                report: allMatchesReport,
                last_match: allMatchesLastMatch
            },
            player_info: {
                avatar: playerData.avatar,
                cover: playerData.cover_image,
                country: playerData.country,
                steam_id_64: playerData.steam_id_64,
                memberships: playerData.memberships
            },
            faceit_stats: {
                skill_level: playerData.games?.cs2?.skill_level || 0,
                faceit_elo: playerData.games?.cs2?.faceit_elo || 0,
                region: playerData.games?.cs2?.region,
                game_player_id: playerData.games?.cs2?.game_player_id,
                region_ranking: regionRanking
            },
            lifetime_stats: {
                win_rate: statsData.lifetime['Win Rate %'],
                current_win_streak: statsData.lifetime['Current Win Streak'],
                average_headshots: statsData.lifetime['Average Headshots %'],
                kd_ratio: statsData.lifetime['Average K/D Ratio'] || statsData.lifetime['K/D Ratio'],
                matches: statsData.lifetime.Matches,
                average_kills: statsData.lifetime['Average Kills'],
                average_deaths: statsData.lifetime['Average Deaths'],
                average_assists: statsData.lifetime['Average Assists'],
                average_mvps: statsData.lifetime['Average MVPs']
            },
            last_matches: lastMatches,
            all_matches_detailed: allMatchesDetailed,
            all_stats: statsData,
            all_player_data: playerData
        };
        const responseResult = compactMode
            ? {
                nickname: result.nickname,
                player_id: result.player_id,
                api: result.api,
                player_info: result.player_info,
                faceit_stats: result.faceit_stats,
                lifetime_stats: result.lifetime_stats,
                last_matches: result.last_matches.slice(0, 5)
            }
            : result;

        const findValueInObject = (obj, searchKey) => {
            if (obj.hasOwnProperty(searchKey)) return obj[searchKey];

            for (const key in obj) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    const found = findValueInObject(obj[key], searchKey);
                    if (found !== undefined) return found;
                }
            }
            return undefined;
        };

        if (presetName) {
            const presetOutput = findValueInObject(result.api.presets, presetName);
            response.status(presetOutput === undefined ? 404 : 200).send(presetOutput ?? `Unknown preset: ${presetName}`);
            return;
        }

        if (viewTemplate) {
            const findValueInObject = (obj, searchKey) => {
                if (obj.hasOwnProperty(searchKey)) return obj[searchKey];

                for (const key in obj) {
                    if (typeof obj[key] === 'object' && obj[key] !== null) {
                        const found = findValueInObject(obj[key], searchKey);
                        if (found !== undefined) return found;
                    }
                }
                return undefined;
            };

            const textOutput = viewTemplate.replace(/\{([\w.]+)\}/g, (_, key) => {
                if (fullMode) {
                    return key.split('.').reduce((obj, k) => obj?.[k], responseResult) ?? `{${key}}`;
                } else {
                    if (key.includes('.')) {
                        const parts = key.split('.');
                        return parts.reduce((obj, k) => obj?.[k], responseResult.api) ?? `{${key}}`;
                    } else {
                        return findValueInObject(responseResult.api, key) ?? `{${key}}`;
                    }
                }
            });

            response.status(200).send(textOutput);
            return;
        }

        if (fullMode) {
            response.status(200).json(responseResult);
        } else {
            const { nickname, player_id, api } = responseResult;
            response.status(200).json({ nickname, player_id, api });
        }

    } catch (error) {
        log('error', 'request:error', {
            message: error.message,
            stack: error.stack
        });

        response.status(500).json({
            error: 'Не удалось получить данные',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}

