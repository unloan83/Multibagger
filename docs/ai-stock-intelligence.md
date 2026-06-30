# AI Stock Intelligence

The Stock Planner recommendation flow is coordinated by eight deterministic agents:

1. `agentInfo` scores portfolio-agnostic news and event records.
2. `agentMacroPolicy` scores market, policy, political, global, and sector effects.
3. `agentSentiment` validates tone while capping blog/social influence.
4. `agentPortfolio` evaluates only the authenticated portfolio.
5. `agentGrowth` converts the existing stock engine's qualified signals into candidates.
6. `agentRiskValidation` checks conflict, freshness, confidence, volatility, liquidity, event uncertainty, and portfolio fit.
7. `agentPerformance` reconciles hit/miss outcomes and derives guarded scoring adjustments after five completed observations.
8. `agentOrchestrator` is the only module allowed to issue a final Buy, Hold, Sell, or Watch action.

The system currently runs in **shadow mode**. Agent actions are available only through the authenticated Admin → Agent Shadow Validation tab. Normal portfolio users continue to receive the existing production recommendation logic.

Default orchestrator weights are 35% existing logic, 20% information, 15% macro/policy, 10% sentiment, 10% portfolio, and 10% risk validation. Callers can pass a different `OrchestratorWeights` object, but weights must be non-negative and total 100.

## Intelligence feed

Set `MARKET_INTELLIGENCE_FEED_URL` to a trusted, portfolio-agnostic JSON feed. The application fetches this feed without sending portfolio IDs, holdings, symbols, or user data, then filters it locally.

```json
{
  "events": [
    {
      "summary": "Government approves a new power-grid investment programme",
      "affectedStocks": ["NTPC"],
      "affectedSectors": ["Power"],
      "source": {
        "name": "Official ministry release",
        "credibility": "high",
        "kind": "government_policy",
        "url": "https://example.invalid/release",
        "publishedAt": "2026-06-30T04:00:00.000Z"
      }
    }
  ]
}
```

Supported `kind` values are `exchange_filing`, `company_news`, `quarterly_result`, `corporate_action`, `sector_news`, `government_policy`, `politics`, `global_market`, `macro`, `analyst`, `blog`, and `social`. Social events are always capped as low-confidence inputs.

Recommendation logs are written to an `Agent Recommendation Logs` worksheet in the configured Google spreadsheet. Logs contain every agent score, current-logic comparison, entry, final action, timeframe, supported target/stop-loss, confidence, source types, 1-day/1-week/1-month outcomes, hit/miss reason, and positive/negative contributors.

Each admin validation run is stored separately in `Agent Validation Runs`, including agent health, source inventory, coverage gaps, freshness alerts, required access, accuracy comparisons, and promotion-gate status. Promotion remains blocked until at least 30 shadow recommendations are complete, explanation quality is at least 80/100, agent accuracy is at least five percentage points better than current logic, and all required source coverage is present. Passing this automated gate permits manual review only; it does not automatically replace production logic.

The shadow API requires an authenticated admin session. A browser quote snapshot is checked against the stored portfolio symbol list; holdings are never added from client input and no new holding-specific third-party news query is made.
