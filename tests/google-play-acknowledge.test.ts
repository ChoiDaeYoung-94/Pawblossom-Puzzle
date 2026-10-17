import {afterEach, describe, expect, it, vi} from 'vitest';
import {createLedgerAcknowledger, createPlayPurchaseAcknowledger, type PlayAcknowledgeConfig, type PlayAcknowledgeInput} from '../server/commerce/googlePlayAcknowledge';

// 실제 Google 응답·계정·OAuth·구매가 아닌 주입 합성 fixture만 사용합니다.
const config = {packageName: 'com.example.pawblossom', productId: 'remove_ads'};
const input = {...config, purchaseToken: 'synthetic/token?query#fragment%plus+', accessToken: 'synthetic-oauth'};
const error = (code: string) => ({kind: 'acknowledge-error', code});
const success = {kind: 'acknowledged'};
const expectedUrl = (token = input.purchaseToken) => `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.packageName}/purchases/products/${config.productId}/tokens/${encodeURIComponent(token)}:acknowledge`;
function altered(response: Response, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(response, key, {value, configurable: true});
  return response;
}
function harness(response: Response = new Response(null), policy: PlayAcknowledgeConfig = config) {
  const transport = vi.fn<typeof fetch>(async () => response);
  return {transport, acknowledge: createPlayPurchaseAcknowledger(policy, transport)};
}
function brokenBody(read = vi.fn(async () => ({done: true, value: undefined})), cancel = vi.fn(async () => {})) {
  return {body: {getReader: () => ({read, cancel}), cancel}, read, cancel};
}
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();});

