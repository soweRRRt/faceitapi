export default function handler(request, response) {
  response.json({
    hasApiKey: !!process.env.FACEIT_API_KEY,
    apiKeyLength: process.env.FACEIT_API_KEY?.length || 0,
    message: process.env.FACEIT_API_KEY ? 'Key exists' : 'No key'
  });
}