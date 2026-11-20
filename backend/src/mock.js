// Offline mock data so the full two-agent pipeline and UI can be exercised without API keys.
// Not used when TAVILY_API_KEY and LLM_API_KEY are set (unless MOCK_MODE=true).

export function mockInfoPlan(query) {
  return {
    information_need: `Latest developments on: ${query}`,
    user_instructions: [],
    search_queries: [query],
    topic: 'news',
    time_range: 'week',
  };
}

export function mockSearch(query) {
  return [
    {
      title: 'Example News - Latest developments (mock source)',
      url: 'https://example.com/news/latest',
      content: `Mock article describing recent developments related to "${query}".`,
      publishedDate: new Date().toISOString(),
      score: 0.9,
    },
    {
      title: 'Example Wire - Analysis (mock source)',
      url: 'https://example.org/analysis',
      content: 'Mock analysis piece giving background and differing viewpoints.',
      publishedDate: new Date().toISOString(),
      score: 0.8,
    },
  ];
}

export function mockInfoAnswer(query, sources) {
  return {
    title: `Mock answer: ${query}`.slice(0, 90),
    answer:
      `This is a mock response generated because the server is running in MOCK MODE. ` +
      `In live mode the Info Agent would summarise the latest reporting on "${query}" here [1].\n\n` +
      `- Background and differing viewpoints would be summarised here [2].\n- Key figures and dates would appear here [1].`,
    opinion: 'Mock opinion: add your API keys to backend/.env to get real, sourced answers.',
    cited_source_ids: sources.map((s) => s.id),
  };
}

export function mockAnalysis() {
  return { status: 'APPROVED', issues: [], corrected_response: null };
}
