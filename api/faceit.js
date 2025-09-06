export const config = {
  runtime: 'nodejs'
};

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const nickname = request.query.nick;
  
  const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
  
  try {
    const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${nickname}`, {
      headers: {
        'Authorization': `Bearer ${FACEIT_API_KEY}`
      }
    });
    
    if (!playerResponse.ok) {
      throw new Error('Ошибка получения player_id');
    }
    
    const playerData = await playerResponse.json();
    const playerId = playerData.player_id;
    
    const statsResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`, {
      headers: {
        'Authorization': `Bearer ${FACEIT_API_KEY}`
      }
    });
    
    if (!statsResponse.ok) {
      throw new Error('Ошибка получения статистики');
    }
    
    const statsData = await statsResponse.json();
    
    const result = {
      nickname: nickname,
      player_id: playerId,
      game: "cs2",
      skill_level: playerData.games?.cs2?.skill_level || 0,
      faceit_elo: playerData.games?.cs2?.faceit_elo || 0,
      stats: {
        lifetime: statsData.lifetime
      }
    };
    
    response.status(200).json(result);
    
  } catch (error) {
    response.status(500).json({ 
      error: 'Не удалось получить данные',
      message: error.message
    });
  }
}