import * as puppeteer from 'puppeteer';
import type { Browser, LaunchOptions } from 'puppeteer';

const DEFAULT_EXECUTABLE_PATH = '/usr/bin/google-chrome-stable';

// `--single-process` and `--no-zygote` are memory-saving flags for Linux
// containers (Docker/k8s). On Windows and macOS they trigger frame-detach
// crashes during page.setContent, so only apply them on Linux.
const SHARED_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

const LINUX_ONLY_ARGS = ['--no-zygote', '--single-process'];

const DEFAULT_ARGS: readonly string[] =
  process.platform === 'linux'
    ? [...SHARED_ARGS, ...LINUX_ONLY_ARGS]
    : SHARED_ARGS;

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
