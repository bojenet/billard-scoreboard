export default async function handler(req, res) {
  return res.status(200).json({
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    vercelEnv: process.env.VERCEL_ENV || null,
    nodeEnv: process.env.NODE_ENV || null
  });
}
