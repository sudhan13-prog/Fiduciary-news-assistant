import 'dotenv/config';

const bool = (v) => String(v || '').toLowerCase() === 'true';

const baseUrl = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1';
const apiKey = process.env.LLM_API_KEY || '';

export const config = {
  port: Number(process.env.PORT || 8787),
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  searchMaxResults: Number(process.env.SEARCH_MAX_RESULTS || 6),
  exposeTrace: bool(process.env.EXPOSE_TRACE),
  infoAgent: {
    name: 'Info Agent',
    model: process.env.INFO_AGENT_MODEL || 'openai/gpt-oss-20b',
    baseUrl: process.env.INFO_AGENT_BASE_URL || baseUrl,
    apiKey: process.env.INFO_AGENT_API_KEY || apiKey,
  },
  analysisAgent: {
    name: 'Analysis Agent',
    model: process.env.ANALYSIS_AGENT_MODEL || 'qwen/qwen3-32b',
    baseUrl: process.env.ANALYSIS_AGENT_BASE_URL || baseUrl,
    apiKey: process.env.ANALYSIS_AGENT_API_KEY || apiKey,
  },
};

const missingKeys = !config.tavilyApiKey || !config.infoAgent.apiKey || !config.analysisAgent.apiKey;
config.mockMode = bool(process.env.MOCK_MODE) || missingKeys;
config.mockReason = bool(process.env.MOCK_MODE)
  ? 'MOCK_MODE=true'
  : missingKeys
    ? 'API keys missing (TAVILY_API_KEY / LLM_API_KEY) - copy .env.example to .env and fill them in'
    : null;
