// api/generate-quiz.js
// Vercel serverless function — proxies quiz generation to Anthropic API
// Place at /api/generate-quiz.js in your GitHub repo root
 
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}
 
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
 
  const body = req.body && typeof req.body === 'object' ? req.body : await parseBody(req);
  const { systemPrompt, userMsg } = body;
 
  if (!systemPrompt || !userMsg) {
    return res.status(400).json({ error: 'Missing systemPrompt or userMsg' });
  }
 
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }
 
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            process.env.ANTHROPIC_API_KEY,
        'anthropic-version':    '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMsg }]
      })
    });
 
    const data = await response.json();
 
    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({
        error: data.error?.message || 'Quiz generation failed'
      });
    }
 
    if (!data.content || !data.content[0]) {
      return res.status(500).json({ error: 'Empty response from AI' });
    }
 
    return res.status(200).json({ text: data.content[0].text });
 
  } catch (err) {
    console.error('generate-quiz error:', err);
    return res.status(500).json({ error: 'Failed to generate quiz. Please try again.' });
  }
};
 
