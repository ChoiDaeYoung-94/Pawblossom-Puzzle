/** 서버 전용. 실제 자격정보를 읽지 않으며 명시 호출만 GET합니다. 앱 import 금지. */
import {createHash} from 'node:crypto';
import {completedOperation, trackedCallable} from './operationLifetime.ts';

export interface PlayVoidedPurchasesConfig {
  readonly packageName: string;
  /** 각 페이지마다 신선한 서버 OAuth를 주입합니다. 클라이언트 입력 금지. */
  readonly getAccessToken: () => Promise<string>;
  readonly timeoutMs?: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly maxResponseBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxReads?: number;
}
export interface VoidedPurchasesWindow {
  /** 신뢰된 서버 작업의 관측 시각 창입니다. HTTP body/RTDN 원문을 복사하지 마세요. */
  readonly startTime: number;
  readonly endTime: number;
  readonly signal?: AbortSignal;
}
export type VoidedErrorCode = 'invalid-input' | 'aborted' | 'timeout' | 'transport-error'
  | 'redirect-blocked' | 'unauthenticated' | 'forbidden' | 'rate-limited' | 'upstream-unavailable'
  | 'unexpected-http' | 'invalid-response' | 'invalid-json' | 'response-too-large' | 'limit-exceeded';
/** 내부 원장 교환용 해시만 반환합니다. 상품/환경/소유자 사실은 이 API에 없습니다. */
export type VoidedPurchasesResult = {readonly kind: 'voided-facts'; readonly tokenIds: readonly string[]; readonly pages: number; readonly items: number}
  | {readonly kind: 'voided-error'; readonly code: VoidedErrorCode};
const failure = (code: VoidedErrorCode): VoidedPurchasesResult => ({kind: 'voided-error', code});
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const bounded = (v: unknown, n: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= n && /^[\x21-\x7e]+$/.test(v);
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const DAY = 86_400_000;

// JSON.parse의 중복 키 마지막 값 채택을 허용하지 않습니다. 깊이도 제한합니다.
function strictJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  let i = 0;
  const space = () => {while (/\s/.test(text[i] ?? '') && i < text.length) i++;};
  const string = (): string => {
    const start = i++;
    while (i < text.length) {const c = text[i++]; if (c === '\\') i++; else if (c === '"') return JSON.parse(text.slice(start, i)) as string;}
    throw new Error();
  };
  const value = (depth: number): void => {
    if (depth > 32) throw new Error();
    space();
    if (text[i] === '{') {
      i++; space(); const keys = new Set<string>();
      if (text[i] === '}') {i++; return;}
      while (true) {
        space(); const key = string(); if (keys.has(key)) throw new Error(); keys.add(key);
        space(); i++; value(depth + 1); space(); if (text[i++] === '}') return;
      }
    }
    if (text[i] === '[') {
      i++; space(); if (text[i] === ']') {i++; return;}
      while (true) {value(depth + 1); space(); if (text[i++] === ']') return;}
    }
    if (text[i] === '"') {string(); return;}
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
  };
  value(0); return parsed;
}

/**
 * type=0 / includeQuantityBasedPartialRefund=false / 단일 수량 전액 회수 전용 profile.
 * Discovery의 flat maxResults/token을 사용하며 전체 페이지 성공 전에는 사실을 반환하지 않습니다.
 * 30일 창은 API 관측 시각이며 voidedTimeMillis의 창 범위 일치는 요구하지 않습니다.
 */
