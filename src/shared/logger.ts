const PREFIX = '[EchoSub]';

export const logger = {
  info(scope: string, ...args: unknown[]): void {
    console.info(`${PREFIX}[${scope}]`, ...args);
  },
  warn(scope: string, ...args: unknown[]): void {
    console.warn(`${PREFIX}[${scope}]`, ...args);
  },
  error(scope: string, ...args: unknown[]): void {
    console.error(`${PREFIX}[${scope}]`, ...args);
  },
};
