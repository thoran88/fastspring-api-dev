import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import webhooksRouter from "./routes/webhooks.js";
import sessionRouter from "./routes/session.js";
import productsRouter from "./routes/products.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import accountsRouter from "./routes/accounts.js";
import quotesRouter from "./routes/quotes.js";
import invoicesRouter from "./routes/invoices.js";
import ordersRouter from "./routes/orders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { PORT = 3000 } = process.env;

const app = express();

// Webhooks needs express.raw() for its own signature verification on
// POST /webhooks - must be mounted before express.json() below so the raw
// body middleware sees the request first.
app.use(webhooksRouter);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(sessionRouter);
app.use(productsRouter);
app.use(subscriptionsRouter);
app.use(accountsRouter);
app.use(quotesRouter);
app.use(invoicesRouter);
app.use(ordersRouter);

app.listen(PORT, () => {
  console.log(`Payment Components demo running at http://localhost:${PORT}`);
});
