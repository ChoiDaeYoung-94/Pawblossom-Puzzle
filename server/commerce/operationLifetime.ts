/** 서버 내부 수명 전달용입니다. 인증/권한 증명이나 프로세스 전체 제한이 아닙니다. 앱 import 금지. */
export interface TrackedOperation<T> {
  readonly result: Promise<T>;
  readonly settled: Promise<void>;
}

// 같은 함수만 내부 수명을 전달합니다. 임의 wrapper/외부 callback의 숨긴 작업은 알 수 없습니다.
const starters = new WeakMap<Function, (input: unknown) => TrackedOperation<unknown>>();
export function trackedCallable<I, O>(start: (input: I) => TrackedOperation<O>): (input: I) => Promise<O> {
  const callable = (input: I): Promise<O> => {
    try {return start(input).result;} catch (error) {return Promise.reject(error);}
  };
  starters.set(callable, start as (input: unknown) => TrackedOperation<unknown>);
  return callable;
}
export function completedOperation<T>(value: T): TrackedOperation<T> {
  return {result: Promise.resolve(value), settled: Promise.resolve()};
}
export function startOperation<I, O>(callable: (input: I) => Promise<O>, input: I): TrackedOperation<O> {
  const start = starters.get(callable);
  try {
    if (start) return start(input) as TrackedOperation<O>;
    const result = Promise.resolve(callable(input));
    return {result, settled: result.then(() => {}, () => {})};
  } catch (error) {
    return {result: Promise.reject(error), settled: Promise.resolve()};
  }
}

/** 공개 결과와 별개로 등록된 실제 작업이 모두 끝날 때까지 한 슬롯을 유지합니다. */
export class OperationGroup {
  #remaining = 1;
  #finished = false;
  #release: () => void;
  constructor(release: () => void) {this.#release = release;}
  track(work: Promise<unknown>): void {
    this.#remaining++;
    void work.then(() => this.#done(), () => this.#done());
  }
  #done(): void {if (--this.#remaining === 0) this.#release();}
  finish(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#done();
  }
}
