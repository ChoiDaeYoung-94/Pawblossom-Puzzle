import {afterEach, describe, expect, it, vi} from 'vitest';
import {createPlayPurchaseLookup, type PlayPurchaseServerConfig, type PurchaseLookup} from '../server/commerce/googlePlayPurchase';

// 공식 스키마를 따른 합성 fixture입니다. 실제 계정·토큰·Google 응답이 아닙니다.
const config: PlayPurchaseServerConfig = {
  packageName: 'com.example.pawblossom', productId: 'remove_ads', purchaseOptionId: 'permanent', mode: 'production',
};
const input: PurchaseLookup = {
  purchaseToken: 'synthetic/token?query#fragment%plus+', accessToken: 'synthetic-oauth-token',
  expectedObfuscatedAccountId: 'synthetic-account-binding',
};
function fixture(): Record<string, any> {
  return {
    purchaseStateContext: {purchaseState: 'PURCHASED'},
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    obfuscatedExternalAccountId: input.expectedObfuscatedAccountId,
    productLineItem: [{productId: config.productId, productOfferDetails: {
      purchaseOptionId: config.purchaseOptionId, quantity: 1, refundableQuantity: 1,
      consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED',
    }}],
  };
}
function response(body: unknown = fixture()) {
  return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
}
function harness(body: unknown = fixture(), policy = config) {
  const transport = vi.fn<typeof fetch>(async () => response(body));
  return {transport, lookup: createPlayPurchaseLookup(policy, transport)};
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('서버 구매 사실 판정', () => {
  it('orderId/packageName/token 없는 공식 스키마에서 pending ack 후속 검토 사실을 반환합니다', async () => {
    const result = await harness().lookup(input);
    expect(result).toEqual({kind: 'purchase-fact', fact: {
      packageName: config.packageName, productId: config.productId, purchaseOptionId: config.purchaseOptionId,
      quantity: 1, purchaseState: 'PURCHASED', acknowledgement: 'pending', environment: 'production',
    }, nextStep: 'durable-record-and-entitlement-review-then-ack'});
    const serialized = JSON.stringify(result);
    for (const secret of Object.values(input)) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('grant');
  });
  it('이미 ack된 구매도 binding 검증 후 복원 심사 후보로 허용합니다', async () => {
    const body = fixture(); body.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
    expect(await harness(body).lookup(input)).toMatchObject({kind: 'purchase-fact', fact: {acknowledgement: 'acknowledged'}, nextStep: 'durable-record-and-restoration-review'});
    body.obfuscatedExternalAccountId = 'different-synthetic-account';
    expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'account-binding-failed'});
  });
  it.each(['PENDING', 'CANCELLED'])('%s는 필드가 완전하거나 누락되어도 후보가 아닙니다', async state => {
    const body = fixture(); body.purchaseStateContext.purchaseState = state;
    for (const value of [body, {purchaseStateContext: {purchaseState: state}}]) {
      expect(await harness(value).lookup(input)).toEqual({kind: 'rejected', reason: state.toLowerCase()});
    }
  });
  it.each([null, [], {}, 'PURCHASED', {purchaseStateContext: null}, {purchaseStateContext: {purchaseState: 'PURCHASE_STATE_UNSPECIFIED'}}, {purchaseStateContext: {purchaseState: 0}}, {purchaseStateContext: {purchaseState: 'FUTURE'}}])('알 수 없거나 누락된 구매 상태를 닫습니다: %j', async body => {
    expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'invalid-purchase'});
  });
  it.each([undefined, null, 0, '', 'ACKNOWLEDGEMENT_STATE_UNSPECIFIED', 'FUTURE'])('알 수 없는 ack를 닫습니다: %j', async ack => {
    const body = fixture(); body.acknowledgementState = ack;
    expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'invalid-purchase'});
  });
  it.each([undefined, null, '', 'different', 10, 'x'.repeat(65)])('응답 binding 누락/불일치를 차단합니다: %j', async account => {
    const body = fixture(); body.obfuscatedExternalAccountId = account;
    expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'account-binding-failed'});
  });
  it.each([undefined, null, [], {}, [null], [{productId: 'other'}]])('정확한 상품 한 줄만 지원합니다: %j', async lines => {
    const body = fixture(); body.productLineItem = lines;
    expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'unsupported-product'});
  });
  it('같은 상품 중복 줄과 다른 상품 혼합을 모두 닫습니다', async () => {
    for (const other of [fixture().productLineItem[0], {productId: 'other'}]) {
      const body = fixture(); body.productLineItem.push(other);
      expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'unsupported-product'});
    }
  });
  it.each([
    ['purchaseOptionId', undefined], ['purchaseOptionId', 'other'], ['quantity', undefined], ['quantity', 0],
    ['quantity', 2], ['quantity', 1.5], ['quantity', '1'], ['quantity', null],
    ['refundableQuantity', undefined], ['refundableQuantity', 0], ['refundableQuantity', 2], ['refundableQuantity', '1'],
    ['consumptionState', undefined], ['consumptionState', 'CONSUMPTION_STATE_CONSUMED'],
    ['consumptionState', 'CONSUMPTION_STATE_UNSPECIFIED'], ['consumptionState', 'FUTURE'], ['consumptionState', 0],
    ['rentOfferDetails', {}], ['rentOfferDetails', null], ['preorderOfferDetails', {}], ['preorderOfferDetails', null],
  ])('영구 비소모 수량1 profile 밖의 %s=%j를 닫습니다', async (key, value) => {
    const body = fixture(); body.productLineItem[0].productOfferDetails[key as string] = value;
    expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'unsupported-offer'});
  });
  it.each([undefined, null, [], 'offer'])('offer 구조 누락/오류를 닫습니다: %j', async offer => {
    const body = fixture(); body.productLineItem[0].productOfferDetails = offer;
    expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'unsupported-offer'});
  });
  it.each([null, {}, {fopType: 'TEST'}, {fopType: 'FUTURE'}])('production에서 test context가 존재하면 차단합니다: %j', async test => {
    const body = fixture(); body.testPurchaseContext = test;
    expect(await harness(body).lookup(input)).toEqual({kind: 'rejected', reason: 'test-purchase-blocked'});
  });
  it('명시적 서버 시험 모드에서 TEST context만 허용합니다', async () => {
    const body = fixture(); body.testPurchaseContext = {fopType: 'TEST'};
    expect(await harness(body, {...config, mode: 'test'}).lookup(input)).toMatchObject({kind: 'purchase-fact', fact: {environment: 'test'}});
    expect(await harness(fixture(), {...config, mode: 'test'}).lookup(input)).toMatchObject({fact: {environment: 'production'}});
  });
  it.each([null, [], {}, {fopType: 0}, {fopType: 'FOP_TYPE_UNSPECIFIED'}, {fopType: 'FUTURE'}, {fopType: 'TEST', future: true}])('시험 모드도 알 수 없는 context를 닫습니다: %j', async test => {
    const body = fixture(); body.testPurchaseContext = test;
    expect(await harness(body, {...config, mode: 'test'}).lookup(input)).toEqual({kind: 'rejected', reason: 'invalid-test-context'});
  });
  it('동일 토큰 반복 조회도 원장을 흉내 내거나 권한을 지급하지 않습니다', async () => {
    const h = harness();
    expect(await h.lookup(input)).toEqual(await h.lookup(input));
    expect(h.transport).toHaveBeenCalledTimes(2);
  });
});

