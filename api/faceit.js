// export default async function handler(request, response) {
//   response.setHeader('Access-Control-Allow-Origin', '*');
//   response.setHeader('Access-Control-Allow-Methods', 'GET');
  
//   const nickname = request.query.nick;
  
//   const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
  
//   try {
//     const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${nickname}`, {
//       headers: {
//         'Authorization': `Bearer ${FACEIT_API_KEY}`
//       }
//     });
    
//     if (!playerResponse.ok) {
//       throw new Error('Ошибка получения player_id');
//     }
    
//     const playerData = await playerResponse.json();
//     const playerId = playerData.player_id;
    
//     const statsResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`, {
//       headers: {
//         'Authorization': `Bearer ${FACEIT_API_KEY}`
//       }
//     });
    
//     if (!statsResponse.ok) {
//       throw new Error('Ошибка получения статистики');
//     }
    
//     const statsData = await statsResponse.json();
    
//     const result = {
//       nickname: nickname,
//       player_id: playerId,
//       game: "cs2",
//       skill_level: playerData.games?.cs2?.skill_level || 0,
//       faceit_elo: playerData.games?.cs2?.faceit_elo || 0,
//       stats: {
//         lifetime: statsData.lifetime
//       }
//     };
    
//     response.status(200).json(statsData);
    
//   } catch (error) {
//     response.status(500).json({ 
//       error: 'Не удалось получить данные',
//       message: error.message
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
    if (matchesResponse.ok) {
      const matchesData = await matchesResponse.json();
      lastMatches = matchesData.items.slice(0, 10).map(match => ({
        match_id: match.match_id,
        date: match.date,
        result: match.stats.Result,
        kills: match.stats.Kills,
        deaths: match.stats.Deaths,
        assists: match.stats.Assists,
        kd_ratio: match.stats['K/D Ratio'],
        hs_percent: match.stats['Headshots %'],
        rating: match.stats.Rating,
        mvps: match.stats.MVPs
      }));
    }

    const result = {
      nickname: nickname,
      player_id: playerId,
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