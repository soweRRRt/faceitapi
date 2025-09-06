// export default async function handler(request, response) {
//   response.setHeader('Access-Control-Allow-Origin', '*');
//   response.setHeader('Access-Control-Allow-Methods', 'GET');

//   const nickname = request.query.nick;
//   const FACEIT_API_KEY = process.env.FACEIT_API_KEY;

//   try {
//     const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`, {
//       headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
//     });

//     if (!playerResponse.ok) throw new Error('Ошибка получения player_id');
//     const playerData = await playerResponse.json();
//     const playerId = playerData.player_id;

//     const statsResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`, {
//       headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
//     });

//     if (!statsResponse.ok) throw new Error('Ошибка получения статистики');
//     const statsData = await statsResponse.json();

//     const matchesResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/games/cs2/stats?offset=0&limit=30`, {
//       headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
//     });

//     let lastMatches = [];
//     let last5MatchesTrend = '';
//     let last30Stats = {
//       total_kills: 0,
//       total_deaths: 0,
//       total_assists: 0,
//       total_mvps: 0,
//       total_headshots: 0,
//       total_rounds: 0,
//       wins: 0,
//       losses: 0,
//       matches_count: 0
//     };

//     if (matchesResponse.ok) {
//       const matchesData = await matchesResponse.json();
//       lastMatches = matchesData.items.slice(0, 30).map(match => ({
//         match_id: match.match_id,
//         date: match.date,
//         result: match.stats.Result,
//         kills: parseInt(match.stats.Kills) || 0,
//         deaths: parseInt(match.stats.Deaths) || 0,
//         assists: parseInt(match.stats.Assists) || 0,
//         kd_ratio: parseFloat(match.stats['K/D Ratio']) || 0,
//         hs_percent: parseFloat(match.stats['Headshots %']) || 0,
//         rating: parseFloat(match.stats.Rating) || 0,
//         mvps: parseInt(match.stats.MVPs) || 0,
//         headshots: parseInt(match.stats.Headshots) || 0,
//         adr: parseFloat(match.stats['Average Damage']) || 0,
//         rounds: parseInt(match.stats.Rounds) || 0
//       }));

//       const last5 = lastMatches.slice(0, 5);
//       last5MatchesTrend = last5.reverse().map(match =>
//         match.result === '1' ? 'W' : 'L'
//       ).join('');

//       last30Stats.matches_count = lastMatches.length;

//       lastMatches.forEach(match => {
//         last30Stats.total_kills += match.kills;
//         last30Stats.total_deaths += match.deaths;
//         last30Stats.total_assists += match.assists;
//         last30Stats.total_mvps += match.mvps;
//         last30Stats.total_headshots += match.headshots;
//         last30Stats.total_rounds += match.rounds;

//         if (match.result === '1') {
//           last30Stats.wins++;
//         } else {
//           last30Stats.losses++;
//         }
//       });
//     }

//     const avg_kills = last30Stats.matches_count > 0 ? (last30Stats.total_kills / last30Stats.matches_count).toFixed(0) : 0;
//     const avg_kd = last30Stats.matches_count > 0 ? (last30Stats.total_kills / last30Stats.total_deaths).toFixed(2) : 0;
//     const avg_adr = last30Stats.matches_count > 0 ? (last30Stats.total_kills * 100 / last30Stats.total_rounds).toFixed(1) : 0;
//     const avg_hs = last30Stats.matches_count > 0 ? ((last30Stats.total_headshots / last30Stats.total_kills) * 100).toFixed(0) : 0;
//     const winrate_30 = last30Stats.matches_count > 0 ? ((last30Stats.wins / last30Stats.matches_count) * 100).toFixed(0) : 0;

