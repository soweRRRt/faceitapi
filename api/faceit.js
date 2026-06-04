export default async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET');

    const { nick: nickname, view: viewTemplate, preset: presetName } = request.query;
    const fullMode = 'full' in request.query;
    const compactMode = 'compact' in request.query;
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
                        log('warn', 'today:elo-mismatch', {
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
            `https://open.faceit.com/data/v4/players/${playerId}/games/cs2/stats?offset=0&limit=30`
        );

        const last30Stats = { wins: 0, losses: 0, matches_count: 0 };
        let lastMatches = [];
        let last5MatchesTrend = '';

        if (matchesResponse.ok) {
            const matchesData = await matchesResponse.json();

            log('info', 'last-matches:loaded', {
                count: matchesData.items?.length || 0,
                firstStatsKeys: matchesData.items?.[0]?.stats ? Object.keys(matchesData.items[0].stats).slice(0, 40) : []
            });

            lastMatches = matchesData.items.slice(0, 30).map(match => ({
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
        const form = {
            last5: last5MatchesTrend,
            last5_winrate: last5Stats.winrate,
            last10_winrate: last10Stats.winrate,
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
        const commandBaseUrl = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers.host || 'faceitapi.vercel.app'}/api/faceit`;
        const commandExamples = {
            streamelements_elo: `$(eval const data = '$(customapi ${commandBaseUrl}?nick=$(querystring)&preset=elo)'; data.includes('500') || data.includes('Error') ? 'Player not found' : data)`,
            streamelements_last: `$(eval const data = '$(customapi ${commandBaseUrl}?nick=$(querystring)&preset=last)'; data.includes('500') || data.includes('Error') ? 'Player not found' : data)`,
            streamelements_stats: `$(eval const data = '$(customapi ${commandBaseUrl}?nick=$(querystring)&preset=stats)'; data.includes('500') || data.includes('Error') ? 'Player not found' : data)`,
            direct_elo: `${commandBaseUrl}?nick=${encodeURIComponent(nickname)}&preset=elo`,
            direct_widget: `${commandBaseUrl.replace('/api/faceit', '/api/widget')}?nick=${encodeURIComponent(nickname)}`
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

