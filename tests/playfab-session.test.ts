import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {PlayFabSessionAuthenticator, type PlayFabSessionConfig, type PlayFabSessionInput} from '../server/auth/playfabSession';
import {PurchaseLedger} from '../server/commerce/purchaseLedger';
import {RewardLedger} from '../server/ads/rewardLedger';
import {policy, epoch, callback, keyResponse} from './helpers/ssvFixture';

// 실제 로그인/키/계정/네트워크가 아닌 합성 fixture입니다. 모듈 import도 통신하지 않습니다.
const ticket = 'synthetic/ticket?query#fragment%plus+=opaque';
const secret = 'synthetic-secret-never-logged';
const providerId = '0123456789ABCDEF';
const pii = 'synthetic-private-email@example.invalid';
const bindingKey = new Uint8Array(32).fill(53);
const config: PlayFabSessionConfig = {titleId: '1A2B3', environment: 'production', bindingDomain: 'pawblossom.example', bindingKey,
  getSecretKey: async () => secret};
const input = {sessionTicket: ticket};
const instances: PlayFabSessionAuthenticator[] = [];
const folders: string[] = [];
const error = (code: string) => ({kind: 'session-error', code});
function fixture(): Record<string, any> {
  return {code: 200, status: 'OK', data: {IsSessionTicketExpired: false,
    UserInfo: {PlayFabId: providerId, PrivateInfo: {Email: pii}, Username: 'synthetic-private-user'}}};
}
function response(body: unknown = fixture(), options: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}, ...options});
}
function open(patch: Partial<PlayFabSessionConfig> = {}, transport = vi.fn<typeof fetch>(async () => response())) {
  const options = {...config, ...patch};
  const auth = new PlayFabSessionAuthenticator(options, transport); instances.push(auth);
  return {auth, transport, options};
}
function bodyHarness(body: unknown) {return open({}, vi.fn<typeof fetch>(async () => response(body)));}
function deferred<T>() {let resolve!: (v: T) => void, reject!: (v: unknown) => void;
  const promise = new Promise<T>((r, j) => {resolve = r; reject = j;}); return {promise, resolve, reject};}
async function flush() {for (let n = 0; n < 20; n++) await Promise.resolve();}
function raw(text: string, headers: HeadersInit = {'content-type': 'application/json'}) {return new Response(text, {headers});}
function folder() {const dir = mkdtempSync(join(tmpdir(), 'pawblossom-auth-')); folders.push(dir); return dir;}
afterEach(() => {
  instances.splice(0).forEach(auth => auth.close());
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  // 이 테스트에서 생성한 임시 폴더만 제거합니다.
  folders.splice(0).forEach(dir => rmSync(dir, {recursive: true, force: true}));
});