export function createPlayVoidedPurchasesLookup(config: PlayVoidedPurchasesConfig, transport: typeof fetch = globalThis.fetch) {
  let p: Required<PlayVoidedPurchasesConfig>;
  try {
    p = {packageName: config.packageName, getAccessToken: config.getAccessToken,
      timeoutMs: config.timeoutMs ?? 30_000, pageSize: config.pageSize ?? 1000,
      maxPages: config.maxPages ?? 20, maxItems: config.maxItems ?? 10_000,
      maxResponseBytes: config.maxResponseBytes ?? 1024 * 1024, maxTotalBytes: config.maxTotalBytes ?? 8 * 1024 * 1024,
      maxReads: config.maxReads ?? 4096};
    if (!bounded(p.packageName, 255) || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(p.packageName)
      || typeof p.getAccessToken !== 'function' || typeof transport !== 'function'
      || !integer(p.timeoutMs, 1, 60_000) || !integer(p.pageSize, 1, 1000)
      || !integer(p.maxPages, 1, 100) || !integer(p.maxItems, 1, 100_000)
      || !integer(p.maxResponseBytes, 1, 1024 * 1024) || !integer(p.maxTotalBytes, 1, 16 * 1024 * 1024)
      || !integer(p.maxReads, 1, 16_384)) throw new Error();
  } catch {throw new Error('invalid-voided-config');}
  return trackedCallable((input: VoidedPurchasesWindow) => {
    let startTime: number, endTime: number, signal: AbortSignal | undefined;
    const now = Date.now();
    try {
      ({startTime, endTime, signal} = input);
      if (!integer(startTime, Math.max(0, now - 30 * DAY), now) || !integer(endTime, startTime + 1, now)
        || (signal !== undefined && !(signal instanceof AbortSignal))) return completedOperation(failure('invalid-input'));
    } catch {return completedOperation(failure('invalid-input'));}
    if (signal?.aborted) return completedOperation(failure('aborted'));
    const controller = new AbortController();
    let stopped: 'aborted' | 'timeout' | undefined;
    // 현재 페이지가 바뀌어도 앞 페이지의 취소/lock 정리를 잃지 않습니다. 수는 maxPages로 제한됩니다.
    const cleanups: Promise<void>[] = [];
    const pageContext = () => {
      let cancellation: Promise<void> | undefined, finished = false;
      const page: {response?: Response; reader?: ReadableStreamDefaultReader<Uint8Array>; cancel(): Promise<void>; finish(): void} = {
        cancel() {
          if (cancellation) return cancellation;
          try {
            const target = page.reader ?? page.response?.body;
            if (target) cancellation = Promise.resolve().then(() => target.cancel()).then(() => {}, () => {});
          } catch {cancellation = Promise.resolve(); /* 비공개 */}
          return cancellation ?? Promise.resolve();
        },
        // 페이지의 실제 fetch/read가 끝난 finally에서만 호출합니다. cancel만 끝나면 lock을 풀지 않습니다.
        finish() {
          if (finished) return;
          finished = true;
          cleanups.push(page.cancel().then(() => {
            try {page.reader?.releaseLock();} catch { /* 합성/손상 reader 오류 원문 비공개 */ }
          }));
        },
      };
      return page;
    };
    let current: ReturnType<typeof pageContext> | undefined;
    let stop!: (code: 'aborted' | 'timeout') => void;
    const expired = new Promise<VoidedPurchasesResult>(resolve => {stop = code => {
      if (stopped) return; stopped = code; resolve(failure(code)); controller.abort(); void current?.cancel();
    };});
    const onAbort = () => stop('aborted'); signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) stop('aborted');
    const timer = setTimeout(() => stop('timeout'), p.timeoutMs);
    const work = async (): Promise<VoidedPurchasesResult> => {
      let pages = 0, items = 0, totalBytes = 0, reads = 0, expectedTotal: number | undefined;
      let token: string | undefined;
      const seenPages = new Set<string>(), tokenIds = new Set<string>();
      try {
        while (true) {
          if (stopped) return failure(stopped);
          if (pages >= p.maxPages) return failure('limit-exceeded');
          const accessToken = await p.getAccessToken();
          if (stopped) return failure(stopped);
          if (!bounded(accessToken, 8192) || !/^[A-Za-z0-9._~+\/-]+=*$/.test(accessToken)) return failure('invalid-input');
          const url = new URL(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${p.packageName}/purchases/voidedpurchases`);
          url.searchParams.set('type', '0'); url.searchParams.set('includeQuantityBasedPartialRefund', 'false');
          url.searchParams.set('startTime', String(startTime)); url.searchParams.set('endTime', String(endTime));
          url.searchParams.set('maxResults', String(p.pageSize)); if (token) url.searchParams.set('token', token);
          const page = pageContext(); current = page;
          try {
            const response = page.response = await transport(url.href, {method: 'GET', headers: {Authorization: `Bearer ${accessToken}`, Accept: 'application/json'}, redirect: 'error', signal: controller.signal});
            if (stopped) return failure(stopped);
            if (response.redirected || response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) return failure('redirect-blocked');
            if (response.url && response.url !== url.href) return failure('invalid-response');
            if (response.status === 401) return failure('unauthenticated');
            if (response.status === 403) return failure('forbidden');
            if (response.status === 429) return failure('rate-limited');
            if (response.status >= 500 && response.status <= 599) return failure('upstream-unavailable');
            if (response.status !== 200) return failure('unexpected-http');
            if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) return failure('invalid-response');
            const length = response.headers.get('content-length');
            if (length !== null) {
              if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) return failure('invalid-response');
              if (Number(length) > p.maxResponseBytes || totalBytes + Number(length) > p.maxTotalBytes) return failure('response-too-large');
            }
            const reader = page.reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', {fatal: true});
            let bytes = 0, body = '';
            while (true) {
              if (++reads > p.maxReads) return failure('limit-exceeded');
              const chunk = await reader.read(); if (stopped) return failure(stopped);
              if (!chunk || typeof chunk !== 'object') return failure('invalid-response');
              if (chunk.done === true && chunk.value === undefined) break;
              if (chunk.done !== false || !(chunk.value instanceof Uint8Array)) return failure('invalid-response');
              bytes += chunk.value.byteLength; totalBytes += chunk.value.byteLength;
              if (bytes > p.maxResponseBytes || totalBytes > p.maxTotalBytes) return failure('response-too-large');
              try {body += decoder.decode(chunk.value, {stream: true});} catch {return failure('invalid-json');}
            }
            let parsed: unknown;
            try {body += decoder.decode(); parsed = strictJson(body);} catch {return failure('invalid-json');}
            void page.cancel();
            if (!object(parsed) || Object.keys(parsed).some(k => !['voidedPurchases', 'tokenPagination', 'pageInfo'].includes(k))) return failure('invalid-response');
            const list = Object.hasOwn(parsed, 'voidedPurchases') ? parsed.voidedPurchases : [];
            if (!Array.isArray(list) || list.length > p.pageSize) return failure('invalid-response');
            if (items + list.length > p.maxItems) return failure('limit-exceeded');
            for (const item of list) {
              if (!object(item) || Object.keys(item).some(k => !['kind', 'purchaseToken', 'purchaseTimeMillis', 'voidedTimeMillis', 'orderId', 'voidedSource', 'voidedReason'].includes(k))
                || (Object.hasOwn(item, 'kind') && item.kind !== 'androidpublisher#voidedPurchase')
                || !bounded(item.purchaseToken, 4096) || item.purchaseToken === '.' || item.purchaseToken === '..'
                || !integer(item.voidedSource, 0, 2) || !integer(item.voidedReason, 0, 8)
                || (Object.hasOwn(item, 'orderId') && !bounded(item.orderId, 256))) return failure('invalid-response');
              const purchase = item.purchaseTimeMillis, voided = item.voidedTimeMillis;
              if (typeof purchase !== 'string' || !/^[1-9]\d*$/.test(purchase) || !integer(Number(purchase), 1, now)
                || typeof voided !== 'string' || !/^[1-9]\d*$/.test(voided) || !integer(Number(voided), Number(purchase), now)) return failure('invalid-response');
              tokenIds.add(createHash('sha256').update(item.purchaseToken).digest('hex'));
            }
            if (Object.hasOwn(parsed, 'pageInfo')) {
              if (!object(parsed.pageInfo) || Object.entries(parsed.pageInfo).some(([k,v]) => !['totalResults', 'startIndex', 'resultPerPage'].includes(k) || !integer(v, 0, 0x7fffffff))) return failure('invalid-response');
              const info = parsed.pageInfo;
              if (Object.hasOwn(info, 'startIndex') && info.startIndex !== items) return failure('invalid-response');
              if (Object.hasOwn(info, 'resultPerPage') && (info.resultPerPage as number) < list.length) return failure('invalid-response');
              if (Object.hasOwn(info, 'totalResults')) {
                if (expectedTotal !== undefined && expectedTotal !== info.totalResults) return failure('invalid-response');
                expectedTotal = info.totalResults as number;
                if (expectedTotal < items + list.length) return failure('invalid-response');
              }
            }
            token = undefined;
            if (Object.hasOwn(parsed, 'tokenPagination')) {
              const pagination = parsed.tokenPagination;
              // 공식 sample의 previousPageToken:null은 이전 페이지 부재입니다. next는 부재만 종료입니다.
              if (!object(pagination) || Object.entries(pagination).some(([k,v]) => !['nextPageToken', 'previousPageToken'].includes(k)
                || !(k === 'previousPageToken' && v === null) && !bounded(v, 4096))) return failure('invalid-response');
              token = pagination.nextPageToken as string | undefined;
            }
            pages++; items += list.length;
            if (!token) {
              if (expectedTotal !== undefined && expectedTotal !== items) return failure('invalid-response');
              return {kind: 'voided-facts', tokenIds: [...tokenIds], pages, items};
            }
            if (items >= p.maxItems) return failure('limit-exceeded');
            if (seenPages.has(token)) return failure('invalid-response');
            seenPages.add(token);
          } finally {page.finish(); if (current === page) current = undefined;}
        }
      } catch {return failure(stopped ?? 'transport-error');}
      finally {current?.finish();}
    };
    const actual = work();
    // work 종료 때는 각 페이지 finally가 이미 정리를 등록했습니다. 공개 facts는 정리를 기다리지 않습니다.
    const settled = actual.then(() => Promise.all(cleanups), () => Promise.all(cleanups)).then(() => {});
    const result = (async () => {
      try {return await Promise.race([actual, expired]);}
      finally {clearTimeout(timer); signal?.removeEventListener('abort', onAbort);}
    })();
    return {result, settled};
  });
}
