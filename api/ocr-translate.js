export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
  }

  const { imageDataUrl, positionNumber, setKey, pdfPage } = req.body || {};
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'imageDataUrl is required' });
  }

  const prompt = [
    'You are processing a scanned French billiards training sheet.',
    'Read the visible instructional text from the image as accurately as possible.',
    'Then produce a concise, usable German translation for training notes.',
    'Return JSON only with these keys:',
    'source_text: the extracted source text in French or the original language visible in the image.',
    'translated_text: concise German training notes, preserving billiards meaning and technique.',
    'Do not include markdown fences or commentary.',
    `Context: set=${setKey || ''}, position=${positionNumber || ''}, pdf_page=${pdfPage || ''}`
  ].join(' ');

  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageDataUrl }
        ]
      }],
      max_output_tokens: 1400
    })
  });

  if (!openAiResponse.ok) {
    const errorText = await openAiResponse.text();
    return res.status(openAiResponse.status).json({ error: errorText || 'OpenAI request failed' });
  }

  const payload = await openAiResponse.json();
  const rawText = payload.output_text || '';

  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (_) {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (_) {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return res.status(502).json({ error: 'Could not parse model response as JSON', raw: rawText });
  }

  return res.status(200).json({
    source_text: String(parsed.source_text || '').trim(),
    translated_text: String(parsed.translated_text || '').trim(),
    raw: rawText
  });
}
