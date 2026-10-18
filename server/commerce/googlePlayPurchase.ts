/** 서버 전용입니다. 앱/웹 엔트리에서 import하지 마세요. 환경변수/자격정보를 읽지 않습니다. */
import {completedOperation, trackedCallable} from './operationLifetime.ts';
export interface PlayPurchaseServerConfig {
  /** 운영자가 검증한 단일 패키지·영구 비소모 상품·구매 옵션 allowlist입니다. */
  readonly packageName: string;
  readonly productId: string;
  readonly purchaseOptionId: string;
  readonly mode: 'production' | 'test';
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface PurchaseLookup {
  readonly purchaseToken: string;
  /** 서버 호출자가 androidpublisher scope로 취득한 OAuth access token. 클라이언트 입력 금지. */
  readonly accessToken: string;
  /**
   * 신뢰된 서버 인증 context가 결정한 값입니다. client body의 userId를 복사하면 안 됩니다.
   * 타입/문자열 검사는 인증을 대신하지 않습니다. 현재 앱에는 이 binding이 없습니다.
   */
  readonly expectedObfuscatedAccountId: string;
  readonly signal?: AbortSignal;
}

export type LookupErrorCode =
  | 'invalid-input' | 'aborted' | 'timeout' | 'transport-error'
  | 'redirect-blocked' | 'unauthenticated' | 'forbidden' | 'not-found'
  | 'rate-limited' | 'upstream-unavailable' | 'unexpected-http'
  | 'invalid-response' | 'response-too-large' | 'invalid-json';
export type PurchaseRejection =
  | 'invalid-purchase' | 'unsupported-product' | 'unsupported-offer'
  | 'account-binding-failed' | 'test-purchase-blocked' | 'invalid-test-context'
  | 'pending' | 'cancelled';

/**
 * 구매 사실만 반환합니다. 토큰 중복/소유자 원장·권한 심사·저장·ack는 후속 서비스 책임입니다.
 * rejected/lookup-error는 신규 지급 후보가 없다는 자료이며 기존 권한 철회/환불 명령이 아닙니다.
 * 특히 pending/cancelled는 상품/계정 판정 전 분류하므로 소유자 권한 변경 근거로 쓰면 안 됩니다.
 */
export type PurchaseLookupResult =
  | { readonly kind: 'lookup-error'; readonly code: LookupErrorCode }
  | { readonly kind: 'rejected'; readonly reason: PurchaseRejection }
  | {
      readonly kind: 'purchase-fact';
      readonly fact: {
        readonly packageName: string;
        readonly productId: string;
        readonly purchaseOptionId: string;
        readonly quantity: 1;
        readonly purchaseState: 'PURCHASED';
        readonly acknowledgement: 'pending' | 'acknowledged';
        readonly environment: 'production' | 'test';
      };
      readonly nextStep: 'durable-record-and-entitlement-review-then-ack'
        | 'durable-record-and-restoration-review';
    };

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value: JsonObject, key: string) => Object.hasOwn(value, key);
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
const reject = (reason: PurchaseRejection): PurchaseLookupResult => ({kind: 'rejected', reason});
const failure = (code: LookupErrorCode): PurchaseLookupResult => ({kind: 'lookup-error', code});

function evaluate(value: unknown, config: PlayPurchaseServerConfig, accountId: string): PurchaseLookupResult {
  if (!object(value) || !object(value.purchaseStateContext)) return reject('invalid-purchase');
  const state = value.purchaseStateContext.purchaseState;
  if (state !== 'PURCHASED' && state !== 'PENDING' && state !== 'CANCELLED') return reject('invalid-purchase');
  // 미완료/취소는 다른 필드가 누락되어도 구매 후보로 만들지 않습니다.
  if (state === 'PENDING') return reject('pending');
  if (state === 'CANCELLED') return reject('cancelled');
  const ack = value.acknowledgementState;
  if (ack !== 'ACKNOWLEDGEMENT_STATE_PENDING' && ack !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') {
    return reject('invalid-purchase');
  }
  if (!bounded(value.obfuscatedExternalAccountId, 64) || value.obfuscatedExternalAccountId !== accountId) {
    return reject('account-binding-failed');
  }
  let environment: 'production' | 'test' = 'production';
  if (has(value, 'testPurchaseContext')) {
    if (config.mode !== 'test') return reject('test-purchase-blocked');
    const test = value.testPurchaseContext;
    if (!object(test) || test.fopType !== 'TEST' || Object.keys(test).some(key => key !== 'fopType')) {
      return reject('invalid-test-context');
    }
    environment = 'test';
  }
  if (!Array.isArray(value.productLineItem) || value.productLineItem.length !== 1) {
    return reject('unsupported-product');
  }
  const line: unknown = value.productLineItem[0];
  if (!object(line) || line.productId !== config.productId) return reject('unsupported-product');
  const offer = line.productOfferDetails;
  if (!object(offer) || offer.purchaseOptionId !== config.purchaseOptionId
    || has(offer, 'rentOfferDetails') || has(offer, 'preorderOfferDetails')
    // 이 모듈의 엄격한 초안 profile입니다. 모든 Google 응답의 필수 필드라고 가정하지 않습니다.
    || offer.quantity !== 1 || offer.refundableQuantity !== 1
    || offer.consumptionState !== 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED') {
    return reject('unsupported-offer');
  }
  // orderId는 선택 정보이며 필수값/중복키로 사용하지 않습니다. 원문·계정·토큰도 반환하지 않습니다.
  const acknowledged = ack === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
  return {
    kind: 'purchase-fact',
    fact: {
      packageName: config.packageName, productId: config.productId, purchaseOptionId: config.purchaseOptionId,
      quantity: 1, purchaseState: 'PURCHASED', acknowledgement: acknowledged ? 'acknowledged' : 'pending', environment,
    },
    nextStep: acknowledged ? 'durable-record-and-restoration-review' : 'durable-record-and-entitlement-review-then-ack',
  };
}

