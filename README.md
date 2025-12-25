# Portfolio Dashboard

A minimalistic multi-wallet portfolio tracker for Solana.

## Features

- Track multiple Solana wallets
- Real-time portfolio value updates
- Token holdings with USD values
- Transaction history

## Local Development

```bash
# Install dependencies
npm install

# Initialize the database (requires PostgreSQL)
npm run db:init

# Start the server
npm start

# Or with hot reload
npm run dev
```

## Environment Variables

Create a `.env` file:

```env
DATABASE_URL=postgres://user:password@localhost:5432/portfolio
PORT=3000
```

## Deployment (DigitalOcean App Platform)

This app is configured for deployment on DigitalOcean App Platform.

1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. Click "Create App"
3. Select GitHub and choose this repository
4. DigitalOcean will auto-detect the `.do/app.yaml` configuration
5. Add the `DATABASE_URL` secret in the app settings
6. Deploy!

The app will auto-deploy on every push to `main`.

