/** 서버 전용. 앱 import 금지. 구성만으로 통신/DB/자격정보/키 읽기나 생성을 하지 않습니다. */
import type {PurchaseLedgerOptions} from './purchaseLedger.ts';
import {completedOperation, startOperation, trackedCallable} from './operationLifetime.ts';

export interface PlayAcknowledgeConfig {
  /** 검증된 영구 비소모 상품 한 개의 서버 allowlist. HTTP 입력에서 구성하지 마세요. */
  readonly packageName: string;
  readonly productId: string;
  readonly timeoutMs?: number;
  /** 성공 본문 허용량이 아닙니다. 비어 있지 않은 본문의 크기 초과 오류 분류 상한입니다. */
  readonly maxResponseBytes?: number;
}
export interface PlayAcknowledgeInput {
  readonly packageName: string;
  readonly productId: string;
  readonly purchaseToken: string;
  /** 신뢰된 서버에서 androidpublisher scope로 취득·주입합니다. */
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}
export type AcknowledgeErrorCode =
  | 'invalid-input' | 'aborted' | 'timeout' | 'transport-error'
  | 'redirect-blocked' | 'unauthenticated' | 'forbidden' | 'not-found'
  | 'rate-limited' | 'upstream-unavailable' | 'unexpected-http'
  | 'invalid-response' | 'response-too-large';
export type PlayAcknowledgeResult = {readonly kind: 'acknowledged'}
  | {readonly kind: 'acknowledge-error'; readonly code: AcknowledgeErrorCode};
const failure = (code: AcknowledgeErrorCode): PlayAcknowledgeResult => ({kind: 'acknowledge-error', code});
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
// 즉시 완료하는 무한 0byte reader가 microtask 루프로 timer를 굶기지 못하게 합니다.
const MAX_EMPTY_CHUNKS = 8;

function httpError(status: number): AcknowledgeErrorCode | undefined {
  if (status >= 300 && status < 400) return 'redirect-blocked';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500 && status <= 599) return 'upstream-unavailable';
  // 400/409의 오류 문구로 이미 승인되었다고 추정하지 않습니다.
  if (status !== 200 && status !== 204) return 'unexpected-http';
}

/**
 * 명시 호출에만 POST합니다. native Node22+ fetch 또는 신뢰된 서버 transport를 주입합니다.
 * 공식 문서의 빈 성공 본문을 엄격 적용합니다: 200/204 + 0바이트만 성공입니다.
 * 실제 Google 응답 profile은 미검증이며 {}·공백·다른 2xx는 재조회가 필요한 오류입니다.
 * URL/token/OAuth/오류 원문/cause를 결과나 로그에 노출하지 않습니다.
 */
