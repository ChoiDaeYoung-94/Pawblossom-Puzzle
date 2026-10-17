import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createPlayVoidedPurchasesLookup, type PlayVoidedPurchasesConfig} from '../server/commerce/googlePlayVoidedPurchases';

// 실제 자격정보/네트워크 없는 합성 응답입니다.
const token = 'synthetic-secret-purchase/token', oauth = 'synthetic-secret-oauth', pageToken = 'synthetic-page?secret&token';
const now = 1_792_200_000_000, day = 86_400_000;
const window = {startTime: now - day, endTime: now};
const item = (purchaseToken = token) => ({kind: 'androidpublisher#voidedPurchase', purchaseToken,
  purchaseTimeMillis: String(now - 100 * day), voidedTimeMillis: String(now - 40 * day), voidedReason: 7, voidedSource: 2});
const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
function setup(patch: Partial<PlayVoidedPurchasesConfig> = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const getAccessToken = vi.fn(async () => oauth);
  const transport = vi.fn<typeof fetch>(async () => json({voidedPurchases: [item()]}));
  const config = {packageName: 'com.example.pawblossom', getAccessToken, ...patch};
  return {transport, config, getAccessToken, lookup: createPlayVoidedPurchasesLookup(config, transport)};
}
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

describe('Google 전액 취소 전체 페이지 조회', () => {
  it('고정 호스트/flat query/GET/헤더 OAuth/redirect 차단과 원문 미노출을 적용합니다', async () => {
    const h = setup(); const result = await h.lookup(window);
    expect(result).toEqual({kind: 'voided-facts', tokenIds: [createHash('sha256').update(token).digest('hex')], pages: 1, items: 1});
    const [raw, request] = h.transport.mock.calls[0]; const url = new URL(String(raw));
    expect(url.origin).toBe('https://androidpublisher.googleapis.com');
    expect(url.pathname).toBe('/androidpublisher/v3/applications/com.example.pawblossom/purchases/voidedpurchases');
    expect(Object.fromEntries(url.searchParams)).toEqual({type: '0', includeQuantityBasedPartialRefund: 'false', startTime: String(window.startTime), endTime: String(now), maxResults: '1000'});
    expect(request).toMatchObject({method: 'GET', redirect: 'error', headers: {Authorization: `Bearer ${oauth}`, Accept: 'application/json'}});
    expect(String(raw)).not.toContain(oauth); expect(JSON.stringify(result)).not.toContain(token);
  });
  it('창 밖 voidedTimeMillis도 허용하며 페이지마다 OAuth를 새로 취득하고 중복 토큰은 합칩니다', async () => {
    const h = setup({pageSize: 2});
    h.transport.mockResolvedValueOnce(json({voidedPurchases: [item()], tokenPagination: {previousPageToken: null, nextPageToken: pageToken}, pageInfo: {totalResults: 3, startIndex: 0, resultPerPage: 2}}))
      .mockResolvedValueOnce(json({voidedPurchases: [item(), {...item('second-token'), orderId: 'same-order-unused'}], pageInfo: {totalResults: 3, startIndex: 1, resultPerPage: 2}}));
    expect(await h.lookup(window)).toMatchObject({kind: 'voided-facts', items: 3, pages: 2, tokenIds: expect.any(Array)});
    expect(h.getAccessToken).toHaveBeenCalledTimes(2);
    expect(new URL(String(h.transport.mock.calls[1][0])).searchParams.get('token')).toBe(pageToken);
  });
  it('필드 부재 빈 목록은 전체 조회 성공이고 명시 null은 실패합니다', async () => {
    const h = setup(); h.transport.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({voidedPurchases: null}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-facts', tokenIds: [], pages: 1, items: 0});
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-response'});
  });
  it.each([undefined, 'GPA.synthetic'])('orderId %s는 없어도 되고 토큰을 대체하지 않습니다', async orderId => {
    const h = setup(); h.transport.mockResolvedValue(json({voidedPurchases: [{...item(), ...(orderId ? {orderId} : {})}, {...item('different-token'), ...(orderId ? {orderId} : {})}]}));
    expect(await h.lookup(window)).toMatchObject({kind: 'voided-facts', tokenIds: expect.arrayContaining([createHash('sha256').update(token).digest('hex'), createHash('sha256').update('different-token').digest('hex')])});
  });
  it.each([0, 1, null, '1', -1])('voidedQuantity=%s는 전액 profile이 아니며 전체 실패합니다', async voidedQuantity => {
    const h = setup(); h.transport.mockResolvedValue(json({voidedPurchases: [item(), {...item('partial'), voidedQuantity}]}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-response'});
  });
  it.each([
    {purchaseToken: ''}, {purchaseToken: '..'}, {purchaseToken: 'x'.repeat(4097)}, {purchaseToken: 'x\ny'},
    {voidedReason: 9}, {voidedReason: '7'}, {voidedReason: null}, {voidedSource: 3}, {voidedSource: -1},
    {purchaseTimeMillis: 123}, {purchaseTimeMillis: '0'}, {purchaseTimeMillis: '01'}, {purchaseTimeMillis: '9007199254740992'},
    {voidedTimeMillis: String(now + 1)}, {voidedTimeMillis: String(now - 101 * day)}, {kind: 'different'},
    {productId: 'fake-product'}, {environment: 'production'}, {orderId: ''},
  ])('잘못된/가짜 구매 사실 %j는 실패합니다', async patch => {
    const h = setup(); h.transport.mockResolvedValue(json({voidedPurchases: [{...item(), ...patch}]}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-response'});
  });
  it.each([
    {voidedPurchases: {}}, {voidedPurchases: [null]}, {unknown: true}, {tokenPagination: null},
    {tokenPagination: {nextPageToken: null}}, {tokenPagination: {nextPageToken: ''}},
    {tokenPagination: {nextPageToken: 'x'.repeat(4097)}}, {tokenPagination: {pageToken: 'x'}},
    {pageInfo: null}, {pageInfo: {resultsPerPage: 10}}, {pageInfo: {totalResults: -1}},
    {voidedPurchases: [item()], pageInfo: {totalResults: 2}}, {voidedPurchases: [item()], pageInfo: {totalResults: 0}},
    {voidedPurchases: [item()], pageInfo: {startIndex: 1}}, {voidedPurchases: [item()], pageInfo: {resultPerPage: 0}},
  ])('페이지 profile/완료 메타 모순 %j는 실패합니다', async body => {
    const h = setup(); h.transport.mockResolvedValue(json(body)); expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-response'});
  });
  it('페이지 중 totalResults가 바뀌면 완료로 보고하지 않습니다', async () => {
    const h = setup(); h.transport.mockResolvedValueOnce(json({voidedPurchases: [item()], pageInfo: {totalResults: 2}, tokenPagination: {nextPageToken: pageToken}}))
      .mockResolvedValueOnce(json({voidedPurchases: [item()], pageInfo: {totalResults: 3}}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-response'});
  });
  it('순환 nextPageToken은 부분 성공이 되지 않습니다', async () => {
    const h = setup(); h.transport.mockImplementation(async () => json({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-response'}); expect(h.transport).toHaveBeenCalledTimes(2);
  });
  it.each([{maxPages: 1}, {maxItems: 1}])('페이지/총 항목 한도 %j 이후 미완료 조회는 실패합니다', async limits => {
    const h = setup(limits); h.transport.mockResolvedValue(json({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'limit-exceeded'}); expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('빈 후속 페이지여도 maxPages 경계에서 끝나면 성공하며 항목 상한 초과는 실패합니다', async () => {
    const h = setup({maxPages: 2, maxItems: 2});
    h.transport.mockResolvedValueOnce(json({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}})).mockResolvedValueOnce(json({}));
    expect(await h.lookup(window)).toMatchObject({kind: 'voided-facts', items: 1, pages: 2});
    h.transport.mockResolvedValueOnce(json({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}})).mockResolvedValueOnce(json({voidedPurchases: [item(), item()]}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'limit-exceeded'});
  });
  it('요청 pageSize를 넘는 응답도 거절합니다', async () => {
    const h = setup({pageSize: 1}); h.transport.mockResolvedValue(json({voidedPurchases: [item(), item()]}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-response'});
  });
});

describe('조회 입력·transport·메모리/시간 경계', () => {
  it.each([
    {startTime: now - 30 * day - 1}, {endTime: now + 1}, {endTime: window.startTime},
    {startTime: 1.5}, {endTime: NaN}, {startTime: '100'}, {signal: {}},
  ])('잘못된 서버 창/입력 %j에서는 OAuth/GET를 호출하지 않습니다', async patch => {
    const h = setup(); expect(await h.lookup({...window, ...patch} as any)).toEqual({kind: 'voided-error', code: 'invalid-input'});
    expect(h.transport).not.toHaveBeenCalled(); expect(h.getAccessToken).not.toHaveBeenCalled();
  });
  it('정확히 30일인 시작 시각을 허용합니다', async () => {
    const h = setup(); expect(await h.lookup({...window, startTime: now - 30 * day})).toMatchObject({kind: 'voided-facts'});
  });
  it.each([
    {packageName: '../evil'}, {getAccessToken: undefined}, {timeoutMs: 0}, {timeoutMs: 60_001}, {pageSize: 1001},
    {maxPages: 0}, {maxPages: 101}, {maxItems: 100_001}, {maxReads: 0}, {maxReads: 16_385},
    {maxResponseBytes: 1024 * 1024 + 1}, {maxTotalBytes: 16 * 1024 * 1024 + 1},
  ])('잘못된 구성 %j는 생성 단계에서 차단합니다', patch => {
    const h = setup(); expect(() => createPlayVoidedPurchasesLookup({...h.config, ...patch} as any, h.transport)).toThrow('invalid-voided-config');
  });
  it.each([[301, 'redirect-blocked'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'unexpected-http'], [429, 'rate-limited'], [500, 'upstream-unavailable'], [503, 'upstream-unavailable'], [204, 'unexpected-http'], [202, 'unexpected-http']])('HTTP %s는 %s로 안전하게 분류합니다', async (status, code) => {
    const h = setup(); h.transport.mockResolvedValue(new Response(status === 204 ? null : token + oauth + pageToken, {status: Number(status)}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code});
  });
  it('뒤 페이지 실패는 앞 페이지 사실도 반환하지 않습니다', async () => {
    const h = setup(); h.transport.mockResolvedValueOnce(json({voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}})).mockRejectedValueOnce(new Error(token + oauth + pageToken));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'transport-error'});
  });
  it.each(['redirected', 'url'])('%s 응답을 거절합니다', async property => {
    const h = setup(); const response = json({}); Object.defineProperty(response, property, {value: property === 'url' ? 'https://evil.example' : true}); h.transport.mockResolvedValue(response);
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: property === 'url' ? 'invalid-response' : 'redirect-blocked'});
  });
  it.each(['{}{}', '{"voidedPurchases":[],"voidedPurchases":[]}', '{"tokenPagination":{"nextPageToken":"x","nextPageToken":"y"}}', '{"pageInfo":{"totalResults":0,"totalResults":1}}', '{"voidedPurchases": [}'])('잘못된/중복키 JSON은 원문 없이 실패합니다: %s', async body => {
    const h = setup(); h.transport.mockResolvedValue(new Response(body, {headers: {'content-type': 'application/json'}}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-json'});
  });
  it('잘못된 UTF8도 치환해서 통과시키지 않습니다', async () => {
    const h = setup(); h.transport.mockResolvedValue(new Response(new Uint8Array([0xc0, 0xaf]), {headers: {'content-type': 'application/json'}}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-json'});
  });
  it.each(['html', 'null-body', 'length-invalid', 'length-large'])('헤더/본문 %s 경계를 차단합니다', async kind => {
    const h = setup({maxResponseBytes: 10});
    h.transport.mockResolvedValue(new Response(kind === 'null-body' ? null : '{}', {headers: {'content-type': kind === 'html' ? 'text/html' : 'application/json', ...(kind.startsWith('length') ? {'content-length': kind === 'length-invalid' ? 'x' : '11'} : {})}}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: kind === 'length-large' ? 'response-too-large' : 'invalid-response'});
  });
  it.each(['page', 'total'])('%s 바이트 상한은 content-length가 없어도 적용합니다', async kind => {
    const h = setup(kind === 'page' ? {maxResponseBytes: 1} : {maxTotalBytes: 3});
    h.transport.mockResolvedValue(json({voidedPurchases: []})); expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'response-too-large'});
  });
  it('전체 바이트는 페이지를 넘어 누적합니다', async () => {
    const first = {voidedPurchases: [item()], tokenPagination: {nextPageToken: pageToken}};
    const h = setup({maxTotalBytes: JSON.stringify(first).length + 1});
    h.transport.mockResolvedValueOnce(json(first)).mockResolvedValueOnce(json({}));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'response-too-large'});
  });
  it('즉시 무한 0byte reader도 read 횟수 상한에서 종료합니다', async () => {
    const h = setup({maxReads: 8}); const read = vi.fn(async () => ({done: false, value: new Uint8Array()}));
    const response = json({}); Object.defineProperty(response, 'body', {value: {getReader: () => ({read, cancel: async () => {}})}});
    h.transport.mockResolvedValue(response); expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'limit-exceeded'}); expect(read).toHaveBeenCalledTimes(8);
  });
  it.each(['oauth', 'fetch', 'read'])('%s 무응답은 전체 기한으로 종료하며 늦은 결과가 후속 GET하지 않습니다', async phase => {
    vi.useFakeTimers(); const h = setup({timeoutMs: 20}); let finish!: (v: any) => void;
    if (phase === 'oauth') h.getAccessToken.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    if (phase === 'fetch') h.transport.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    if (phase === 'read') h.transport.mockResolvedValue(new Response(new ReadableStream({pull: () => new Promise(resolve => {finish = resolve;}), cancel: () => new Promise(() => {})}), {headers: {'content-type': 'application/json'}}));
    const pending = h.lookup(window); await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toEqual({kind: 'voided-error', code: 'timeout'});
    if (phase !== 'read') {finish(phase === 'oauth' ? oauth : json({})); await vi.advanceTimersByTimeAsync(0);}
    expect(h.transport).toHaveBeenCalledTimes(phase === 'oauth' ? 0 : 1); expect(vi.getTimerCount()).toBe(0);
  });
  it('사전 중단은 OAuth도 실행하지 않으며 호출 중 중단은 transport signal에 전달됩니다', async () => {
    const h = setup(); const a = new AbortController(); a.abort();
    expect(await h.lookup({...window, signal: a.signal})).toEqual({kind: 'voided-error', code: 'aborted'}); expect(h.getAccessToken).not.toHaveBeenCalled();
    const b = new AbortController(); h.transport.mockImplementation(async () => {b.abort(); return json({});});
    expect(await h.lookup({...window, signal: b.signal})).toEqual({kind: 'voided-error', code: 'aborted'}); expect(h.transport.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
  it('구성과 입력을 await 도중 변경해도 최초 서버 경계를 유지합니다', async () => {
    const h = setup(); let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
    h.getAccessToken.mockImplementation(async () => {await gate; return oauth;}); const input = {...window}; const pending = h.lookup(input);
    h.config.packageName = 'com.other.app'; input.startTime = 0; release();
    expect(await pending).toMatchObject({kind: 'voided-facts'}); const url = new URL(String(h.transport.mock.calls[0][0]));
    expect(url.pathname).toContain('com.example.pawblossom'); expect(url.searchParams.get('startTime')).toBe(String(window.startTime));
  });
  it.each(['', 'x\ny', 'x'.repeat(8193)])('잘못된 OAuth는 URL 요청 없이 실패합니다', async value => {
    const h = setup(); h.getAccessToken.mockResolvedValue(value);
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'invalid-input'}); expect(h.transport).not.toHaveBeenCalled();
  });
  it('예외·오류 본문·토큰·페이지 토큰은 결과/로그에 남기지 않습니다', async () => {
    const h = setup(); const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    h.getAccessToken.mockRejectedValueOnce(new Error(token + oauth + pageToken));
    expect(await h.lookup(window)).toEqual({kind: 'voided-error', code: 'transport-error'});
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
});
