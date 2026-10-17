/** 서버 전용 선택형 PlayFab 어댑터입니다. 앱 import·자동 통신·환경/파일 키 읽기 없음. */
import {createHmac} from 'node:crypto';
import {strictSessionJson} from './strictSessionJson.ts';

export interface PlayFabSessionConfig {
  readonly titleId: string;
  readonly environment: 'production' | 'test';
  /** 앱/서비스마다 고정한 서버 namespace입니다. 요청 body에서 가져오지 않습니다. */
  readonly bindingDomain: string;
  /** 원장 키와 별도로 관리하는 안정적인 32바이트 키를 주입합니다. */
  readonly bindingKey: Uint8Array;
  readonly getSecretKey: (signal: AbortSignal) => Promise<string>;
  readonly timeoutMs?: number;
  readonly maxConcurrent?: number;
  readonly maxResponseBytes?: number;
  readonly maxReads?: number;
}
export interface PlayFabSessionInput {
  readonly sessionTicket: string;
  readonly signal?: AbortSignal;
}
export interface AuthenticatedOwner {
  readonly ownerId: string;
  readonly expectedObfuscatedAccountId: string;
}
export type SessionErrorCode = 'invalid-input' | 'closed' | 'busy' | 'aborted' | 'timeout'
  | 'secret-unavailable' | 'transport-error' | 'redirect-blocked' | 'unauthenticated'
  | 'forbidden' | 'rate-limited' | 'upstream-unavailable' | 'unexpected-http'
  | 'invalid-response' | 'invalid-json' | 'response-too-large' | 'limit-exceeded' | 'session-expired';
/** 현재 요청 내부용입니다. 로그인 성공 캐시·장기 세션·클라이언트 증명서가 아닙니다. */
export type PlayFabSessionResult = {readonly kind: 'authenticated'; readonly context: Readonly<AuthenticatedOwner>}
  | {readonly kind: 'session-error'; readonly code: SessionErrorCode};
type Policy = Omit<Required<PlayFabSessionConfig>, 'bindingKey'>;
type StopCode = 'aborted' | 'timeout' | 'closed';
interface Operation {stop: (code: StopCode) => void}
const failure = (code: SessionErrorCode): PlayFabSessionResult => Object.freeze({kind: 'session-error', code});
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const ascii = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[\x21-\x7e]+$/.test(v);
const integer = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= max;
const keys = (v: object, allowed: string[]) => Reflect.ownKeys(v).every(k => typeof k === 'string' && allowed.includes(k));

/**
 * 자체 엄격 profile이며 실제 PlayFab 호환 검증은 남아 있습니다. 생성자는 통신하지 않습니다.
 * 비협조 비동기 작업/취소가 남으면 슬롯을 보존하여 새 transport 누적을 막습니다.
 * close는 호출자를 끝내고 내부 키를 지우지만 외부 작업/JS 문자열의 강제 소거는 못 합니다.
 */
export class PlayFabSessionAuthenticator {
  #key: Buffer;
  #policy: Policy;
  #transport: typeof fetch;
  #operations = new Set<Operation>();
  #closed = false;

  constructor(config: PlayFabSessionConfig, transport: typeof fetch = globalThis.fetch) {
    let key: Buffer | undefined;
    try {
      // 뒤의 구성 getter가 실패해도 이미 복제한 키를 지웁니다. caller 소유 키는 변경하지 않습니다.
      const supplied = config.bindingKey;
      if (!(supplied instanceof Uint8Array) || supplied.byteLength !== 32) throw new Error();
      key = Buffer.from(supplied);
      const {titleId, environment, bindingDomain, getSecretKey, timeoutMs = 5000,
        maxConcurrent = 8, maxResponseBytes = 65_536, maxReads = 256} = config;
      const p: Policy = {titleId, environment, bindingDomain, getSecretKey, timeoutMs, maxConcurrent, maxResponseBytes, maxReads};
      // title/ID 길이·문자 규칙은 공식 API의 보장 범위가 아닌 이 어댑터의 profile입니다.
      if (typeof p.titleId !== 'string' || !/^[A-Fa-f0-9]{1,16}$/.test(p.titleId)
        || !['production', 'test'].includes(p.environment) || typeof p.bindingDomain !== 'string'
        || !/^[a-z][a-z0-9.-]{0,63}$/.test(p.bindingDomain) || typeof p.getSecretKey !== 'function'
        || typeof transport !== 'function' || !integer(p.timeoutMs, 5000) || !integer(p.maxConcurrent, 32)
        || !integer(p.maxResponseBytes, 65_536) || !integer(p.maxReads, 256)) throw new Error();
      this.#key = key; this.#policy = Object.freeze({...p, titleId: p.titleId.toUpperCase()}); this.#transport = transport;
    } catch {key?.fill(0); throw new Error('invalid-session-config');}
  }