describe('고정 Google GET 및 안전한 실패 경계', () => {
  it('구성만으로 호출하지 않으며 토큰을 단일 URL 경로로 encode하고 GET body를 보내지 않습니다', async () => {
    const h = harness(); expect(h.transport).not.toHaveBeenCalled();
    await h.lookup(input);
    const [url, init] = h.transport.mock.calls[0];
    expect(url).toBe(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.packageName}/purchases/productsv2/tokens/${encodeURIComponent(input.purchaseToken)}`);
    expect(new URL(String(url)).search).toBe(''); expect(new URL(String(url)).hash).toBe('');
    expect(init).toMatchObject({method: 'GET', redirect: 'error', headers: {Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json'}});
    expect(init).not.toHaveProperty('body'); expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('기본 transport도 명시 호출 전에는 native fetch를 실행하지 않습니다', () => {
    const native = vi.fn(); vi.stubGlobal('fetch', native);
    createPlayPurchaseLookup(config); expect(native).not.toHaveBeenCalled();
  });
  it.each([
    {packageName: 'https://evil.invalid'}, {packageName: '../com.example'}, {packageName: 'a/b'},
    {productId: ''}, {productId: 'other/product'}, {purchaseOptionId: ''}, {purchaseOptionId: 'a/b'},
    {mode: undefined}, {mode: 'future'}, {timeoutMs: 0}, {timeoutMs: 30001}, {timeoutMs: NaN},
    {maxResponseBytes: 0}, {maxResponseBytes: 1048577}, {maxResponseBytes: 1.5},
  ])('잘못된 서버 구성은 통신 전에 안전한 오류로 막습니다: %j', patch => {
    const transport = vi.fn();
    expect(() => createPlayPurchaseLookup({...config, ...patch} as PlayPurchaseServerConfig, transport)).toThrow('invalid-server-config');
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    {purchaseToken: ''}, {purchaseToken: 'x'.repeat(4097)}, {purchaseToken: '\n'}, {purchaseToken: '..'}, {purchaseToken: '.'}, {purchaseToken: '\ud800'},
    {accessToken: ''}, {accessToken: 'a\r\nb'}, {accessToken: 'Bearer synthetic'}, {accessToken: 'x'.repeat(8193)},
    {expectedObfuscatedAccountId: ''}, {expectedObfuscatedAccountId: 'x'.repeat(65)}, {signal: {}},
  ])('입력 bound/인증 context 형식 오류는 통신 전에 막습니다: %j', async patch => {
    const h = harness(); expect(await h.lookup({...input, ...patch} as PurchaseLookup)).toEqual({kind: 'lookup-error', code: 'invalid-input'});
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('구성 객체를 나중에 변경해도 조회 route와 판정 allowlist는 유지됩니다', async () => {
    const mutable = {...config}; const h = harness(fixture(), mutable);
    mutable.packageName = 'com.other.app'; mutable.productId = 'other'; mutable.mode = 'test';
    expect(await h.lookup(input)).toMatchObject({kind: 'purchase-fact', fact: {packageName: config.packageName, productId: config.productId}});
    expect(h.transport.mock.calls[0][0]).toContain(config.packageName);
  });
  it.each([[301, 'redirect-blocked'], [307, 'redirect-blocked'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'not-found'], [429, 'rate-limited'], [500, 'upstream-unavailable'], [503, 'upstream-unavailable'], [400, 'unexpected-http'], [204, 'unexpected-http']])('HTTP %s를 안전하게 %s로 분류하고 본문을 읽지 않습니다', async (status, code) => {
    const res = new Response(status === 204 ? null : 'sensitive-upstream-body', {status: Number(status)});
    const read = vi.spyOn(res, 'text');
    const lookup = createPlayPurchaseLookup(config, vi.fn(async () => res));
    expect(await lookup(input)).toEqual({kind: 'lookup-error', code}); expect(read).not.toHaveBeenCalled();
  });
  it('redirected/opaque redirect 응답은 거부합니다', async () => {
    for (const patch of [{redirected: true}, {type: 'opaqueredirect'}]) {
      const res = response(); Object.defineProperties(res, Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, {value}])));
      expect(await createPlayPurchaseLookup(config, vi.fn(async () => res))(input)).toEqual({kind: 'lookup-error', code: 'redirect-blocked'});
    }
  });
  it('다른 route 응답·opaque status0·이미 사용된 body를 닫습니다', async () => {
    const wrongRoute = response(); Object.defineProperty(wrongRoute, 'url', {value: 'https://evil.invalid/private'});
    expect(await createPlayPurchaseLookup(config, vi.fn(async () => wrongRoute))(input)).toEqual({kind: 'lookup-error', code: 'invalid-response'});
    expect(await createPlayPurchaseLookup(config, vi.fn(async () => Response.error()))(input)).toEqual({kind: 'lookup-error', code: 'unexpected-http'});
    const used = response(); await used.text();
    expect(await createPlayPurchaseLookup(config, vi.fn(async () => used))(input)).toEqual({kind: 'lookup-error', code: 'transport-error'});
  });
  it.each(['{broken sensitive-upstream-body', '', 'undefined'])('깨진 JSON 본문은 반환하지 않습니다', async body => {
    expect(await createPlayPurchaseLookup(config, vi.fn(async () => new Response(body, {headers: {'content-type': 'application/json'}})))(input)).toEqual({kind: 'lookup-error', code: 'invalid-json'});
  });
  it('선언 크기 및 실제 streaming 바이트 한도를 모두 지킵니다', async () => {
    const declared = response(); declared.headers.set('content-length', '1000');
    expect(await createPlayPurchaseLookup({...config, maxResponseBytes: 999}, vi.fn(async () => declared))(input)).toEqual({kind: 'lookup-error', code: 'response-too-large'});
    const chunks = new ReadableStream<Uint8Array>({start(c) {c.enqueue(new TextEncoder().encode('가'.repeat(8))); c.enqueue(new Uint8Array(9));}});
    const res = new Response(chunks, {headers: {'content-type': 'application/json', 'content-length': '1'}});
    expect(await createPlayPurchaseLookup({...config, maxResponseBytes: 32}, vi.fn(async () => res))(input)).toEqual({kind: 'lookup-error', code: 'response-too-large'});
  });
  it('한도와 정확히 같은 본문 및 UTF8 분할은 허용합니다', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({...fixture(), ignored: '가'}));
    const stream = new ReadableStream<Uint8Array>({start(c) {for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close();}});
    const res = new Response(stream, {headers: {'content-type': 'application/json; charset=utf-8'}});
    expect(await createPlayPurchaseLookup({...config, maxResponseBytes: bytes.length}, vi.fn(async () => res))(input)).toMatchObject({kind: 'purchase-fact'});
  });
  it('잘못된 content-type/content-length 및 UTF8는 닫습니다', async () => {
    const cases: Record<string, string>[] = [{'content-type': 'text/html'}, {'content-type': 'application/json', 'content-length': '-1'}];
    for (const headers of cases) {
      expect(await createPlayPurchaseLookup(config, vi.fn(async () => new Response('{}', {headers})))(input)).toEqual({kind: 'lookup-error', code: 'invalid-response'});
    }
    const res = new Response(new Uint8Array([255]), {headers: {'content-type': 'application/json'}});
    expect(await createPlayPurchaseLookup(config, vi.fn(async () => res))(input)).toEqual({kind: 'lookup-error', code: 'transport-error'});
  });
  it('fetch/stream 예외의 메시지·cause·URL·키를 결과/로그에 노출하지 않습니다', async () => {
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    const sensitive = [input.purchaseToken, input.accessToken, input.expectedObfuscatedAccountId, 'sensitive-upstream-body', 'https://androidpublisher.googleapis.com/private'].join('|');
    const thrown = new Error(sensitive, {cause: new Error(sensitive)});
    const transports: (typeof fetch)[] = [vi.fn(async () => {throw thrown;}), vi.fn(async () => new Response(new ReadableStream({start(c) {c.error(thrown);}}), {headers: {'content-type': 'application/json'}}))];
    for (const transport of transports) expect(await createPlayPurchaseLookup(config, transport)(input)).toEqual({kind: 'lookup-error', code: 'transport-error'});
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it('호출 전 abort는 통신하지 않습니다', async () => {
    const h = harness(), controller = new AbortController(); controller.abort('sensitive abort reason');
    expect(await h.lookup({...input, signal: controller.signal})).toEqual({kind: 'lookup-error', code: 'aborted'});
    expect(h.transport).not.toHaveBeenCalled();
  });
  it.each(['headers', 'body'] as const)('%s 대기 중 취소와 timeout은 중단을 무시하는 transport도 bounded하게 반환합니다', async phase => {
    vi.useFakeTimers();
    for (const action of ['abort', 'timeout']) {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const transport = vi.fn<typeof fetch>(async () => phase === 'headers' ? new Promise<Response>(() => {}) : new Response(new ReadableStream({cancel}), {headers: {'content-type': 'application/json'}}));
      const controller = new AbortController();
      const pending = createPlayPurchaseLookup({...config, timeoutMs: 10}, transport)({...input, signal: controller.signal});
      await Promise.resolve(); await Promise.resolve();
      if (action === 'abort') controller.abort('sensitive reason'); else await vi.advanceTimersByTimeAsync(10);
      expect(await pending).toEqual({kind: 'lookup-error', code: action === 'abort' ? 'aborted' : 'timeout'});
      expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
      if (phase === 'body') expect(cancel).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it('timeout 뒤 늦게 도착한 응답 body도 취소하고 재사용하지 않습니다', async () => {
    vi.useFakeTimers();
    let deliver!: (res: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise(resolve => {deliver = resolve;}));
    const lookup = createPlayPurchaseLookup({...config, timeoutMs: 10}, transport);
    const pending = lookup(input); await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({kind: 'lookup-error', code: 'timeout'});
    const cancel = vi.fn(); deliver(new Response(new ReadableStream({cancel}), {headers: {'content-type': 'application/json'}}));
    await Promise.resolve(); await Promise.resolve(); expect(cancel).toHaveBeenCalled();
  });
});
