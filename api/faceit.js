export default async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET');

    const { nick: nickname, view: viewTemplate } = request.query;
    const fullMode = 'full' in request.query;
    const { FACEIT_API_KEY, DEEP_FACEIT_API_KEY } = process.env;

    const getBeautifulMapName = (defaultMapName) => {
        return defaultMapName
            .replace('de_', '')
            .replace(/_/g, ' ')
            .replace(/(\d)/g, (digit) => {
                return 'I'.repeat(parseInt(digit));
            })
            .replace(/\b\w/g, l => l.toUpperCase());
    };

    const fetchWithAuth = (url, apiKey = FACEIT_API_KEY) => {
        return fetch(url, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
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

    try {
        const playerResponse = await fetchWithAuth(
            `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`
        );

        if (!playerResponse.ok) throw new Error('Ошибка получения player_id');

        const playerData = await playerResponse.json();
        const playerId = playerData.player_id;

        const todayMatches = {
            present: false,
            win: 0,
            lose: 0,
            elo: 0,
            elo_win: 0,
            elo_lose: 0,
            count: 0,
            report: "",
            last_match: "",
            start_elo: 0,
            end_elo: playerData.games?.cs2?.faceit_elo || 0
        };

        let lastMatchBeforeToday = null;
        let todayMatchesDetailed = [];

        try {
            const now = new Date();
            const todayStr = now.toLocaleDateString('ru-RU');
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            const todayResponse = await fetchWithAuth(
                `https://www.faceit.com/api/stats/v1/stats/time/users/${playerId}/games/cs2?page=0&size=30&game_mode=5v5`,
                DEEP_FACEIT_API_KEY
            );

            if (todayResponse.ok) {
                const todayData = await todayResponse.json();

                const allMatches = todayData
                    .filter(match => match.date)
                    .map(match => ({
                        ...match,
                        dateObj: new Date(match.date),
                        eloValue: parseInt(match.elo || 0)
                    }))
                    .sort((a, b) => b.date - a.date);

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

                if (matchesToday.length > 0) {
                    todayMatches.present = true;
                    todayMatches.count = matchesToday.length;

                    const sortedMatches = matchesToday.sort((a, b) => a.date - b.date);

                    sortedMatches.forEach((match, index) => {
                        const isWin = match.i10 === '1';
                        isWin ? todayMatches.win++ : todayMatches.lose++;

                        let eloChange = 0;
                        if (match.eloValue) {
                            const previousElo = index === 0 ? todayMatches.start_elo : sortedMatches[index - 1].eloValue;
                            eloChange = calculateEloChange(match.eloValue, previousElo);
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
                            elo_change: eloChange,
                            kills: match.i6 || 0,
                            deaths: match.i8 || 0,
                            assists: match.i7 || 0,
                            headshots: match.i13 || 0,
                            kd_ratio: match.c2 || 0,
                            mvps: match.i9 || 0
                        });
                    });

                    if (lastMatchBeforeToday?.eloValue) {
                        todayMatches.elo = calculateEloChange(todayMatches.end_elo, lastMatchBeforeToday.eloValue);
                    }

                    todayMatches.report = todayMatchesDetailed.reverse().map(match =>
                        `${match.result} ${match.score} ${getBeautifulMapName(match.map)}` +
                        (match.elo_change !== 0 ? ` (${match.elo_change > 0 ? '+' : ''}${match.elo_change})` : '')
                    ).join(', ');

                    if (todayMatchesDetailed.length > 0) {
                        const lastMatch = todayMatchesDetailed[0];
                        const hsPercentage = calculateHSPercentage(lastMatch.headshots, lastMatch.kills);

                        todayMatches.last_match =
                            `${lastMatch.result === 'WIN' ? 'Victory' : 'Defeat'} on ${getBeautifulMapName(lastMatch.map)} (${lastMatch.score}), ` +
                            `KAD: ${lastMatch.kills}/${lastMatch.assists}/${lastMatch.deaths} ` +
                            `KDR: ${lastMatch.kd_ratio} HS: ${hsPercentage}% ` +
                            `MVP: ${lastMatch.mvps} ELO: ${lastMatch.elo_change > 0 ? '+' : ''}${lastMatch.elo_change}`;
                    }

                    const expectedTotalChange = calculateEloChange(todayMatches.end_elo, todayMatches.start_elo);
                    if (Math.abs(todayMatches.elo - expectedTotalChange) > 2) {
                        console.warn('Расхождение в расчетах ELO:', {
                            calculated: todayMatches.elo,
                            expected: expectedTotalChange,
                            start: todayMatches.start_elo,
                            end: todayMatches.end_elo
                        });
                        todayMatches.elo = expectedTotalChange;
                    }
                }
            }
        } catch (e) {
            console.error('Ошибка получения сегодняшних матчей', e);
        }

        const statsResponse = await fetchWithAuth(
            `https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`
        );

        if (!statsResponse.ok) throw new Error('Ошибка получения статистики');
        const statsData = await statsResponse.json();

        const matchesResponse = await fetchWithAuth(
            `https://open.faceit.com/data/v4/players/${playerId}/games/cs2/stats?offset=0&limit=30`
        );

        const last30Stats = { wins: 0, losses: 0, matches_count: 0 };
        let lastMatches = [];
        let last5MatchesTrend = '';

        if (matchesResponse.ok) {
            const matchesData = await matchesResponse.json();

            lastMatches = matchesData.items.slice(0, 30).map(match => ({
                match_id: match.match_id,
                date: match.date,
                result: match.stats.Result,
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
        }

        const result = {
            nickname,
            player_id: playerId,
            api: {
                lvl: playerData.games?.cs2?.skill_level || 0,
                elo: playerData.games?.cs2?.faceit_elo || 0,
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
                today: todayMatches
            },
            player_info: {
                avatar: playerData.avatar,
                country: playerData.country,
                steam_id_64: playerData.steam_id_64,
                memberships: playerData.memberships
            },
            faceit_stats: {
                skill_level: playerData.games?.cs2?.skill_level || 0,
                faceit_elo: playerData.games?.cs2?.faceit_elo || 0,
                region: playerData.games?.cs2?.region,
                game_player_id: playerData.games?.cs2?.game_player_id
            },
            lifetime_stats: {
                win_rate: statsData.lifetime['Win Rate %'],
                current_win_streak: statsData.lifetime['Current Win Streak'],
                average_headshots: statsData.lifetime['Average Headshots %'],
                kd_ratio: statsData.lifetime['K/D Ratio'],
                matches: statsData.lifetime.Matches,
                average_kills: statsData.lifetime['Average Kills'],
                average_deaths: statsData.lifetime['Average Deaths'],
                average_assists: statsData.lifetime['Average Assists'],
                average_mvps: statsData.lifetime['Average MVPs']
            },
            last_matches: lastMatches,
            all_stats: statsData,
            all_player_data: playerData
        };

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
                    return key.split('.').reduce((obj, k) => obj?.[k], result) ?? `{${key}}`;
                } else {
                    if (key.includes('.')) {
                        const parts = key.split('.');
                        return parts.reduce((obj, k) => obj?.[k], result.api) ?? `{${key}}`;
                    } else {
                        return findValueInObject(result.api, key) ?? `{${key}}`;
                    }
                }
            });

            response.status(200).send(textOutput);
            return;
        }

        if (fullMode) {
            response.status(200).json(result);
        } else {
            const { nickname, player_id, api } = result;
            response.status(200).json({ nickname, player_id, api });
        }

    } catch (error) {
        response.status(500).json({
            error: 'Не удалось получить данные',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}