  async authenticate(input: PlayFabSessionInput): Promise<PlayFabSessionResult> {
    const started = performance.now();
    if (this.#closed) return failure('closed');
    if (this.#operations.size >= this.#policy.maxConcurrent) return failure('busy');
    let ticket: string, signal: AbortSignal | undefined;
    try {
      if (!object(input) || !keys(input, ['sessionTicket', 'signal'])) return failure('invalid-input');
      ({sessionTicket: ticket, signal} = input);
      if (!ascii(ticket, 4096) || (signal !== undefined && !(signal instanceof AbortSignal))) return failure('invalid-input');
      if (signal?.aborted) return failure('aborted');
    } catch {return failure('invalid-input');}
    const p = this.#policy, controller = new AbortController();
    let stopped: StopCode | undefined, response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancellation: Promise<unknown> | undefined;
    // 취소 promise의 늦은 reject도 관찰합니다. 취소가 멈추면 슬롯도 남깁니다.
    const cancel = (): Promise<unknown> => {
      if (cancellation) return cancellation;
      try {
        const target = reader ?? response?.body;
        if (target) cancellation = Promise.resolve(target.cancel()).catch(() => {});
      } catch {cancellation = Promise.resolve();}
      return cancellation ?? Promise.resolve();
    };
    let settle!: (r: PlayFabSessionResult) => void;
    const stoppedResult = new Promise<PlayFabSessionResult>(resolve => {settle = resolve;});
    const op: Operation = {stop: code => {
      if (stopped) return;
      stopped = code; settle(failure(code));
      try {controller.abort();} catch { /* 주입 경계의 오류 원문은 외부로 보내지 않습니다. */ }
      void cancel();
    }};
    this.#operations.add(op);
    const onAbort = () => op.stop('aborted');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => {
      if (!stopped && this.#closed) op.stop('closed');
      if (!stopped && performance.now() - started >= p.timeoutMs) op.stop('timeout');
      return !stopped;
    };
    const work = async (): Promise<PlayFabSessionResult> => {
      try {
        if (!active()) return failure(stopped!);
        let secret: unknown;
        try {secret = await p.getSecretKey(controller.signal);} catch {return failure(stopped ?? 'secret-unavailable');}
        if (!active()) return failure(stopped!);
        if (!ascii(secret, 8192)) return failure('secret-unavailable');
        const url = new URL(`https://${p.titleId}.playfabapi.com/Server/AuthenticateSessionTicket`).href;
        response = await this.#transport(url, {method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: {'X-SecretKey': secret, 'Content-Type': 'application/json', Accept: 'application/json'},
          body: JSON.stringify({SessionTicket: ticket}), signal: controller.signal});
        // 늦게 얻은 응답도 취소합니다. 중단 후 body read/HMAC은 시작하지 않습니다.
        if (!active()) return failure(stopped!);
        if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) return failure('redirect-blocked');
        if (response.url && response.url !== url) return failure('invalid-response');
        if (response.status === 401) return failure('unauthenticated');
        if (response.status === 403) return failure('forbidden');
        if (response.status === 429) return failure('rate-limited');
        if (response.status >= 500 && response.status <= 599) return failure('upstream-unavailable');
        if (response.status !== 200) return failure('unexpected-http');
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return failure('invalid-response');
        const length = response.headers.get('content-length');
        if (length !== null) {
          if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) return failure('invalid-response');
          if (Number(length) > p.maxResponseBytes) return failure('response-too-large');
        }
        const body = response.body;
        if (!body) return failure('invalid-response');
        reader = body.getReader();
        const decoder = new TextDecoder('utf-8', {fatal: true});
        let bytes = 0, text = '', reads = 0;
        while (true) {
          if (!active()) return failure(stopped!);
          if (++reads > p.maxReads) return failure('limit-exceeded');
          const chunk = await reader.read();
          if (!active()) return failure(stopped!);
          if (!object(chunk)) return failure('invalid-response');
          if (chunk.done === true && chunk.value === undefined) break;
          if (chunk.done !== false || !(chunk.value instanceof Uint8Array)) return failure('invalid-response');
          bytes += chunk.value.byteLength;
          if (bytes > p.maxResponseBytes) return failure('response-too-large');
          try {text += decoder.decode(chunk.value, {stream: true});} catch {return failure('invalid-json');}
        }
        // Fetch는 압축을 풀 수 있어 Content-Length(전송 길이)와 읽은 길이를 동일시하지 않습니다.
        // 선언 길이와 실제 읽은 길이 모두 위에서 독립적으로 제한합니다.
        let parsed: unknown;
        try {text += decoder.decode(); parsed = strictSessionJson(text);} catch {return failure('invalid-json');}
        if (!object(parsed) || !keys(parsed, ['code', 'status', 'data']) || parsed.code !== 200 || parsed.status !== 'OK'
          || !object(parsed.data) || !keys(parsed.data, ['IsSessionTicketExpired', 'UserInfo'])
          || typeof parsed.data.IsSessionTicketExpired !== 'boolean' || !object(parsed.data.UserInfo)) return failure('invalid-response');
        const id = parsed.data.UserInfo.PlayFabId;
        // UserInfo의 정상 부가 PII는 해석·반환·저장하지 않고 요청 로컬 변수와 함께 버립니다.
        if (typeof id !== 'string' || !/^[A-Fa-f0-9]{16}$/.test(id)) return failure('invalid-response');
        if (parsed.data.IsSessionTicketExpired) return failure('session-expired');
        if (!active()) return failure(stopped!);
        const bind = (domain: string) => createHmac('sha256', this.#key)
          .update(JSON.stringify(['pawblossom-session-v1', p.bindingDomain, p.titleId, p.environment, domain, id.toUpperCase()])).digest('hex');
        return Object.freeze({kind: 'authenticated', context: Object.freeze({ownerId: bind('owner'), expectedObfuscatedAccountId: bind('google-account')})});
      } catch {return failure(stopped ?? 'transport-error');}
      finally {await cancel(); this.#operations.delete(op);}
    };
    try {
      signal?.addEventListener('abort', onAbort, {once: true});
      if (signal?.aborted) op.stop('aborted');
      timer = setTimeout(() => op.stop('timeout'), Math.max(0, p.timeoutMs - (performance.now() - started)));
      return await Promise.race([work(), stoppedResult]);
    } catch {op.stop('aborted'); this.#operations.delete(op); return failure('invalid-input');}
    finally {
      clearTimeout(timer);
      try {signal?.removeEventListener('abort', onAbort);} catch { /* 오류 원문 비공개 */ }
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#key.fill(0);
    for (const op of this.#operations) op.stop('closed');
  }
}
