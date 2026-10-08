/** Rejects with `what did not complete within …` if `work` takes longer than `ms`. */
export function withTimeout<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not complete within ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
