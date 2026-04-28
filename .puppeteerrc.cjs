/**
 * @type {import('puppeteer').Configuration}
 *
 * We rely on system-installed Google Chrome (see PUPPETEER_EXECUTABLE_PATH /
 * src/common/puppeteer-launch.ts). Skipping the bundled Chromium download
 * keeps droplet disk usage in check.
 */
module.exports = {
  skipDownload: true,
};
