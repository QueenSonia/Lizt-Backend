import * as puppeteer from 'puppeteer';
import type { Browser, LaunchOptions } from 'puppeteer';

const DEFAULT_EXECUTABLE_PATH = '/usr/bin/google-chrome-stable';

const DEFAULT_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
  '--single-process',
];

export async function launchBrowser(
  overrides: LaunchOptions = {},
): Promise<Browser> {
  const { args: overrideArgs, ...rest } = overrides;

  const mergedArgs = Array.from(
    new Set<string>([...DEFAULT_ARGS, ...(overrideArgs ?? [])]),
  );

  const options: LaunchOptions = {
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || DEFAULT_EXECUTABLE_PATH,
    headless: true,
    ...rest,
    args: mergedArgs,
  };

  return puppeteer.launch(options);
}
