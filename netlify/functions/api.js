const serverless = require('serverless-http');
const app = require('../../server');

// Netlify preserves the original request path in event.path (e.g. "/api/health"),
// so no path manipulation needed — Express routes match directly.
exports.handler = serverless(app);