function httpError(status: number): LookupErrorCode | undefined {
  if (status >= 300 && status < 400) return 'redirect-blocked';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500 && status <= 599) return 'upstream-unavailable';
  if (status !== 200) return 'unexpected-http';
}

/**
 * 구성만으로 통신하지 않습니다. 반환 함수의 명시 호출만 GET합니다.
 * 주입 transport는 신뢰된 서버 코드여야 합니다. 기본값은 Node22+ native fetch입니다.
 * 오류에는 upstream URL/본문/token/authorization/cause를 넣지 않으며 자체 로그도 없습니다.
 */
export function createPlayPurchaseLookup(config: PlayPurchaseServerConfig, transport: typeof fetch = globalThis.fetch) {
  if (!object(config) || !bounded(config.packageName, 255)
    || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(config.packageName)
    || !bounded(config.productId, 150) || !/^[a-z0-9][a-z0-9._]*$/.test(config.productId)
    || !bounded(config.purchaseOptionId, 63) || !/^[a-z0-9][a-z0-9-]*$/.test(config.purchaseOptionId)
    || (config.mode !== 'production' && config.mode !== 'test') || typeof transport !== 'function') {
    throw new Error('invalid-server-config');
  }
  const timeoutMs = config.timeoutMs ?? 8_000;
  const maxBytes = config.maxResponseBytes ?? 64 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000
    || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) {
    throw new Error('invalid-server-config');
  }
  // 호출 중 외부 config 변경으로 허용 목록이 바뀌지 않도록 복사합니다.
  const policy = {...config};
  return trackedCallable((input: PurchaseLookup) => {
    if (!object(input) || !bounded(input.purchaseToken, 4096) || input.purchaseToken === '.' || input.purchaseToken === '..'
      || !bounded(input.accessToken, 8192) || !/^[A-Za-z0-9._~+\/-]+=*$/.test(input.accessToken)
      || !bounded(input.expectedObfuscatedAccountId, 64)
      || (input.signal !== undefined && !(input.signal instanceof AbortSignal))) return completedOperation(failure('invalid-input'));
    const purchaseToken = input.purchaseToken;
    const accessToken = input.accessToken;
    const accountId = input.expectedObfuscatedAccountId;
    const signal = input.signal;
    if (signal?.aborted) return completedOperation(failure('aborted'));
    const controller = new AbortController();
    let stopped: 'aborted' | 'timeout' | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    let cancellation: Promise<void> | undefined;
    // cancel을 기다리지 않습니다. 중단을 무시하는 transport/stream도 반환 기한을 지킵니다.
    const cancelBody = (): Promise<void> => {
      if (cancellation) return cancellation;
      try {
        const target = reader ?? response?.body;
        if (target) cancellation = Promise.resolve().then(() => target.cancel()).then(() => {}, () => {});
      } catch { cancellation = Promise.resolve(); /* 손상되거나 잠긴 본문 오류 원문은 비공개입니다. */ }
      return cancellation ?? Promise.resolve();
    };
    let stop!: (code: 'aborted' | 'timeout') => void;
    const stopResult = new Promise<PurchaseLookupResult>(resolve => {
      stop = code => {
        if (stopped) return;
        stopped = code;
        resolve(failure(code));
        controller.abort();
        void cancelBody();
      };
    });
    const onAbort = () => stop('aborted');
    signal?.addEventListener('abort', onAbort, {once: true});
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${policy.packageName}/purchases/productsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const request = async (): Promise<PurchaseLookupResult> => {
      try {
        response = await transport(url, {
          method: 'GET', headers: {Authorization: `Bearer ${accessToken}`, Accept: 'application/json'},
          // native fetch는 3xx에서 예외를 던집니다. 원인 미노출을 위해 transport-error로 닫습니다.
          redirect: 'error', signal: controller.signal,
        });
        if (stopped) { void cancelBody(); return failure(stopped); }
        if (response.redirected || response.type === 'opaqueredirect') return failure('redirect-blocked');
        if (response.url && response.url !== url) return failure('invalid-response');
        const error = httpError(response.status);
        if (error) return failure(error);
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
          return failure('invalid-response');
        }
        const length = response.headers.get('content-length');
        if (length !== null) {
          if (!/^\d+$/.test(length)) return failure('invalid-response');
          if (Number(length) > maxBytes) return failure('response-too-large');
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', {fatal: true});
        let bytes = 0, body = '';
        while (true) {
          const chunk = await reader.read();
          if (stopped) return failure(stopped);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) return failure('response-too-large');
          body += decoder.decode(chunk.value, {stream: true});
        }
        body += decoder.decode();
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { return failure('invalid-json'); }
        return evaluate(parsed, policy, accountId);
      } catch {
        return failure(stopped ?? 'transport-error');
      } finally {
        void cancelBody();
      }
    };
    const work = request();
    // 반환 기한과 독립적으로 fetch/read 및 한 번 시작한 cancel의 실제 종료를 전달합니다.
    const settled = work.then(cancelBody, cancelBody).then(() => {
      try {reader?.releaseLock();} catch { /* 합성/손상 reader 오류 원문 비공개 */ }
    });
    const result = (async () => {
      try {return await Promise.race([work, stopResult]);}
      finally {clearTimeout(timer); signal?.removeEventListener('abort', onAbort);}
    })();
    return {result, settled};
  });
}