describe('공식 acknowledge 요청과 신뢰 경계', () => {
  it('구성/adapter 생성은 네트워크를 호출하지 않으며 명시 POST만 고정 URL/빈 JSON을 사용합니다', async () => {
    const transport = vi.fn<typeof fetch>(async () => altered(new Response(null), {url: expectedUrl()}));
    const acknowledge = createPlayPurchaseAcknowledger(config, transport);
    createLedgerAcknowledger(config, transport);
    expect(transport).not.toHaveBeenCalled();
    expect(await acknowledge(input)).toEqual(success);
    expect(transport).toHaveBeenCalledExactlyOnceWith(expectedUrl(), {
      method: 'POST', headers: {Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json'},
      body: '{}', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).not.toHaveProperty('developerPayload');
  });
  it('기본 native fetch도 호출 시에만 사용합니다', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null)); vi.stubGlobal('fetch', transport);
    const acknowledge = createPlayPurchaseAcknowledger(config);
    expect(transport).not.toHaveBeenCalled(); expect(await acknowledge(input)).toEqual(success);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['../..', '%2e%2e', '//other.example/a', 'a:b@c\\d', '.token', '...', "token!'()*", 'x'.repeat(4096)])('허용 ASCII 토큰을 단일 인코딩 경로로 전송합니다: %#', async purchaseToken => {
    const h = harness(); expect(await h.acknowledge({...input, purchaseToken})).toEqual(success);
    const url = h.transport.mock.calls[0][0] as string;
    expect(url).toBe(expectedUrl(purchaseToken)); expect(new URL(url).hostname).toBe('androidpublisher.googleapis.com');
    expect(new URL(url).search).toBe(''); expect(new URL(url).hash).toBe('');
  });
  it.each(['', '.', '..', 'x'.repeat(4097), '한글', 'é', '\ud800', 'a\r\nb', 'a b', 'a\tb', 'a\0b', 'a\x7fb', null, 12])('잘못된 토큰은 전송하지 않습니다: %#', async purchaseToken => {
    const h = harness(); expect(await h.acknowledge({...input, purchaseToken} as PlayAcknowledgeInput)).toEqual(error('invalid-input'));
    expect(h.transport).not.toHaveBeenCalled();
  });
  it.each(['', 'Bearer synthetic', 'a\r\nb', '한글', 'x'.repeat(8193), 'a:b', 'a=b=c', '=abc', 'a,b', null, 1])('잘못된 OAuth는 전송하지 않습니다: %#', async accessToken => {
    const h = harness(); expect(await h.acknowledge({...input, accessToken} as PlayAcknowledgeInput)).toEqual(error('invalid-input'));
    expect(h.transport).not.toHaveBeenCalled();
  });
  it.each(['a._~+/-09==', 'a'.repeat(8192)])('안전한 bearer 문자/길이 상한은 허용합니다: %#', async accessToken => {
    expect(await harness().acknowledge({...input, accessToken})).toEqual(success);
  });
  it.each([{packageName: 'com.other.app'}, {productId: 'other'}, {packageName: undefined}, {productId: '../remove_ads'}, {signal: {aborted: false}}])('allowlist 불일치/잘못된 signal은 전송하지 않습니다: %#', async patch => {
    const h = harness(); expect(await h.acknowledge({...input, ...patch} as PlayAcknowledgeInput)).toEqual(error('invalid-input'));
    expect(h.transport).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, {get purchaseToken() {throw new Error(input.accessToken);}}])('잘못된 객체/getter도 안전한 오류로 닫습니다: %#', async value => {
    const h = harness(); expect(await h.acknowledge(value as unknown as PlayAcknowledgeInput)).toEqual(error('invalid-input'));
    expect(h.transport).not.toHaveBeenCalled();
  });
  it.each([
    null, {packageName: undefined}, {packageName: 'localhost'}, {packageName: 'com/a.b'}, {packageName: 'com..app'}, {packageName: '한글.app'},
    {packageName: 'a'.repeat(254) + '.b'}, {productId: '..'}, {productId: ''}, {productId: 'Product'}, {productId: 'p/a'},
    {productId: 'a'.repeat(151)}, {timeoutMs: 0}, {timeoutMs: 30_001}, {timeoutMs: 1.5}, {timeoutMs: NaN},
    {maxResponseBytes: 0}, {maxResponseBytes: 1024 * 1024 + 1}, {maxResponseBytes: 1.1},
  ])('안전하지 않은 config는 안전한 생성 오류입니다: %#', patch => {
    expect(() => createPlayPurchaseAcknowledger(patch === null ? patch as any : {...config, ...patch} as PlayAcknowledgeConfig)).toThrow('invalid-acknowledge-config');
  });
  it('구성 getter/잘못된 transport의 원문 오류를 노출하지 않습니다', () => {
    expect(() => createPlayPurchaseAcknowledger({get packageName(): string {throw new Error(input.accessToken);}, productId: config.productId})).toThrow(/^invalid-acknowledge-config$/);
    expect(() => createPlayPurchaseAcknowledger(config, null as any)).toThrow(/^invalid-acknowledge-config$/);
  });
  it('package/product 길이 상한과 기한/오류 분류 상한의 양 끝은 유효합니다', async () => {
    const policy = {packageName: 'a'.repeat(253) + '.b', productId: 'a'.repeat(150), timeoutMs: 1, maxResponseBytes: 1};
    expect(await harness(new Response(null), policy).acknowledge({...input, ...policy})).toEqual(success);
    expect(await harness(new Response(null), {...config, timeoutMs: 30_000, maxResponseBytes: 1024 * 1024}).acknowledge(input)).toEqual(success);
  });
  it('config/입력의 await 중 변경이 request/정책/기한을 바꾸지 못합니다', async () => {
    vi.useFakeTimers();
    const policy = {...config, timeoutMs: 20}; const value = {...input};
    let finish!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise(resolve => {finish = resolve;}));
    const acknowledge = createPlayPurchaseAcknowledger(policy, transport);
    policy.packageName = 'com.other.app'; policy.productId = 'other'; policy.timeoutMs = 30_000;
    const result = acknowledge(value);
    value.packageName = 'com.changed.app'; value.productId = 'changed'; value.purchaseToken = 'changed'; value.accessToken = 'changed';
    expect(transport.mock.calls[0][0]).toBe(expectedUrl());
    expect(transport.mock.calls[0][1]!.headers).toHaveProperty('Authorization', `Bearer ${input.accessToken}`);
    await vi.advanceTimersByTimeAsync(20); expect(await result).toEqual(error('timeout'));
    finish(new Response(null)); await vi.advanceTimersByTimeAsync(0);
    expect(await acknowledge({...input, productId: 'other'})).toEqual(error('invalid-input'));
  });
});