describe('선택형 서버 PlayFab 세션 검증·최소 owner context', () => {
  it('생성 시 통신하지 않고 고정 POST에만 ticket/key를 전달합니다', async () => {
    const {auth, transport} = open(); expect(transport).not.toHaveBeenCalled();
    const result = await auth.authenticate(input);
    expect(transport).toHaveBeenCalledExactlyOnceWith('https://1a2b3.playfabapi.com/Server/AuthenticateSessionTicket', {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: {'X-SecretKey': secret, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({SessionTicket: ticket}), signal: expect.any(AbortSignal),
    });
    expect(result.kind).toBe('authenticated');
    if (result.kind !== 'authenticated') throw new Error('fixture');
    expect(Object.keys(result)).toEqual(['kind', 'context']);
    expect(Object.keys(result.context)).toEqual(['ownerId', 'expectedObfuscatedAccountId']);
    expect(result.context.ownerId).toMatch(/^[a-f0-9]{64}$/);
    expect(result.context.expectedObfuscatedAccountId).toMatch(/^[a-f0-9]{64}$/);
    expect(result.context.expectedObfuscatedAccountId).not.toBe(result.context.ownerId);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.context)).toBe(true);
    expect(() => {Reflect.set(result.context, 'ownerId', 'forged');}).not.toThrow();
    const expected = createHmac('sha256', bindingKey).update(JSON.stringify([
      'pawblossom-session-v1', config.bindingDomain, config.titleId, config.environment, 'owner', providerId,
    ])).digest('hex');
    expect(result.context.ownerId).toBe(expected);
    for (const value of [ticket, secret, providerId, pii, 'PrivateInfo', 'PlayFabId', 'synthetic-private-user']) expect(JSON.stringify(result)).not.toContain(value);
  });
  it('동일 계정은 ticket/PII 변경·새 instance에도 안정적이며 성공 캐시가 없습니다', async () => {
    const {auth, transport} = open();
    const a = await auth.authenticate(input), b = await auth.authenticate({sessionTicket: 'synthetic-other-ticket'});
    expect(b).toEqual(a); expect(transport).toHaveBeenCalledTimes(2);
    expect(await open().auth.authenticate(input)).toEqual(a);
    const body = fixture(); body.data.UserInfo = {PlayFabId: providerId.toLowerCase(), arbitraryPii: ['unused']};
    expect(await bodyHarness(body).auth.authenticate(input)).toEqual(a);
  });
  it.each([
    {titleId: '1A2B4'}, {environment: 'test' as const}, {bindingDomain: 'another.example'}, {bindingKey: new Uint8Array(32).fill(54)},
  ])('title/environment/domain/key 변경은 소유자와 Google binding을 분리합니다: %j', async patch => {
    const a = await open().auth.authenticate(input), b = await open(patch).auth.authenticate(input);
    expect(a.kind).toBe('authenticated'); expect(b.kind).toBe('authenticated');
    if (a.kind === 'authenticated' && b.kind === 'authenticated') {
      expect(b.context.ownerId).not.toBe(a.context.ownerId);
      expect(b.context.expectedObfuscatedAccountId).not.toBe(a.context.expectedObfuscatedAccountId);
    }
  });
  it('title의 대소문자를 정규화합니다', async () => {
    expect(await open({titleId: '1a2b3'}).auth.authenticate(input)).toEqual(await open().auth.authenticate(input));
  });
  it('대문자 title 구성도 native Fetch의 canonical response.url을 허용합니다', async () => {
    const res = response();
    Object.defineProperty(res, 'url', {value: new URL('https://1A2B3.playfabapi.com/Server/AuthenticateSessionTicket').href});
    const {auth, transport} = open({}, vi.fn<typeof fetch>(async () => res));
    expect((await auth.authenticate(input)).kind).toBe('authenticated');
    expect(transport.mock.calls[0][0]).toBe(res.url);
  });
  it('expired는 인증 context를 반환하지 않습니다', async () => {
    const body = fixture(); body.data.IsSessionTicketExpired = true;
    expect(await bodyHarness(body).auth.authenticate(input)).toEqual(error('session-expired'));
  });
  it('서로 다른 provider 계정은 다른 소유자이며 부가 PII의 JSON 문자열은 인증에 영향을 주지 않습니다', async () => {
    const a = await open().auth.authenticate(input), body = fixture();
    body.data.UserInfo.PlayFabId = 'FEDCBA9876543210';
    body.data.UserInfo.PrivateInfo = {Email: '합성\\"{}[],:값', nesting: [{value: null, bool: true, n: 1.25}]};
    const b = await bodyHarness(body).auth.authenticate(input);
    expect(b.kind).toBe('authenticated'); expect(b).not.toEqual(a);
  });
  it.each([null, [], '', {}, {code: 200}, {code: '200', status: 'OK', data: fixture().data},
    {code: 400, status: 'OK', data: fixture().data}, {code: 200, status: 'ok', data: fixture().data},
    {...fixture(), error: 'synthetic-private-error'}, {...fixture(), future: true}, {...fixture(), data: null},
    {...fixture(), data: {...fixture().data, future: true}},
    {...fixture(), data: {IsSessionTicketExpired: false, UserInfo: null}},
    {...fixture(), data: {IsSessionTicketExpired: false, UserInfo: []}},
    {...fixture(), data: {IsSessionTicketExpired: 'false', UserInfo: fixture().data.UserInfo}},
    {...fixture(), data: {UserInfo: fixture().data.UserInfo}},
  ])('성공처럼 보이는 잘못된 wrapper/data를 거절합니다: %j', async body => {
    expect(await bodyHarness(body).auth.authenticate(input)).toEqual(error('invalid-response'));
  });
  it.each([undefined, null, 0, '', 'abc', '1'.repeat(15), '1'.repeat(17), 'G'.repeat(16), '0'.repeat(15) + '\n', ' 0123456789ABCDEF'])('자체 ID profile 밖 응답을 닫습니다: %j', async id => {
    const body = fixture(); body.data.UserInfo.PlayFabId = id;
    expect(await bodyHarness(body).auth.authenticate(input)).toEqual(error('invalid-response'));
  });
});