//     const result = {
//       nickname: nickname,
//       player_id: playerId,
//       api: {
//         lvl: playerData.games?.cs2?.skill_level || 0,
//         elo: playerData.games?.cs2?.faceit_elo || 0,
//         last_5_matches: last5MatchesTrend,
//         last_30_stats: {
//           matches: last30Stats.matches_count,
//           winrate: `${winrate_30}%`,
//           avg_kills: avg_kills,
//           avg_kd: avg_kd,
//           avg_adr: avg_adr,
//           avg_hs: `${avg_hs}%`,
//           wins: last30Stats.wins,
//           losses: last30Stats.losses
//         }
//       },
//       player_info: {
//         avatar: playerData.avatar,
//         country: playerData.country,
//         steam_id_64: playerData.steam_id_64,
//         memberships: playerData.memberships
//       },
//       faceit_stats: {
//         skill_level: playerData.games?.cs2?.skill_level || 0,
//         faceit_elo: playerData.games?.cs2?.faceit_elo || 0,
//         region: playerData.games?.cs2?.region,
//         game_player_id: playerData.games?.cs2?.game_player_id
//       },
//       lifetime_stats: {
//         win_rate: statsData.lifetime['Win Rate %'],
//         current_win_streak: statsData.lifetime['Current Win Streak'],
//         average_headshots: statsData.lifetime['Average Headshots %'],
//         kd_ratio: statsData.lifetime['K/D Ratio'],
//         matches: statsData.lifetime.Matches,
//         average_kills: statsData.lifetime['Average Kills'],
//         average_deaths: statsData.lifetime['Average Deaths'],
//         average_assists: statsData.lifetime['Average Assists'],
//         average_mvps: statsData.lifetime['Average MVPs']
//       },
//       last_matches: lastMatches,
//       all_stats: statsData,
//       all_player_data: playerData
//     };

//     response.status(200).json(result);