export function createPlayPurchaseAcknowledger(config: PlayAcknowledgeConfig, transport: typeof fetch = globalThis.fetch) {
  let policy: PlayAcknowledgeConfig;
  try {
    // 검증하는 값과 await 이후 사용하는 값을 동일한 primitive snapshot으로 고정합니다.
    policy = {packageName: config.packageName, productId: config.productId,
      timeoutMs: config.timeoutMs ?? 8_000, maxResponseBytes: config.maxResponseBytes ?? 1024};
    if (!bounded(policy.packageName, 255)
      || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(policy.packageName)
      || !bounded(policy.productId, 150) || !/^[a-z0-9][a-z0-9._]*$/.test(policy.productId)
      || !Number.isInteger(policy.timeoutMs) || policy.timeoutMs! < 1 || policy.timeoutMs! > 30_000
      || !Number.isInteger(policy.maxResponseBytes) || policy.maxResponseBytes! < 1 || policy.maxResponseBytes! > 1024 * 1024
      || typeof transport !== 'function') throw new Error();
  } catch { throw new Error('invalid-acknowledge-config'); }
  const timeoutMs = policy.timeoutMs!, maxBytes = policy.maxResponseBytes!;
  return trackedCallable((input: PlayAcknowledgeInput) => {
    let packageName: string, productId: string, purchaseToken: string, accessToken: string, signal: AbortSignal | undefined;
    try {
      ({packageName, productId, purchaseToken, accessToken, signal} = input);
      if (packageName !== policy.packageName || productId !== policy.productId
        || !bounded(purchaseToken, 4096) || purchaseToken === '.' || purchaseToken === '..'
        || !bounded(accessToken, 8192) || !/^[A-Za-z0-9._~+\/-]+=*$/.test(accessToken)
        || (signal !== undefined && !(signal instanceof AbortSignal))) return completedOperation(failure('invalid-input'));
    } catch { return completedOperation(failure('invalid-input')); }
    if (signal?.aborted) return completedOperation(failure('aborted'));
    const controller = new AbortController();
    let stopped: 'aborted' | 'timeout' | undefined;
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancellation: Promise<void> | undefined;
    // cancel이 reject/throw/hang하더라도 반환을 기다리지 않습니다.
    const cancelBody = (): Promise<void> => {
      if (cancellation) return cancellation;
      try {
        const target = reader ?? response?.body;
        if (target) cancellation = Promise.resolve().then(() => target.cancel()).then(() => {}, () => {});
      } catch {cancellation = Promise.resolve(); /* 오류 원문 비공개 */}
      return cancellation ?? Promise.resolve();
    };
    let stop!: (code: 'aborted' | 'timeout') => void;
    const stopResult = new Promise<PlayAcknowledgeResult>(resolve => {
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
    if (signal?.aborted) stop('aborted');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${policy.packageName}/purchases/products/${policy.productId}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
    const request = async (): Promise<PlayAcknowledgeResult> => {
      try {
        if (stopped) return failure(stopped);
        response = await transport(url, {method: 'POST',
          headers: {Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json'},
          body: '{}', redirect: 'error', signal: controller.signal});
        if (stopped) { void cancelBody(); return failure(stopped); }
        if (response.redirected || response.type === 'opaqueredirect') return failure('redirect-blocked');
        // native fetch는 URL을 채우며, 빈 URL은 주입 합성 Response에서만 허용됩니다.
        if (response.url && response.url !== url) return failure('invalid-response');
        const error = httpError(response.status);
        // 실패 본문은 파싱·축적하지 않고 즉시 취소합니다. 크기/문구로 성공을 추정하지 않습니다.
        if (error) return failure(error);
        const length = response.headers.get('content-length');
        if (length !== null) {
          if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) return failure('invalid-response');
          if (Number(length) > maxBytes) return failure('response-too-large');
          if (Number(length) !== 0) return failure('invalid-response');
        }
        if (response.body) {
          reader = response.body.getReader();
          let emptyChunks = 0;
          while (true) {
            const chunk = await reader.read();
            if (stopped) return failure(stopped);
            if (!chunk || typeof chunk !== 'object') return failure('invalid-response');
            if (chunk.done === true && chunk.value === undefined) break;
            if (chunk.done !== false) return failure('invalid-response');
            if (!(chunk.value instanceof Uint8Array)) return failure('invalid-response');
            if (chunk.value.byteLength > maxBytes) return failure('response-too-large');
            if (chunk.value.byteLength !== 0) return failure('invalid-response');
            if (++emptyChunks > MAX_EMPTY_CHUNKS) return failure('invalid-response');
          }
        }
        return {kind: 'acknowledged'};
      } catch { return failure(stopped ?? 'transport-error'); }
      finally { void cancelBody(); }
    };
    const work = request();
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

/** 저장/지급을 하지 않습니다. 원장이 commit·최신 GET·lease를 관리한 뒤 호출할 callback입니다. */
export function createLedgerAcknowledger(config: PlayAcknowledgeConfig, transport?: typeof fetch): PurchaseLedgerOptions['acknowledge'] {
  const acknowledge = createPlayPurchaseAcknowledger(config, transport);
  return trackedCallable((input: Parameters<PurchaseLedgerOptions['acknowledge']>[0]) => {
    const operation = startOperation(acknowledge, input);
    const result = operation.result.then(value => value.kind === 'acknowledged' ? 'acknowledged' as const : 'retry' as const);
    return {result, settled: Promise.all([operation.settled, result.then(() => {}, () => {})]).then(() => {})};
  });
}
