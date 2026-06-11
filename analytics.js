// Vercel Web Analytics initialization
import { inject } from './node_modules/@vercel/analytics/dist/index.mjs';

// Inject the Vercel Analytics script
inject({
  mode: 'auto',
  debug: false
});
