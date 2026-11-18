import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

function appReleaseMetadata(release) {
  return {
    name: 'minima-release-metadata',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'minima-build', content: release.id }, injectTo: 'head' }];
    },
    configureServer(server) {
      server.middlewares.use('/app-version.json', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify(release));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'app-version.json', source: JSON.stringify(release) });
    },
  };
}

function devAnalyzeFood() {
  return {
    name: 'minima-dev-analyze-food',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/analyze-food', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Use POST to analyze a meal.' }));
          return;
        }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            const parsed = body ? JSON.parse(body) : {};
            const { default: handler } = await server.ssrLoadModule('/api/analyze-food.ts');
            const fakeRes = {
              status(code) {
                res.statusCode = code;
                return fakeRes;
              },
              json(data) {
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(data));
              },
            };
            await handler({ method: 'POST', body: parsed, headers: req.headers }, fakeRes);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: err.message || 'Server error' }));
          }
        });
      });
    },
  };
}

// Dev-only preview of the AI estimate review. Opt in with MINIMA_MOCK_AI=1 so the
// nutrition page can be exercised without a Gemini key. Never used by the build.
function mockAnalyzeFood() {
  const items = [
    { name: 'Greek yogurt bowl with berries', portion: '1 cup (200 g)', calories: 280, protein: 22, carbs: 30, fat: 6 },
    { name: 'Britannia brown bread', portion: '1 slice (28 g)', calories: 70, protein: 2.2, carbs: 14.5, fat: 0.5 },
    { name: 'Pintola dark chocolate peanut butter', portion: '16 g', calories: 93, protein: 3.8, carbs: 4.3, fat: 6.1 },
    { name: 'Beastlife yeast protein shake with 250 ml milk', portion: '1 scoop + 250 ml', calories: 265, protein: 32.5, carbs: 14.8, fat: 9.5 },
  ];
  return {
    name: 'minima-mock-analyze-food',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/analyze-food', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Use POST to analyze a meal.' }));
          return;
        }
        req.resume();
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          items,
          note: 'Mock preview — estimates are approximate. Adjust the portion if the bowl looks smaller than the reference.',
        }));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const release = { id: process.env.MINIMA_RELEASE_ID || new Date().toISOString().replace(/[-:.]/g, ''), builtAt: new Date().toISOString() };
  const env = loadEnv(mode, process.cwd(), '');
  if (env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }

  return {
    define: { __MINIMA_BUILD_ID__: JSON.stringify(release.id) },
    build: { target: ['es2020', 'chrome100'] },
    plugins: [
      appReleaseMetadata(release),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: false,
          navigateFallbackDenylist: [/^\/app-version\.json(?:\?|$)/, /^\/repair\.html(?:\?|$)/],
          globIgnores: ['**/app-version.json', '**/repair.html'],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
        },
        includeAssets: ['icons/*.{png,svg}', 'fonts/*.woff2'],
        manifest: {
          id: '/',
          start_url: '/',
          scope: '/',
          name: 'Minima — Your space to grow',
          short_name: 'Minima',
          description: 'A calm, private space for self-improvement, one day at a time.',
          theme_color: '#000000',
          background_color: '#000000',
          display_override: ['standalone'],
          display: 'standalone',
          orientation: 'portrait-primary',
          shortcuts: [
            { name: 'Today', short_name: 'Today', url: '/', icons: [{ src: '/icons/minima-v2-192.png', sizes: '192x192', type: 'image/png' }] },
            { name: 'History', short_name: 'History', url: '/history', icons: [{ src: '/icons/minima-v2-192.png', sizes: '192x192', type: 'image/png' }] },
          ],
          icons: [
            { src: '/icons/minima-v2-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/minima-v2-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/minima-v2-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
      ...(process.env.MINIMA_MOCK_AI === '1' ? [mockAnalyzeFood()] : [devAnalyzeFood()]),
    ],
  };
});