describe('설정·입력 snapshot과 키 수명', () => {
  it.each([
    {titleId: ''}, {titleId: '../evil'}, {titleId: 'https://evil.invalid'}, {titleId: '1'.repeat(17)}, {titleId: 'ABC\n'},
    {environment: 'unknown'}, {bindingDomain: ''}, {bindingDomain: 'a\0b'}, {bindingDomain: 'A'}, {bindingDomain: 'a'.repeat(65)},
    {bindingKey: new Uint8Array(31)}, {bindingKey: new Uint8Array(33)}, {bindingKey: null}, {getSecretKey: null},
    ...['timeoutMs', 'maxConcurrent', 'maxResponseBytes', 'maxReads'].flatMap(k => [0, -1, NaN, Infinity, 1.5, '1', null].map(v => ({[k]: v}))),
    {timeoutMs: 5001}, {maxConcurrent: 33}, {maxResponseBytes: 65_537}, {maxReads: 257},
  ])('잘못된 설정은 고정 오류로 실패합니다: %j', patch => {
    const transport = vi.fn<typeof fetch>();
    expect(() => new PlayFabSessionAuthenticator({...config, ...patch} as PlayFabSessionConfig, transport)).toThrow('invalid-session-config');
    expect(transport).not.toHaveBeenCalled();
  });
  it('설정 getter/transport 오류도 원문을 노출하지 않습니다', () => {
    const options = {...config}; Object.defineProperty(options, 'titleId', {get() {throw new Error(secret);}});
    expect(() => new PlayFabSessionAuthenticator(options)).toThrow(/^invalid-session-config$/);
    expect(() => new PlayFabSessionAuthenticator(config, null as unknown as typeof fetch)).toThrow(/^invalid-session-config$/);
  });
  it('설정의 각 getter는 한 번만 읽고 선택 한도의 명시적 undefined만 기본값으로 대체합니다', async () => {
    const options = {...config, timeoutMs: undefined, maxConcurrent: undefined, maxReads: undefined, maxResponseBytes: undefined};
    const getters = Object.keys(options).map(k => {
      const value = options[k as keyof typeof options], getter = vi.fn(() => value);
      Object.defineProperty(options, k, {get: getter}); return getter;
    });
    const auth = new PlayFabSessionAuthenticator(options, vi.fn<typeof fetch>(async () => response())); instances.push(auth);
    expect((await auth.authenticate(input)).kind).toBe('authenticated'); getters.forEach(get => expect(get).toHaveBeenCalledOnce());
  });
  it('복제한 키를 구성 실패/close에 지우고 caller 키는 보존합니다', async () => {
    const from = Buffer.from, clones: Buffer[] = [];
    vi.spyOn(Buffer, 'from').mockImplementation((...args: any[]) => {
      const value = Reflect.apply(from, Buffer, args) as Buffer<ArrayBuffer>;
      if (args[0] === bindingKey) clones.push(value); return value;
    });
    expect(() => new PlayFabSessionAuthenticator({...config, titleId: 'invalid'})).toThrow();
    expect(clones[0]).toEqual(Buffer.alloc(32));
    const {auth} = open(); expect(clones[1]).toEqual(Buffer.from(bindingKey));
    auth.close(); auth.close(); expect(clones[1]).toEqual(Buffer.alloc(32));
    expect([...bindingKey]).toEqual(new Array(32).fill(53));
    expect(await auth.authenticate(input)).toEqual(error('closed'));
  });
  it('설정 객체·caller 키를 나중에 변경해도 처음 snapshot을 사용합니다', async () => {
    const key = new Uint8Array(bindingKey), options = {...config, bindingKey: key};
    const transport = vi.fn<typeof fetch>(async () => response());
    const auth = new PlayFabSessionAuthenticator(options, transport); instances.push(auth);
    key.fill(0); options.titleId = 'BAD'; options.environment = 'test'; options.bindingDomain = 'other';
    options.getSecretKey = async () => 'other-secret'; options.timeoutMs = 1;
    expect(await auth.authenticate(input)).toEqual(await open().auth.authenticate(input));
    expect(transport.mock.calls[0][0]).toContain('1a2b3.playfabapi.com');
    expect((transport.mock.calls[0][1]!.headers as Record<string, string>)['X-SecretKey']).toBe(secret);
  });
  it.each([null, [], {}, '', {sessionTicket: null}, {sessionTicket: ''}, {sessionTicket: 'x'.repeat(4097)},
    {sessionTicket: 'white space'}, {sessionTicket: 'x\r\nsecret'}, {sessionTicket: '한글'},
    {sessionTicket: ticket, ownerId: 'forged'}, {sessionTicket: ticket, context: {ownerId: 'forged'}},
    {sessionTicket: ticket, signal: {}}, {sessionTicket: ticket, signal: null},
  ])('잘못된 입력/가짜 context는 비밀 공급 전 거절합니다: %j', async value => {
    const getSecretKey = vi.fn(async () => secret), {auth, transport} = open({getSecretKey});
    expect(await auth.authenticate(value as PlayFabSessionInput)).toEqual(error('invalid-input'));
    expect(getSecretKey).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('ticket/signal getter 실패는 reject나 원문 없이 닫습니다', async () => {
    for (const field of ['sessionTicket', 'signal']) {
      const value = {...input}; Object.defineProperty(value, field, {get() {throw new Error(pii);}});
      expect(await open().auth.authenticate(value)).toEqual(error('invalid-input'));
    }
  });
  it('input을 secret 대기 중 변경해도 검증한 ticket과 signal만 사용합니다', async () => {
    const key = deferred<string>(), controller = new AbortController(), value = {...input, signal: controller.signal};
    const {auth, transport} = open({getSecretKey: () => key.promise});
    const pending = auth.authenticate(value); value.sessionTicket = 'changed'; value.signal = new AbortController().signal;
    key.resolve(secret); expect((await pending).kind).toBe('authenticated');
    expect(transport.mock.calls[0][1]!.body).toBe(JSON.stringify({SessionTicket: ticket}));
  });
  it('입력 getter는 한 번 snapshot하며 최대 ticket 길이도 opaque 그대로 전달합니다', async () => {
    const get = vi.fn(() => 'x'.repeat(4096)), {auth, transport} = open();
    expect((await auth.authenticate({get sessionTicket() {return get();}})).kind).toBe('authenticated');
    expect(get).toHaveBeenCalledOnce(); expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual({SessionTicket: 'x'.repeat(4096)});
  });
  it('input getter 중 close되어도 통신을 시작하지 않습니다', async () => {
    const {auth, transport} = open();
    const value = {get sessionTicket() {auth.close(); return ticket;}};
    expect(await auth.authenticate(value)).toEqual(error('closed')); expect(transport).not.toHaveBeenCalled();
  });
});

describe('HTTP/본문 한도·비공개 오류', () => {
  it.each([[301, 'redirect-blocked'], [302, 'redirect-blocked'], [307, 'redirect-blocked'], [401, 'unauthenticated'],
    [403, 'forbidden'], [429, 'rate-limited'], [500, 'upstream-unavailable'], [503, 'upstream-unavailable'],
    [400, 'unexpected-http'], [204, 'unexpected-http'], [201, 'unexpected-http'],
  ])('HTTP %s를 내부 코드로만 반환하고 본문을 읽지 않습니다', async (status, code) => {
    const cancel = vi.fn(async () => {}), read = vi.fn();
    const res = {status, redirected: false, url: '', body: {cancel, getReader: read}} as unknown as Response;
    const result = await open({}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input);
    expect(result).toEqual(error(code as string)); expect(Object.isFrozen(result)).toBe(true);
    expect(read).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([{redirected: true}, {type: 'opaqueredirect'}, {url: 'https://evil.invalid/'},
    {url: 'https://1A2B3.playfabapi.com/Server/AuthenticateSessionTicket?x=1'}])('redirect/url mismatch를 닫습니다: %j', async patch => {
    const res = response(); Object.entries(patch).forEach(([k,v]) => Object.defineProperty(res, k, {value: v}));
    expect(await open({}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input)).toEqual(error('redirected' in patch || 'type' in patch ? 'redirect-blocked' : 'invalid-response'));
  });
  it.each([undefined, null, '', 'bad key', 'x\nkey', '한글', 'x'.repeat(8193)])('잘못된 secret 공급은 transport를 호출하지 않습니다: %j', async value => {
    const {auth, transport} = open({getSecretKey: async () => value as string});
    expect(await auth.authenticate(input)).toEqual(error('secret-unavailable')); expect(transport).not.toHaveBeenCalled();
  });
  it('secret 공급의 동기 throw/비동기 reject와 fetch 오류를 비공개 처리합니다', async () => {
    for (const getSecretKey of [() => {throw new Error(secret);}, async () => {throw new Error(pii);}]) {
      expect(await open({getSecretKey}).auth.authenticate(input)).toEqual(error('secret-unavailable'));
    }
    for (const transport of [() => {throw new Error(ticket);}, async () => {throw new Error(pii);}]) {
      expect(await open({}, vi.fn<typeof fetch>(transport)).auth.authenticate(input)).toEqual(error('transport-error'));
    }
  });
  it.each(['text/html', '', 'application/jsonp', 'application/json-bad'])('JSON content-type만 받습니다: %j', async type => {
    expect(await open({}, vi.fn<typeof fetch>(async () => raw('{}', {'content-type': type}))).auth.authenticate(input)).toEqual(error('invalid-response'));
  });
  it.each(['-1', 'NaN', '1.2', '9007199254740992', ' 100', '100 '])('잘못된 content-length를 거절합니다: %j', async length => {
    const res = response(); const get = res.headers.get.bind(res.headers);
    vi.spyOn(res.headers, 'get').mockImplementation(k => k === 'content-length' ? length : get(k));
    expect(await open({}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input)).toEqual(error('invalid-response'));
  });
  it('선언/실제 bytes/읽기 횟수 한도를 독립 검사합니다', async () => {
    expect(await open({maxResponseBytes: 10}).auth.authenticate(input)).toEqual(error('response-too-large'));
    const declared = response(undefined, {headers: {'content-type': 'application/json', 'content-length': '65537'}});
    expect(await open({}, vi.fn<typeof fetch>(async () => declared)).auth.authenticate(input)).toEqual(error('response-too-large'));
    expect(await open({maxReads: 1}).auth.authenticate(input)).toEqual(error('limit-exceeded'));
  });
  it.each(['{', 'null', '[]', '{"code":200,"code":200}',
    JSON.stringify(fixture()).replace('"code":200', '"code":400,"co\\u0064e":200'),
    JSON.stringify(fixture()).replace('"IsSessionTicketExpired":false', '"IsSessionTicketExpired":true,"IsSessionTicketExpired":false'),
    JSON.stringify(fixture()).replace('"PlayFabId":', '"PlayFabId":"FEDCBA9876543210","PlayFabId":'),
    '{"nested":' + '['.repeat(34) + '0' + ']'.repeat(34) + '}',
  ])('불완전/중복/과도한 JSON을 닫습니다: %s', async text => {
    const expected = ['null', '[]'].includes(text) ? 'invalid-response' : 'invalid-json';
    expect(await open({}, vi.fn<typeof fetch>(async () => raw(text))).auth.authenticate(input)).toEqual(error(expected));
  });
  it('잘못된 UTF-8을 거절하고 정상 분할 UTF-8 부가 PII는 버립니다', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({...fixture(), data: {...fixture().data, UserInfo: {PlayFabId: providerId, Username: '합성'}}}));
    const stream = new ReadableStream<Uint8Array>({start(c) {for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close();}});
    // 작은 chunk가 읽기 횟수 상한을 넘지 않는 응답입니다.
    expect(bytes.length).toBeLessThan(256);
    expect((await open({}, vi.fn<typeof fetch>(async () => new Response(stream, {headers: {'content-type': 'application/json'}}))).auth.authenticate(input)).kind).toBe('authenticated');
    const bad = new Response(new Uint8Array([0xff]), {headers: {'content-type': 'application/json'}});
    expect(await open({}, vi.fn<typeof fetch>(async () => bad)).auth.authenticate(input)).toEqual(error('invalid-json'));
  });
  it.each(['status', 'redirected', 'type', 'url', 'headers', 'body'])('응답 %s getter throw를 비공개 처리합니다', async field => {
    const res = response(); Object.defineProperty(res, field, {get() {throw new Error(pii);}});
    expect(await open({}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input)).toEqual(error('transport-error'));
  });
  it('본문/reader getter·read 오류와 cancel throw/reject를 관찰합니다', async () => {
    for (const cancel of [() => {throw new Error(secret);}, async () => {throw new Error(secret);}, async () => {}]) {
      const res = {status: 200, headers: new Headers({'content-type': 'application/json'}), body: {getReader() {throw new Error(ticket);}, cancel}} as unknown as Response;
      expect(await open({}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input)).toEqual(error('transport-error'));
    }
    const cancel = vi.fn(async () => {throw new Error(pii);});
    const res = {status: 200, headers: new Headers({'content-type': 'application/json'}), body: {getReader() {return {read: async () => {throw new Error(pii);}, cancel};}}} as unknown as Response;
    expect(await open({}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input)).toEqual(error('transport-error')); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([null, {}, {done: 'true'}, {done: false, value: 'raw'}, {done: true, value: new Uint8Array([1])}])('잘못된 read 결과는 인증이 될 수 없습니다: %j', async chunk => {
    const cancel = vi.fn(async () => {}), res = {status: 200, headers: new Headers({'content-type': 'application/json'}),
      body: {getReader: () => ({read: async () => chunk, cancel})}} as unknown as Response;
    expect(await open({}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input)).toEqual(error('invalid-response')); expect(cancel).toHaveBeenCalledOnce();
  });
  it('native Response의 정확한 본문 byte 수와 파라미터 있는 JSON content-type을 허용합니다', async () => {
    const text = JSON.stringify(fixture()), res = raw(text, {'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(text))});
    expect((await open({maxResponseBytes: Buffer.byteLength(text)}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input)).kind).toBe('authenticated');
  });
  it('Fetch 압축 해제 뒤 body와 wire Content-Length 차이를 인증 실패로 오인하지 않습니다', async () => {
    // 네트워크 압축 검증이 아닌, Fetch가 반환하는 해제된 body/원래 헤더의 합성 모델입니다.
    const res = response(undefined, {headers: {'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '10'}});
    expect((await open({}, vi.fn<typeof fetch>(async () => res)).auth.authenticate(input)).kind).toBe('authenticated');
  });
  it('로그 함수를 호출하지 않고 PII를 결과에 붙이지 않습니다', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const body = {...fixture(), errorMessage: pii};
    const result = await bodyHarness(body).auth.authenticate(input);
    expect(result).toEqual(error('invalid-response')); logs.forEach(log => expect(log).not.toHaveBeenCalled());
  });
});

describe('전체 기한·취소·늦은 작업과 동시 caller 상한', () => {
  it('사전 abort는 secret/transport를 시작하지 않습니다', async () => {
    const c = new AbortController(); c.abort(); const getSecretKey = vi.fn(async () => secret), {auth, transport} = open({getSecretKey});
    expect(await auth.authenticate({...input, signal: c.signal})).toEqual(error('aborted'));
    expect(getSecretKey).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('secret hang은 5초 종료·슬롯 유지·늦은 secret 후 transport 0회와 복구입니다', async () => {
    vi.useFakeTimers(); const key = deferred<string>(), getSecretKey = vi.fn(() => key.promise);
    const {auth, transport} = open({maxConcurrent: 1, getSecretKey});
    const pending = auth.authenticate(input); await vi.advanceTimersByTimeAsync(4999);
    let done = false; void pending.then(() => {done = true;}); await flush(); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toEqual(error('timeout'));
    for (let i = 0; i < 50; i++) expect(await auth.authenticate(input)).toEqual(error('busy'));
    expect(getSecretKey).toHaveBeenCalledOnce(); expect(transport).not.toHaveBeenCalled();
    key.resolve(secret); await flush(); expect(transport).not.toHaveBeenCalled();
    expect((await auth.authenticate(input)).kind).toBe('authenticated');
  });
  it('timeout 뒤 secret reject를 관찰하며 슬롯이 복구됩니다', async () => {
    vi.useFakeTimers(); const key = deferred<string>(), {auth, transport} = open({maxConcurrent: 1, getSecretKey: () => key.promise});
    const pending = auth.authenticate(input); await vi.advanceTimersByTimeAsync(5000); expect(await pending).toEqual(error('timeout'));
    key.reject(new Error(pii)); await flush();
    expect(await auth.authenticate(input)).toEqual(error('secret-unavailable')); expect(transport).not.toHaveBeenCalled();
  });
  it('secret·fetch·body가 각각 통과해도 합계 기한을 넘으면 닫습니다', async () => {
    vi.useFakeTimers(); const key = deferred<string>(), fetched = deferred<Response>(), read = deferred<ReadableStreamReadResult<Uint8Array>>();
    const cancel = vi.fn(async () => {});
    const res = {status: 200, headers: new Headers({'content-type': 'application/json'}), body: {getReader: () => ({read: () => read.promise, cancel})}} as unknown as Response;
    const {auth} = open({getSecretKey: () => key.promise}, vi.fn<typeof fetch>(() => fetched.promise));
    const result = auth.authenticate(input); await vi.advanceTimersByTimeAsync(2000); key.resolve(secret); await flush();
    await vi.advanceTimersByTimeAsync(2000); fetched.resolve(res); await flush();
    await vi.advanceTimersByTimeAsync(1000); expect(await result).toEqual(error('timeout')); expect(cancel).toHaveBeenCalledOnce();
    read.resolve({done: true, value: undefined}); await flush();
  });
  it.each(['resolve', 'reject'] as const)('비협조 fetch가 늦게 %s해도 새 호출 누적/성공/미관찰 reject가 없습니다', async completion => {
    vi.useFakeTimers(); const fetched = deferred<Response>(), cancel = vi.fn(async () => {}), read = vi.fn();
    const transport = vi.fn<typeof fetch>(() => fetched.promise), {auth} = open({maxConcurrent: 1}, transport);
    const pending = auth.authenticate(input); await flush(); await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual(error('timeout'));
    for (let i = 0; i < 50; i++) expect(await auth.authenticate(input)).toEqual(error('busy'));
    expect(transport).toHaveBeenCalledOnce();
    if (completion === 'resolve') fetched.resolve({body: {cancel, getReader: read}} as unknown as Response); else fetched.reject(new Error(secret));
    await flush(); expect(read).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(completion === 'resolve' ? 1 : 0);
  });
  it('body read hang과 cancel hang이 슬롯을 유지하며 caller는 기한에 반환합니다', async () => {
    vi.useFakeTimers(); const chunk = deferred<ReadableStreamReadResult<Uint8Array>>(), cancelled = deferred<void>();
    const cancel = vi.fn(() => cancelled.promise), read = vi.fn(() => chunk.promise);
    const res = {status: 200, headers: new Headers({'content-type': 'application/json'}), body: {getReader: () => ({read, cancel})}} as unknown as Response;
    const {auth, transport} = open({maxConcurrent: 1}, vi.fn<typeof fetch>(async () => res));
    const pending = auth.authenticate(input); await flush(); await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual(error('timeout')); expect(await auth.authenticate(input)).toEqual(error('busy'));
    chunk.resolve({done: true, value: undefined}); await flush(); expect(await auth.authenticate(input)).toEqual(error('busy'));
    expect(cancel).toHaveBeenCalledOnce(); expect(transport).toHaveBeenCalledOnce();
    cancelled.resolve(); await flush();
  });
  it('읽기 완료 뒤 cancel hang도 시간 한도와 caller 상한에 포함합니다', async () => {
    vi.useFakeTimers(); const cancelled = deferred<void>();
    const bytes = new TextEncoder().encode(JSON.stringify(fixture())); let n = 0;
    const reader = {read: async () => n++ === 0 ? {done: false, value: bytes} : {done: true, value: undefined}, cancel: () => cancelled.promise};
    const res = {status: 200, headers: new Headers({'content-type': 'application/json'}), body: {getReader: () => reader}} as unknown as Response;
    const {auth} = open({maxConcurrent: 1}, vi.fn<typeof fetch>(async () => res)); const pending = auth.authenticate(input); await flush();
    await vi.advanceTimersByTimeAsync(5000); expect(await pending).toEqual(error('timeout')); expect(await auth.authenticate(input)).toEqual(error('busy'));
    cancelled.resolve(); await flush();
  });
  it('진행 중 abort·close는 즉시 종료하고 비밀 공급 signal도 abort합니다', async () => {
    for (const action of ['abort', 'close']) {
      const key = deferred<string>(), c = new AbortController(); let suppliedSignal: AbortSignal | undefined;
      const {auth, transport} = open({getSecretKey: signal => {suppliedSignal = signal; return key.promise;}});
      const pending = auth.authenticate({...input, signal: c.signal});
      if (action === 'abort') c.abort(); else auth.close();
      expect(await pending).toEqual(error(action === 'abort' ? 'aborted' : 'closed')); expect(suppliedSignal?.aborted).toBe(true);
      key.resolve(secret); await flush(); expect(transport).not.toHaveBeenCalled();
    }
  });
  it('close는 진행 중 fetch/stream의 늦은 응답도 취소하며 재호출을 막습니다', async () => {
    const fetched = deferred<Response>(), cancel = vi.fn(async () => {}), read = vi.fn();
    const {auth} = open({}, vi.fn<typeof fetch>(() => fetched.promise)); const pending = auth.authenticate(input); await flush();
    auth.close(); expect(await pending).toEqual(error('closed'));
    fetched.resolve({body: {cancel, getReader: read}} as unknown as Response); await flush();
    expect(cancel).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled(); expect(await auth.authenticate(input)).toEqual(error('closed'));
  });
  it('실제 ReadableStream read 대기 중 caller abort와 close가 native cancel을 호출합니다', async () => {
    for (const action of ['abort', 'close']) {
      const cancel = vi.fn(async () => {}), stream = new ReadableStream<Uint8Array>({cancel});
      const c = new AbortController(), {auth} = open({}, vi.fn<typeof fetch>(async () => new Response(stream, {headers: {'content-type': 'application/json'}})));
      const pending = auth.authenticate({...input, signal: c.signal}); await flush();
      if (action === 'abort') c.abort(); else auth.close();
      expect(await pending).toEqual(error(action === 'abort' ? 'aborted' : 'closed')); await flush(); expect(cancel).toHaveBeenCalledOnce();
    }
  });
  it('동시 호출은 지정 상한만 시작하고 대기 queue를 만들지 않습니다', async () => {
    const keys = [deferred<string>(), deferred<string>()], getSecretKey = vi.fn(() => keys[getSecretKey.mock.calls.length - 1].promise);
    const {auth} = open({maxConcurrent: 2, getSecretKey}); const a = auth.authenticate(input), b = auth.authenticate(input);
    const results = await Promise.all(Array.from({length: 100}, () => auth.authenticate(input)));
    expect(results.every(r => JSON.stringify(r) === JSON.stringify(error('busy')))).toBe(true); expect(getSecretKey).toHaveBeenCalledTimes(2);
    auth.close(); expect(await a).toEqual(error('closed')); expect(await b).toEqual(error('closed'));
    keys.forEach(k => k.reject(new Error(secret))); await flush();
  });
  it('호출 종료 시 timer와 caller abort listener를 제거합니다', async () => {
    vi.useFakeTimers(); const c = new AbortController(), add = vi.spyOn(c.signal, 'addEventListener'), remove = vi.spyOn(c.signal, 'removeEventListener');
    const {auth} = open(); expect((await auth.authenticate({...input, signal: c.signal})).kind).toBe('authenticated');
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('실제 SQLite 구매/보상 원장 context 호환 (운영 연결 아님)', () => {
  it('인증 context를 구매 원장·서버 round 보상 원장에 전달하고 재시작에도 같은 소유자를 찾습니다', async () => {
    const dir = folder(), result = await open().auth.authenticate(input);
    if (result.kind !== 'authenticated') throw new Error('fixture');
    const context = result.context, purchasePath = join(dir, 'purchase.sqlite'), rewardPath = join(dir, 'reward.sqlite');
    const purchaseOptions = {databasePath: purchasePath, serverKey: new Uint8Array(32).fill(61),
      purchase: {packageName: 'com.example.pawblossom', productId: 'remove_ads', purchaseOptionId: 'permanent', mode: 'production' as const},
      getAccessToken: async () => 'synthetic-oauth', acknowledge: async () => 'acknowledged' as const,
      lookupTransport: vi.fn<typeof fetch>(async () => response({purchaseStateContext: {purchaseState: 'PURCHASED'},
        acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING', obfuscatedExternalAccountId: context.expectedObfuscatedAccountId,
        productLineItem: [{productId: 'remove_ads', productOfferDetails: {purchaseOptionId: 'permanent', quantity: 1,
          refundableQuantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}]}))};
    let purchase = new PurchaseLedger(purchaseOptions);
    const rewardOptions = {databasePath: rewardPath, serverKey: new Uint8Array(32).fill(67), policy,
      dependencies: {transport: vi.fn<typeof fetch>(async () => keyResponse()), now: () => epoch}};
    let reward = new RewardLedger(rewardOptions);
    // roundId는 로그인 응답/클라이언트 body가 아닌 신뢰된 게임 계층이 공급해야 합니다.
    const round = {ownerId: context.ownerId, roundId: 'synthetic-server-round'};
    try {
      expect(await purchase.process('synthetic-purchase-token', context)).toMatchObject({kind: 'entitled', newGrant: true});
      const claim = reward.issueClaim(round, policy.adUnits[0]); if (claim.kind !== 'claim-issued') throw new Error('fixture');
      expect(await reward.processCallback(callback({custom_data: claim.customData, user_id: claim.userId}))).toEqual({kind: 'voucher-recorded', newGrant: true});
      expect(reward.hasVoucher(round)).toEqual({kind: 'voucher-status', present: true});
      purchase.close(); reward.close(); purchase = new PurchaseLedger(purchaseOptions); reward = new RewardLedger(rewardOptions);
      const again = await open().auth.authenticate({sessionTicket: 'another-synthetic-ticket'});
      if (again.kind !== 'authenticated') throw new Error('fixture');
      expect(purchase.hasEntitlement(again.context.ownerId)).toBe(true);
      expect(reward.hasVoucher({...round, ownerId: again.context.ownerId})).toEqual({kind: 'voucher-status', present: true});
      const other = await open({environment: 'test'}).auth.authenticate(input);
      if (other.kind !== 'authenticated') throw new Error('fixture');
      expect(purchase.hasEntitlement(other.context.ownerId)).toBe(false);
      expect(await purchase.process('synthetic-purchase-token', other.context)).toEqual({kind: 'rejected', reason: 'account-binding-failed'});
      expect(reward.hasVoucher({...round, ownerId: other.context.ownerId})).toEqual({kind: 'voucher-status', present: false});
      for (const file of readdirSync(dir)) for (const raw of [ticket, secret, pii, providerId]) expect(readFileSync(join(dir, file)).includes(Buffer.from(raw))).toBe(false);
      const db = new DatabaseSync(purchasePath); try {expect(db.prepare('SELECT count(*) AS n FROM entitlements').get()?.n).toBe(1);} finally {db.close();}
    } finally {purchase.close(); reward.close();}
  });
});
