// api/generate-quiz.js
const https = require('https');

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

function callAnthropic(systemPrompt, userMsg, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMsg }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(body),
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error('Anthropic error ' + res.statusCode + ': ' + JSON.stringify(parsed)));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Failed to parse Anthropic response: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
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

  console.log('generate-quiz called, systemPrompt length:', systemPrompt ? systemPrompt.length : 0);

  if (!systemPrompt || !userMsg) {
    return res.status(400).json({ error: 'Missing systemPrompt or userMsg' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Debug: log which env vars are present (not their values)
  const envKeys = Object.keys(process.env).filter(k => !k.startsWith('npm_') && !k.startsWith('NODE'));
  console.log('Env vars present:', envKeys.join(', '));

  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set. Available keys:', envKeys.join(', '));
    return res.status(500).json({ error: 'Server configuration error — API key missing', availableKeys: envKeys });
  }

  console.log('API key present, calling Anthropic...');

  try {
    const data = await callAnthropic(systemPrompt, userMsg, apiKey);

    if (!data.content || !data.content[0]) {
      console.error('Empty response from Anthropic:', JSON.stringify(data));
      return res.status(500).json({ error: 'Empty response from AI' });
    }

    console.log('Quiz generated successfully, text length:', data.content[0].text.length);
    return res.status(200).json({ text: data.content[0].text });

  } catch (err) {
    console.error('generate-quiz error:', err.message);
    return res.status(500).json({ error: 'Failed to generate quiz: ' + err.message });
  }
};