describe('응답 상태/본문/redirect/안전한 오류', () => {
  it.each([200, 204])('HTTP %s의 비어 있는 본문만 성공이며 Content-Type은 필수가 아닙니다', async status => {
    for (const headers of [{}, {'content-length': '0'}, {'content-type': 'application/json'}] as Record<string, string>[]) {
      expect(await harness(new Response(null, {status, headers})).acknowledge(input)).toEqual(success);
    }
    if (status === 200) expect(await harness(new Response('')).acknowledge(input)).toEqual(success);
  });
  it.each(['{}', ' ', '\r\n', '{"acknowledged":true}', 'upstream-private-error', '\uFEFF'])('성공 상태여도 비어 있지 않은 본문은 실패합니다: %#', async body => {
    expect(await harness(new Response(body)).acknowledge(input)).toEqual(error('invalid-response'));
  });
  it('본문 크기 초과를 제한하고 content-length 0도 신뢰하지 않습니다', async () => {
    expect(await harness(new Response('x'.repeat(1025))).acknowledge(input)).toEqual(error('response-too-large'));
    expect(await harness(new Response('x', {headers: {'content-length': '0'}})).acknowledge(input)).toEqual(error('invalid-response'));
  });
  it.each([['1', 'invalid-response'], ['1025', 'response-too-large'], ['-1', 'invalid-response'], ['1.1', 'invalid-response'], ['NaN', 'invalid-response'], ['9007199254740992', 'invalid-response'], ['1, 0', 'invalid-response']])('Content-Length %s는 %s입니다', async (length, code) => {
    expect(await harness(new Response(null, {headers: {'content-length': length}})).acknowledge(input)).toEqual(error(code));
  });
  it.each([[201, 'unexpected-http'], [202, 'unexpected-http'], [206, 'unexpected-http'], [299, 'unexpected-http'], [301, 'redirect-blocked'], [302, 'redirect-blocked'], [307, 'redirect-blocked'], [308, 'redirect-blocked'], [400, 'unexpected-http'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'not-found'], [409, 'unexpected-http'], [422, 'unexpected-http'], [429, 'rate-limited'], [500, 'upstream-unavailable'], [503, 'upstream-unavailable'], [599, 'upstream-unavailable']])('HTTP %s는 문구에 무관한 %s입니다', async (status, code) => {
    const body = brokenBody(vi.fn(async () => {throw new Error(input.purchaseToken);}));
    const response = altered(new Response(null, {status: status as number}), {body: body.body});
    expect(await harness(response).acknowledge(input)).toEqual(error(code as string));
    expect(body.read).not.toHaveBeenCalled(); expect(body.cancel).toHaveBeenCalled();
  });
  it('400/409 already acknowledged 문구는 승인으로 추정하지 않습니다', async () => {
    for (const status of [400, 409]) expect(await harness(new Response('already acknowledged', {status})).acknowledge(input)).toEqual(error('unexpected-http'));
  });
  it.each([{redirected: true}, {type: 'opaqueredirect'}, {url: 'https://untrusted.example/path'}, {url: expectedUrl() + '?extra=1'}, {url: expectedUrl('other')}])('redirect/URL 변조를 성공 처리하지 않습니다: %#', async values => {
    const h = harness(altered(new Response(null), values));
    expect(await h.acknowledge(input)).toEqual(error('url' in values ? 'invalid-response' : 'redirect-blocked'));
  });
  it('실제 native redirect 예외도 원인 없이 transport-error입니다', async () => {
    const transport = vi.fn<typeof fetch>(async () => {throw new TypeError(expectedUrl(), {cause: new Error(input.accessToken)});});
    expect(await createPlayPurchaseAcknowledger(config, transport)(input)).toEqual(error('transport-error'));
  });
  it.each(['headers', 'body', 'getReader', 'read', 'cancel-throw', 'cancel-reject'])('손상된 응답/stream %s 오류가 비밀 원문을 노출하지 않습니다', async part => {
    const response = new Response(null); const body = brokenBody();
    if (part === 'headers' || part === 'body') Object.defineProperty(response, part, {get() {throw new Error(input.accessToken);}});
    else {
      if (part === 'getReader') body.body.getReader = () => {throw new Error(input.purchaseToken);};
      if (part === 'read') body.read.mockRejectedValue(new Error(expectedUrl()));
      if (part === 'cancel-throw') body.cancel.mockImplementation(() => {throw new Error(input.accessToken);});
      if (part === 'cancel-reject') body.cancel.mockRejectedValue(new Error(input.accessToken));
      altered(response, {body: body.body});
    }
    expect(await harness(response).acknowledge(input)).toEqual(part.startsWith('cancel') ? success : error('transport-error'));
    await Promise.resolve();
  });
  it.each([null, {done: false, value: 'private'}, {done: true, value: new Uint8Array([1])}, {done: 'true'}, {}])('잘못된 stream chunk/EOF 타입은 거절합니다: %#', async chunk => {
    const body = brokenBody(vi.fn(async () => chunk as any));
    expect(await harness(altered(new Response(null), {body: body.body})).acknowledge(input)).toEqual(error('invalid-response'));
  });
  it('headers.get 자체 실패도 원문 없이 안전하게 종료합니다', async () => {
    const response = altered(new Response(null), {headers: {get() {throw new Error(input.accessToken);}}});
    expect(await harness(response).acknowledge(input)).toEqual(error('transport-error'));
  });
  it('0바이트 chunk 후 실제 EOF를 기다립니다', async () => {
    const response = new Response(new ReadableStream({start(c) {c.enqueue(new Uint8Array(0)); c.close();}}));
    expect(await harness(response).acknowledge(input)).toEqual(success);
  });
  it('0바이트 chunk 8개 뒤 EOF는 엄격 profile 안에서 성공합니다', async () => {
    const response = new Response(new ReadableStream({start(c) {
      for (let i = 0; i < 8; i++) c.enqueue(new Uint8Array(0)); c.close();
    }}));
    expect(await harness(response).acknowledge(input)).toEqual(success);
  });
  it.each(['nine', 'infinite'])('즉시 0바이트 chunk %s reader도 유한 read 뒤 오류+cancel로 종료합니다', async mode => {
    let count = 0;
    const body = brokenBody(vi.fn(async () => {
      if (mode === 'nine' && count++ >= 9) return {done: true, value: undefined} as any;
      return {done: false, value: new Uint8Array(0)} as any;
    }), vi.fn(() => new Promise(() => {})));
    const h = harness(altered(new Response(null), {body: body.body}), {...config, timeoutMs: 30_000});
    expect(await h.acknowledge(input)).toEqual(error('invalid-response'));
    expect(body.read).toHaveBeenCalledTimes(9); expect(body.cancel).toHaveBeenCalled();
  });
  it('결과와 로그에 URL/token/OAuth/오류본문/cause가 없습니다', async () => {
    const logs = ['log', 'warn', 'error', 'info', 'debug'].map(name => vi.spyOn(console, name as 'log').mockImplementation(() => {}));
    const privateText = [expectedUrl(), input.purchaseToken, input.accessToken, 'private-upstream-body'].join(' ');
    for (const transport of [vi.fn<typeof fetch>(async () => {throw new Error(privateText, {cause: privateText});}), vi.fn<typeof fetch>(async () => new Response(privateText, {status: 409}))]) {
      const result = await createPlayPurchaseAcknowledger(config, transport)(input);
      for (const secret of privateText.split(' ')) expect(JSON.stringify(result)).not.toContain(secret);
      expect(result).not.toHaveProperty('cause');
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
  it('명시 adapter는 승인만 통과시키고 모든 실패를 retry로 좁힙니다', async () => {
    for (const response of [new Response(null), new Response('{}'), new Response(null, {status: 409})]) {
      const transport = vi.fn<typeof fetch>(async () => response);
      const result = await createLedgerAcknowledger(config, transport)({...input, signal: new AbortController().signal});
      expect(result).toBe(response.status === 200 && !response.body ? 'acknowledged' : 'retry');
    }
  });
});

describe('headers+본문 전체 기한과 caller 취소', () => {
  it('이미 취소된 signal은 통신하지 않습니다', async () => {
    const h = harness(); const controller = new AbortController(); controller.abort(input.accessToken);
    expect(await h.acknowledge({...input, signal: controller.signal})).toEqual(error('aborted'));
    expect(h.transport).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'caller'])('abort 무시 fetch도 %s에 반환하고 늦은 응답을 취소합니다', async mode => {
    vi.useFakeTimers(); const controller = new AbortController();
    let finish!: (r: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise(resolve => {finish = resolve;}));
    const promise = createPlayPurchaseAcknowledger({...config, timeoutMs: 20}, transport)({...input, signal: controller.signal});
    if (mode === 'caller') controller.abort(input.accessToken); else await vi.advanceTimersByTimeAsync(20);
    expect(await promise).toEqual(error(mode === 'caller' ? 'aborted' : 'timeout'));
    expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(true);
    const cancel = vi.fn(async () => {}); finish(altered(new Response(null), {body: {cancel}}));
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalled();
    expect(await promise).toEqual(error(mode === 'caller' ? 'aborted' : 'timeout')); expect(vi.getTimerCount()).toBe(0);
  });
  it('headers를 늦게 받아도 body용 기한을 새로 시작하지 않습니다', async () => {
    vi.useFakeTimers(); let finish!: (r: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise(resolve => {finish = resolve;}));
    const promise = createPlayPurchaseAcknowledger({...config, timeoutMs: 20}, transport)(input);
    await vi.advanceTimersByTimeAsync(15);
    const body = brokenBody(vi.fn(() => new Promise(() => {})), vi.fn(() => new Promise(() => {})));
    finish(altered(new Response(null), {body: body.body})); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5); expect(await promise).toEqual(error('timeout'));
    expect(body.cancel).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['timeout', 'caller'])('abort 무시 reader/cancel도 %s에 반환하며 늦은 EOF가 승인으로 바뀌지 않습니다', async mode => {
    vi.useFakeTimers(); const controller = new AbortController(); let finish!: (r: any) => void;
    const body = brokenBody(vi.fn(() => new Promise(resolve => {finish = resolve;})), vi.fn(() => new Promise(() => {})));
    const h = harness(altered(new Response(null), {body: body.body}), {...config, timeoutMs: 20});
    const promise = h.acknowledge({...input, signal: controller.signal}); await vi.advanceTimersByTimeAsync(0);
    if (mode === 'caller') controller.abort(); else await vi.advanceTimersByTimeAsync(20);
    expect(await promise).toEqual(error(mode === 'caller' ? 'aborted' : 'timeout'));
    finish({done: true}); await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toEqual(error(mode === 'caller' ? 'aborted' : 'timeout')); expect(vi.getTimerCount()).toBe(0);
  });
  it('성공과 오류 모두 caller listener와 timer를 정리합니다', async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
    for (const response of [new Response(null), new Response(null, {status: 429})]) await harness(response).acknowledge({...input, signal: controller.signal});
    expect(remove).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('await 중 input.signal 교체가 원래 caller 취소를 무력화하지 못합니다', async () => {
    const controller = new AbortController(); const value = {...input, signal: controller.signal};
    const transport = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const promise = createPlayPurchaseAcknowledger(config, transport)(value);
    value.signal = new AbortController().signal; controller.abort();
    expect(await promise).toEqual(error('aborted')); expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
  it.each(['throw', 'reject'])('timeout 정리의 cancel %s도 반환과 비밀정보 비노출을 지킵니다', async mode => {
    vi.useFakeTimers();
    const body = brokenBody(vi.fn(() => new Promise(() => {})), vi.fn(() => {
      if (mode === 'throw') throw new Error(input.accessToken);
      return Promise.reject(new Error(input.purchaseToken));
    }));
    const promise = harness(altered(new Response(null), {body: body.body}), {...config, timeoutMs: 20}).acknowledge(input);
    await vi.advanceTimersByTimeAsync(20); expect(await promise).toEqual(error('timeout'));
    expect(vi.getTimerCount()).toBe(0);
  });
});
