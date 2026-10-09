# BLUEPAY

BLUEPAY is a basic account, payment-request, and withdrawal-request demo.

## Files

- package.json
- server.js
- README.md
- public/index.html
- public/style.css
- public/app.js

## Run locally

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Set `ADMIN_ACCESS_KEY` to a new private admin key.
4. Set `SESSION_SECRET` to a random secret at least 32 characters long.
5. Run `npm start`.
6. Open http://localhost:3000.

## Deploy on Render

Build command:

npm install

Start command:

npm start

Add these environment variables in Render:

- ADMIN_ACCESS_KEY
- SESSION_SECRET
- NODE_ENV=production

Do not put secret values in frontend files or GitHub.

## Important limitations

This is a demo, not a production financial platform.

- Payment references are submitted for manual review.
- The server does not independently verify bank transfers.
- Withdrawal requests are recorded; money is not transferred automatically.
- The default Express session store and JSON file storage are not suitable for a production deployment.
- Use a persistent database, persistent session store, CSRF protection, and verified payment/payout provider integrations before handling real money.
- Never treat a displayed demo amount as real funds.
