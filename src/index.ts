import { Hono } from "hono";


// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// You may also register routes for non OpenAPI directly on Hono
app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