//   } catch (error) {
//     response.status(500).json({
//       error: 'Не удалось получить данные',
//       message: error.message,
//       stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
//     });
//   }
// }

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');

  const nickname = request.query.nick;
  const FACEIT_API_KEY = process.env.FACEIT_API_KEY;

  try {
    const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`, {
      headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
    });

    if (!playerResponse.ok) throw new Error('Ошибка получения player_id');
    const playerData = await playerResponse.json();
    const playerId = playerData.player_id;

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
    let last30Stats = {
      wins: 0,
      losses: 0,
      matches_count: 0
    };

    // if (matchesResponse.ok) {
    //   const matchesData = await matchesResponse.json();
    //   lastMatches = matchesData.items.slice(0, 30).map(match => ({
    //     match_id: match.match_id,
    //     date: match.date,
    //     result: match.stats.Result,
    //     kills: parseInt(match.stats.Kills) || 0,
    //     deaths: parseInt(match.stats.Deaths) || 0,
    //     assists: parseInt(match.stats.Assists) || 0,
    //     kd_ratio: parseFloat(match.stats['K/D Ratio']) || 0,
    //     hs_percent: parseFloat(match.stats['Headshots %']) || 0,
    //     rating: parseFloat(match.stats.Rating) || 0,
    //     mvps: parseInt(match.stats.MVPs) || 0,
    //     headshots: parseInt(match.stats.Headshots) || 0,
    //     adr: parseFloat(match.stats['Average Damage']) || 0,
    //     rounds: parseInt(match.stats.Rounds) || 0
    //   }));

    //   // Формируем trend последних 5 матчей (последний матч справа)
    //   const last5 = lastMatches.slice(0, 5);
    //   last5MatchesTrend = last5.map(match => 
    //     match.result === '1' ? 'W' : 'L'
    //   ).reverse().join('');

    //   // Считаем статистику за последние 30 матчей
    //   last30Stats.matches_count = lastMatches.length;

    //   let totalKills = 0;
    //   let totalDeaths = 0;
    //   let totalAssists = 0;
    //   let totalHeadshots = 0;
    //   let totalRounds = 0;
    //   let totalADR = 0;

    //   lastMatches.forEach(match => {
    //     totalKills += match.kills;
    //     totalDeaths += match.deaths;
    //     totalAssists += match.assists;
    //     totalHeadshots += match.headshots;
    //     totalRounds += match.rounds;
    //     totalADR += match.adr;

    //     if (match.result === '1') {
    //       last30Stats.wins++;
    //     } else {
    //       last30Stats.losses++;
    //     }
    //   });

    //   // Правильные расчеты с проверкой деления на ноль
    //   const avg_kills = last30Stats.matches_count > 0 ? (totalKills / last30Stats.matches_count).toFixed(0) : 0;
    //   const avg_kd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills > 0 ? totalKills.toFixed(2) : 0;
    //   const avg_kr = totalRounds > 0 ? (totalKills / totalRounds).toFixed(2) : 0;
    //   const avg_adr = last30Stats.matches_count > 0 ? (totalADR / last30Stats.matches_count).toFixed(1) : 0;
    //   const avg_hs = totalKills > 0 ? ((totalHeadshots / totalKills) * 100).toFixed(0) : 0;
    //   const winrate_30 = last30Stats.matches_count > 0 ? ((last30Stats.wins / last30Stats.matches_count) * 100).toFixed(0) : 0;

    //   // Сохраняем расчеты для использования в ответе
    //   last30Stats.avg_kills = avg_kills;
    //   last30Stats.avg_kd = avg_kd;
    //   last30Stats.avg_kr = avg_kr;
    //   last30Stats.avg_adr = avg_adr;
    //   last30Stats.avg_hs = avg_hs;
    //   last30Stats.winrate_30 = winrate_30;
    // }

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
        adr: parseFloat(match.stats['Average Damage']) || 0,
        rounds: parseInt(match.stats.Rounds) || 0
      }));

      // Формируем trend последних 5 матчей
      const last5 = lastMatches.slice(0, 5);
      last5MatchesTrend = last5.map(match =>
        match.result === '1' ? 'W' : 'L'
      ).reverse().join('');

      // Правильный расчет статистики за 30 матчей
      last30Stats.matches_count = lastMatches.length;

      let totalKills = 0;
      let totalDeaths = 0;
      let totalKDRatio = 0;
      let totalADR = 0;
      let totalHSPercent = 0;
      let totalRounds = 0;

      lastMatches.forEach(match => {
        totalKills += match.kills;
        totalDeaths += match.deaths;
        totalKDRatio += match.kd_ratio;
        totalADR += match.adr;
        totalHSPercent += match.hs_percent;
        totalRounds += match.rounds;

        if (match.result === '1') {
          last30Stats.wins++;
        } else {
          last30Stats.losses++;
        }
      });

      // Правильные расчеты
      const avg_kills = (totalKills / last30Stats.matches_count).toFixed(0);
      const avg_kd = (totalKDRatio / last30Stats.matches_count).toFixed(2);
      const avg_kr = (totalKills / totalRounds).toFixed(2);
      const avg_adr = (totalADR / last30Stats.matches_count).toFixed(2);
      const avg_hs = (totalHSPercent / last30Stats.matches_count).toFixed(0);
      const winrate_30 = ((last30Stats.wins / last30Stats.matches_count) * 100).toFixed(0);

      // Сохраняем расчеты
      last30Stats.avg_kills = avg_kills;
      last30Stats.avg_kd = avg_kd;
      last30Stats.avg_kr = avg_kr;
      last30Stats.avg_adr = avg_adr;
      last30Stats.avg_hs = avg_hs;
      last30Stats.winrate_30 = winrate_30;
    }

    const result = {
      nickname: nickname,
      player_id: playerId,
      api: {
        lvl: playerData.games?.cs2?.skill_level || 0,
        elo: playerData.games?.cs2?.faceit_elo || 0,
        last_5_matches: last5MatchesTrend,
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
        }
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

    response.status(200).json(result);

  } catch (error) {
    response.status(500).json({
      error: 'Не удалось получить данные',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}