# Realtime messaging deployment

Render hosts the primary REST API and Socket.IO server. Vercel remains the email relay. Both frontend API and socket URLs must refer to that same Render service and database.

Deploy the updated backend to Render, then the updated frontend to Vercel. No Prisma model migration is required. For fast retry lookup, run `node scripts/ensure-message-index.js` once with the Render database credentials configured in `.env`. This adds a nonunique index without changing or deleting documents. The index has already been created against the local configured database by this task.

The server broadcasts messages after database persistence through a union of personal and conversation rooms, avoiding duplicates. REST fallback sends broadcast through the same publisher. History includes delivery/read receipts. Concurrent retries on one server share the same pending send and reuse persisted client message IDs.

The frontend inserts a message immediately, shows Sending until confirmation, and allows retry with the same ID after failures. Socket listeners follow socket replacement and reconnect, rejoin the active room, and recover history. Polling remains a slower recovery path rather than the normal transport. Seen requires a focused, visible chat scrolled near its newest messages; receiving a message in the background only acknowledges delivery.

Presence follows actual socket connections, including multiple tabs. The final tab disconnect records last-seen time. A sudden network loss requires heartbeat timeout detection; this cannot be instantaneous. The current heartbeat checks every 10 seconds with a 5-second timeout.

Check with two browser accounts: send several messages quickly, watch Sent → Delivered → Seen, hide or scroll up the recipient tab to verify Seen waits, reconnect a tab, and close the final recipient tab to verify offline time. Typing dots should appear on the first keystroke, persist during continued typing and stop on send or inactivity.

These changes reduce application waits; real delivery latency still includes network, database and Render cold-start time. In-memory connection presence and concurrent-send protection assume one primary backend process. Scaling across multiple backend instances requires shared Socket.IO/presence infrastructure and database-enforced idempotency.
