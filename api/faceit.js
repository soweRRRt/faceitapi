export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');

  const nickname = request.query.nick;
  const viewTemplate = request.query.view;
  const fullMode = 'full' in request.query;
  const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
  const DEEP_FACEIT_API_KEY = process.env.DEEP_FACEIT_API_KEY;

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
      count: 0
    };

    let todayData;
    let matchesToday = [];

    try {
      const now = new Date();
      // const todayStr2 = now.toISOString().split('T')[0];
      const todayStr = now.toLocaleDateString('ru-RU');

      const todayResponse = await fetch(
        `https://www.faceit.com/api/stats/v1/stats/time/users/${playerId}/games/cs2?page=0&size=30&game_mode=5v5`,
        {
          headers: { 'Authorization': `Bearer ${DEEP_FACEIT_API_KEY}` }
        }
      )

      if (todayResponse.ok) {
        todayData = await todayResponse.json();

        matchesToday = todayData.items.filter(match => {
          const matchDate = new Date(match.date * 1000);
          const matchDay = matchDate.toLocaleDateString('ru-RU');
          return matchDay === todayStr;
        });

        if (matchesToday.length > 0) {
          todayMatches.present = true;
          todayMatches.count = matchesToday.length;

          const sortedMatches = matchesToday.sort((a, b) => a.date - b.date);

          const currentElo = playerData.games?.cs2?.faceit_elo || 0;

          sortedMatches.forEach((match, index) => {
            if (match.c1 === '1') {
              todayMatches.win++;
            } else {
              todayMatches.lose++;
            }

            let eloChange = 0;
            if (index === sortedMatches.length - 1) {
              eloChange = currentElo - parseInt(match.elo || 0);
            } else {
              eloChange = parseInt(sortedMatches[index + 1].elo || 0) - parseInt(match.elo || 0);
            }

            todayMatches.elo += eloChange;

            if (match.c1 === '1') {
              todayMatches.elo_win += eloChange;
            } else {
              todayMatches.elo_lose += eloChange;
            }
          });
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

    const now = new Date();
    const nowRu = now.toLocaleDateString('ru-RU');

    const result = {
      nickname: nickname,
      player_id: playerId,
      now: nowRu,
      matchesToday: matchesToday,
      todayData: todayData,
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
      const textOutput = viewTemplate.replace(/\{([\w.]+)\}/g, (_, key) => {
        if (fullMode) {
          return key.split('.').reduce((obj, k) => obj?.[k], result) ?? `{${key}}`;
        } else {
          return result.api.last_30_stats[key] ?? result.api[key] ?? `{${key}}`;
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
