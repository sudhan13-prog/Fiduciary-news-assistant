// Tests: weekday/date check. No real API calls; all websites are made-up placeholders.
process.env.TAVILY_API_KEY = 'test';
process.env.SERPER_API_KEY = 'test';
process.env.MOCK_MODE = 'true';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { findWeekdayMismatches, removeWrongWeekdays } = await import('../src/datecheck.js');
const { runAnalysisAgent } = await import('../src/agents/analysisAgent.js');
const { createEnvelope, MessageType } = await import('../src/protocol.js');

test('date check finds a wrong weekday and accepts correct ones', () => {
  const text =
    'The next release is on Friday, December 4 2026 at 8:30 a.m. [1]. The previous release came out on Friday 6 November 2026 [1]. ' +
    'The release after that will be on Friday, January 3 2027 [2]. Also Fri, 2026-12-04 and Sunday, 3rd of January, 2027.';
  const found = findWeekdayMismatches(text);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { text: 'Friday, January 3 2027', stated: 'Friday', actual: 'Sunday', date: '2027-01-03' });
});

test('date check handles other formats and non-breaking spaces', () => {
  assert.equal(findWeekdayMismatches('on Monday, December 4, 2026').length, 1); // 4 Dec 2026 is a Friday
  assert.equal(findWeekdayMismatches('Thu 2026-12-03').length, 0);
  assert.equal(findWeekdayMismatches('Wednesday 4th of December 2026')[0].actual, 'Friday');
  assert.equal(findWeekdayMismatches('Friday, February 31 2026').length, 0, 'impossible dates are ignored');
  assert.equal(findWeekdayMismatches('Friday, December 4').length, 0, 'no year, no check');
});

test('wrong weekday can be removed while keeping the date', () => {
  const text = 'The next release will be on Friday, January 3 2027 [2].';
  assert.equal(removeWrongWeekdays(text, findWeekdayMismatches(text)), 'The next release will be on January 3 2027 [2].');
});

test('Analysis Agent output never keeps a wrong weekday (code safety net)', async () => {
  const env = createEnvelope({
    type: MessageType.INFO_RESPONSE,
    from: 'info-agent',
    to: 'analysis-agent',
    conversationId: 'c',
    payload: {
      originalQuery: 'next release date',
      userInstructions: [],
      response: { title: 'Release dates', answer: 'Next release: Friday, December 4 2026 [1]. Then Friday, January 3 2027 [1].', opinion: '' },
      citedSourceIds: [1],
      sources: [{ id: 1, title: 'Release schedule', url: 'https://www.agency.example/schedule' }],
    },
  });
  const out = (await runAnalysisAgent(env)).payload; // mock mode: model approves, code must still fix
  assert.equal(out.finalResponse.answer, 'Next release: Friday, December 4 2026 [1]. Then January 3 2027 [1].');
  assert.equal(out.dateCheck.found, 1);
  assert.ok(out.issues.some((i) => i.rule === 'date-check' && /Sunday/.test(i.description)));
});
