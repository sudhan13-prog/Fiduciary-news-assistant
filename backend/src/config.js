import 'dotenv/config';

const bool = (v) => String(v || '').toLowerCase() === 'true';

const baseUrl = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const apiKey = process.env.LLM_API_KEY || '';

export const config = {
  port: Number(process.env.PORT || 8787),
  exposeTrace: bool(process.env.EXPOSE_TRACE),

  // Search engines: any engine without a key is skipped automatically.
  search: {
    tavily: process.env.TAVILY_API_KEY || '',
    serper: process.env.SERPER_API_KEY || '',
    brave: process.env.BRAVE_API_KEY || '',
  },
  resultsPerEngine: Number(process.env.RESULTS_PER_ENGINE || 5), // results requested from each engine per query
  searchCandidates: Number(process.env.SEARCH_CANDIDATES || 20), // results the Info Agent chooses from
  searchMaxResults: Number(process.env.SEARCH_MAX_RESULTS || 10), // sources the Info Agent chooses and uses
  sourceMaxChars: Number(process.env.SOURCE_MAX_CHARS || 1200), // text kept per source
  searchTimeoutMs: Number(process.env.SEARCH_TIMEOUT_MS || 10000), // a slow engine is skipped after this

  infoAgent: {
    name: 'Info Agent',
    model: process.env.INFO_AGENT_MODEL || 'openai/gpt-oss-120b',
    baseUrl: process.env.INFO_AGENT_BASE_URL || baseUrl,
    apiKey: process.env.INFO_AGENT_API_KEY || apiKey,
  },
  analysisAgent: {
    name: 'Analysis Agent',
    model: process.env.ANALYSIS_AGENT_MODEL || 'qwen/qwen3.8-27b',
    baseUrl: process.env.ANALYSIS_AGENT_BASE_URL || baseUrl,
    apiKey: process.env.ANALYSIS_AGENT_API_KEY || apiKey,
  },
};

const noSearchKey = !Object.values(config.search).some(Boolean);
const noLlmKey = !config.infoAgent.apiKey || !config.analysisAgent.apiKey;
config.mockMode = bool(process.env.MOCK_MODE) || noSearchKey || noLlmKey;
config.mockReason = bool(process.env.MOCK_MODE)
  ? 'MOCK_MODE=true'
  : noSearchKey || noLlmKey
    ? 'API keys missing (a search engine key and LLM_API_KEY are needed) - copy .env.example to .env and fill them in'
    : null;
