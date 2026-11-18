import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/analyze-food';

function mockRes() {
  const result = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
    },
  };
  return result;
}

test('analyze-food handler: rejects non-POST requests with 405', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error, 'Use POST to analyze a meal.');
});

test('analyze-food handler: returns 503 if GEMINI_API_KEY is not configured', async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    const res = mockRes();
    await handler({ method: 'POST', body: { text: 'Apple', meal: 'snacks' } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /GEMINI_API_KEY/);
  } finally {
    process.env.GEMINI_API_KEY = oldKey;
  }
});

test('analyze-food handler: rejects empty payloads or missing text/image with 400', async () => {
  const res1 = mockRes();
  await handler({ method: 'POST', body: null }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = mockRes();
  await handler({ method: 'POST', body: { text: '', meal: 'snacks' } }, res2);
  assert.equal(res2.statusCode, 400);
  assert.match(res2.body.error, /Add a food description/);
});

test('analyze-food handler: rejects unsupported photo mime types with 400', async () => {
  const res = mockRes();
  await handler({
    method: 'POST',
    body: {
      text: 'Food',
      meal: 'lunch',
      image: { mimeType: 'image/gif', data: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
    },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /JPEG, PNG, or WebP/);
});

test('analyze-food handler: rejects malformed base64 image data with 400', async () => {
  const res = mockRes();
  await handler({
    method: 'POST',
    body: {
      meal: 'breakfast',
      image: { mimeType: 'image/jpeg', data: 'Not valid base64$$$!!!' },
    },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /JPEG, PNG, or WebP/);
});

test('analyze-food handler: prompt includes personal brand and portion references', async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = globalThis.fetch;
  let requestBody = '';
  let requestUrl = '';
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? '');
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [], note: '' }) }] } }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    const res = mockRes();
    await handler({ method: 'POST', body: { text: 'protein shake and bread with peanut butter', meal: 'breakfast' } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(requestUrl, /models\/gemini-(3\.8-flash|3\.6-flash|3\.5-flash-lite|3\.1-flash-lite):generateContent/);
    assert.match(requestBody, /"thinkingLevel":"medium"/);
    assert.match(requestBody, /The photo determines HOW MUCH is present/);
    assert.match(requestBody, /Beastlife Performance Fermented Yeast Protein/);
    assert.match(requestBody, /250 ml milk/);
    assert.match(requestBody, /265 kcal, 32\.5 g protein/);
    assert.match(requestBody, /Britannia Brown Bread/);
    assert.match(requestBody, /16 g Pintola Dark Chocolate Peanut Butter/);
    assert.match(requestBody, /photo to count the actual slices/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});
