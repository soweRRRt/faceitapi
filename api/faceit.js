export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');

  const nickname = request.query.nick;
  const viewTemplate = request.query.view;
  const fullMode = 'full' in request.query;
  const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
  const DEEP_FACEIT_API_KEY = process.env.DEEP_FACEIT_API_KEY;

  async function getMatchDetails(matchId) {
    try {
      const matchResponse = await fetch(`https://open.faceit.com/data/v4/matches/${matchId}`, {
        headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
      });

      if (matchResponse.ok) {
        const matchData = await matchResponse.json();
        return matchData;
      }
    } catch (e) {
      console.error('Ошибка получения деталей матча', e);
    }
    return null;
  }

  function getBeautifulMapName(defaultMapName) {
    console.log('Input map name:', defaultMapName);
    const result = defaultMapName.replace('de_', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    console.log('Output map name:', result);
    return result;
  }

  try {
    const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`, {
      headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
    });
    if (!playerResponse.ok) throw new Error('Ошибка получения player_id');
    const playerData = await playerResponse.json();
    const playerId = playerData.player_id;

    let todayMatches = {
      present: false,
      win: 0,
      lose: 0,
      elo: 0,
      elo_win: 0,
      elo_lose: 0,
      count: 0,
      report: "",
      last_match: ""
    };

    let lastMatchBeforeToday = null;
    let todayMatchesDetailed = [];

    try {
      const now = new Date();
      const todayStr = now.toLocaleDateString('ru-RU');
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const todayResponse = await fetch(
        `https://www.faceit.com/api/stats/v1/stats/time/users/${playerId}/games/cs2?page=0&size=30&game_mode=5v5`,
        {
          headers: { 'Authorization': `Bearer ${DEEP_FACEIT_API_KEY}` }
        }
      )

      if (todayResponse.ok) {
        const todayData = await todayResponse.json();

        const allMatches = todayData
          .filter(match => match.date)
          // .filter(match => match.date && match.elo)
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

        // console.log("todayData");
        // console.log(todayData);
        // console.log("ALL MATCHES");
        // console.log(allMatches);
        // console.log("TODAY MATCHES");
        // console.log(matchesToday);

        lastMatchBeforeToday = allMatches.find(match => {
          const matchDay = match.dateObj.toLocaleDateString('ru-RU');
          return matchDay !== todayStr && match.dateObj < todayStart;
        });

        if (lastMatchBeforeToday) {
          todayMatches.start_elo = lastMatchBeforeToday.eloValue;
        } else if (matchesToday.length > 0) {
          todayMatches.start_elo = matchesToday[matchesToday.length - 1].eloValue;
        } else {
          todayMatches.start_elo = todayMatches.end_elo;
        }

        if (matchesToday.length > 0) {
          todayMatches.present = true;
          todayMatches.count = matchesToday.length;

          const sortedMatches = matchesToday.sort((a, b) => a.date - b.date);

          sortedMatches.forEach((match, index) => {
            if (match.i10 == '1') {
              todayMatches.win++;
            } else {
              todayMatches.lose++;
            }

            let eloChange = 0;
            if (match.eloValue) {
              if (index === 0) {
                eloChange = match.eloValue - todayMatches.start_elo;
              } else {
                eloChange = match.eloValue - sortedMatches[index - 1].eloValue;
              }
            }

            // todayMatches.elo += eloChange;

            if (match.i10 === '1') {
              todayMatches.elo_win += eloChange;
            } else {
              todayMatches.elo_lose += eloChange;
            }

            todayMatchesDetailed.push({
              result: match.i10 === '1' ? 'WIN' : 'LOSE',
              score: `${(match.i18 || '0 / 0').split(' / ').map(num => parseInt(num) || 0).join(':')}`,
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

          if (lastMatchBeforeToday.eloValue) {
            todayMatches.elo = playerData.games?.cs2?.faceit_elo - lastMatchBeforeToday.eloValue;
          }

          todayMatches.report = todayMatchesDetailed.map(match =>
            `${match.result} ${match.score} ${match.map}` +
            (match.elo_change !== 0 ? ` (${match.elo_change > 0 ? '+' : ''}${match.elo_change})` : '')
          ).join(', ');

          if (todayMatchesDetailed.length > 0) {
            const lastMatch = todayMatchesDetailed[todayMatchesDetailed.length - 1];
            todayMatches.last_match = `${lastMatch.result === 'WIN' ? 'Victory' : 'Defeat'} on ${getBeautifulMapName(lastMatch.map)} (${lastMatch.score}), ` +
              `KAD: ${lastMatch.kills}/${lastMatch.assists}/${lastMatch.deaths} ` +
              `KDR: ${lastMatch.kd_ratio} HS: ${Math.round((lastMatch.headshots / lastMatch.kills) * 100) || 0}% ` +
              `MVP: ${lastMatch.mvps} ELO: ${lastMatch.elo_change > 0 ? '+' : ''}${lastMatch.elo_change}`;
          }

          const expectedTotalChange = todayMatches.end_elo - todayMatches.start_elo;
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

    const statsResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`, {
      headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
    });
    if (!statsResponse.ok) throw new Error('Ошибка получения статистики');
    const statsData = await statsResponse.json();

    const matchesResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/games/cs2/stats?offset=0&limit=30`, {
      headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
    });

    let lastMatches = [];
    let last5MatchesTrend = '';
    let last30Stats = { wins: 0, losses: 0, matches_count: 0 };

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

      let totalKills = 0, totalDeaths = 0, totalKDRatio = 0, totalADR = 0, totalHSPercent = 0, totalRounds = 0;

      lastMatches.forEach(match => {
        totalKills += match.kills;
        totalDeaths += match.deaths;
        totalKDRatio += match.kd_ratio;
        totalADR += match.adr;
        totalHSPercent += match.hs_percent;
        totalRounds += match.rounds;

        if (match.result === '1') last30Stats.wins++;
        else last30Stats.losses++;
      });

      last30Stats.avg_kills = (totalKills / last30Stats.matches_count).toFixed(0);
      last30Stats.avg_kd = (totalKDRatio / last30Stats.matches_count).toFixed(2);
      last30Stats.avg_kr = (totalKills / totalRounds).toFixed(2);
      last30Stats.avg_adr = (totalADR / last30Stats.matches_count).toFixed(2);
      last30Stats.avg_hs = (totalHSPercent / last30Stats.matches_count).toFixed(0);
      last30Stats.winrate_30 = ((last30Stats.wins / last30Stats.matches_count) * 100).toFixed(0);
    }

    const result = {
      nickname: nickname,
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
        if (obj.hasOwnProperty(searchKey)) {
          return obj[searchKey];
        }

        for (const key in obj) {
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            const found = findValueInObject(obj[key], searchKey);
            if (found !== undefined) {
              return found;
            }
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
      const minimalResult = {
        nickname: result.nickname,
        player_id: result.player_id,
        api: result.api
      };
      response.status(200).json(minimalResult);
    }

  } catch (error) {
    response.status(500).json({
      error: 'Не удалось получить данные',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
