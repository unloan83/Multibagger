# Multibagger Portfolio Dashboard

A Vercel-ready portfolio dashboard built with Next.js 15, TypeScript, Tailwind CSS, shadcn/ui-style components, Recharts, and PapaParse.

## Features

- Upload holdings from CSV in the browser.
- Portfolio summary cards for value, return, daily movement, and top sector.
- Portfolio growth chart.
- Holdings table with value, return, and allocation weight.
- Sector allocation pie chart.
- Portfolio heatmap sized by portfolio weight and colored by return.

## CSV Format

Use the included sample at `public/portfolio.csv`.

```csv
symbol,company,sector,quantity,averagePrice,currentPrice,previousClose
AAPL,Apple Inc.,Technology,48,164.20,193.48,190.88
```

Required columns:

- `symbol`
- `company`
- `sector`
- `quantity`
- `averagePrice`
- `currentPrice`
- `previousClose`

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, choose **Add New Project** and import the GitHub repository.
3. Keep the framework preset as **Next.js**.
4. Use the default build command:

```bash
npm run build
```

5. Use the default output settings and deploy.

No environment variables are required for the dashboard.
