"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";

import {
  executeContract,
  queryBettor,
  queryConfig,
  queryMarket,
  queryMarkets,
} from "../lib/contract-client";
import { appConfig, hasRequiredChainConfig } from "../lib/config";
import type {
  BettorResponse,
  ConfigResponse,
  ExecuteMessage,
  MarketResponse,
  Outcome,
} from "../lib/contract-types";
import { formatTimestamp, parseInteger, shortenAddress } from "../lib/format";
import { connectKeplr } from "../lib/keplr";

const initialCreateMarket = {
  league: "Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Liverpool",
  kickoffTs: "",
  closeTs: "",
  oracle: "",
};

const initialPlaceBet = {
  marketId: "1",
  outcome: "home_win" as Outcome,
  amount: "100",
};

const initialSettle = {
  marketId: "1",
  outcome: "home_win" as Outcome,
};

const initialLookup = {
  marketId: "1",
  bettor: "",
};

export default function HomePage() {
  const [walletAddress, setWalletAddress] = useState("");
  const [walletSigner, setWalletSigner] = useState<Awaited<
    ReturnType<typeof connectKeplr>
  >["signer"] | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState("Configure env vars, then connect a wallet.");
  const [configData, setConfigData] = useState<ConfigResponse | null>(null);
  const [marketData, setMarketData] = useState<MarketResponse | null>(null);
  const [bettorData, setBettorData] = useState<BettorResponse | null>(null);
  const [marketList, setMarketList] = useState<MarketResponse[]>([]);
  const [createMarket, setCreateMarket] = useState(initialCreateMarket);
  const [placeBet, setPlaceBet] = useState(initialPlaceBet);
  const [settleMarket, setSettleMarket] = useState(initialSettle);
  const [lookup, setLookup] = useState(initialLookup);
  const deferredMarketId = useDeferredValue(lookup.marketId);

  useEffect(() => {
    if (!hasRequiredChainConfig()) {
      setFeedback(
        "Missing chain configuration. Copy apps/web/.env.example to .env.local and fill in your chain values.",
      );
      return;
    }

    startTransition(() => {
      void loadMarketExplorer();
    });
  }, []);

  async function runAction(label: string, action: () => Promise<void>) {
    setBusyAction(label);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setFeedback(`${label} failed: ${message}`);
    } finally {
      setBusyAction("");
    }
  }

  async function ensureWallet() {
    if (walletSigner && walletAddress) {
      return { signer: walletSigner, address: walletAddress };
    }
    const connection = await connectKeplr();
    setWalletSigner(connection.signer);
    setWalletAddress(connection.address);
    return connection;
  }

  async function loadMarketExplorer() {
    const [config, markets] = await Promise.all([queryConfig(), queryMarkets()]);
    setConfigData(config);
    setMarketList(markets);
    if (!marketData && markets[0]) {
      setMarketData(markets[0]);
      setLookup((current) => ({ ...current, marketId: String(markets[0].market_id) }));
      setPlaceBet((current) => ({ ...current, marketId: String(markets[0].market_id) }));
      setSettleMarket((current) => ({ ...current, marketId: String(markets[0].market_id) }));
    }
    setFeedback(`Loaded ${markets.length} recent markets.`);
  }

  function syncMarketId(marketId: string) {
    setLookup((current) => ({ ...current, marketId }));
    setPlaceBet((current) => ({ ...current, marketId }));
    setSettleMarket((current) => ({ ...current, marketId }));
  }

  function withExecute(
    message: ExecuteMessage,
    label: string,
    funds?: { amount: string; denom: string }[],
  ) {
    return runAction(label, async () => {
      const connection = await ensureWallet();
      const result = await executeContract(
        connection.address,
        connection.signer,
        message,
        funds,
      );
      setFeedback(`${label} submitted: ${result.transactionHash}`);
      await loadMarketExplorer();
    });
  }

  return (
    <main className="dashboard-shell">
      <section className="masthead">
        <div>
          <p className="eyebrow">PitchPool Control Room</p>
          <h1>Drive every contract action from one betting console.</h1>
          <p className="lede">
            Query config and market state, browse recent markets, connect a
            Keplr wallet, place bets, settle or cancel markets, then claim
            payouts or refunds against the deployed CosmWasm contract.
          </p>
        </div>
        <div className="masthead-side">
          <button
            className="primary-button"
            disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
            onClick={() =>
              runAction("Wallet connect", async () => {
                const connection = await connectKeplr();
                setWalletSigner(connection.signer);
                setWalletAddress(connection.address);
                setFeedback(`Wallet connected: ${connection.address}`);
                setLookup((current) => ({
                  ...current,
                  bettor: current.bettor || connection.address,
                }));
                setCreateMarket((current) => ({
                  ...current,
                  oracle: current.oracle || connection.address,
                }));
              })
            }
          >
            {busyAction === "Wallet connect" ? "Connecting..." : "Connect Wallet"}
          </button>
          <dl className="status-list">
            <div>
              <dt>Chain</dt>
              <dd>{appConfig.chainName}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>{appConfig.contractAddress || "Unset"}</dd>
            </div>
            <div>
              <dt>Wallet</dt>
              <dd>{walletAddress ? shortenAddress(walletAddress) : "Disconnected"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="console-grid">
        <article className="console-card explorer-card">
          <div className="card-heading">
            <h2>Market Explorer</h2>
            <p>
              Recent markets are derived from <code>next_market_id</code> and
              loaded newest-first from contract queries.
            </p>
          </div>
          <div className="button-row">
            <button
              className="ghost-button"
              disabled={busyAction === "Refresh explorer" || !hasRequiredChainConfig()}
              onClick={() => runAction("Refresh explorer", loadMarketExplorer)}
            >
              Refresh Markets
            </button>
          </div>
          <div className="market-list">
            {marketList.length > 0 ? (
              marketList.map((market) => (
                <button
                  key={market.market_id}
                  className={`market-tile ${marketData?.market_id === market.market_id ? "market-tile-active" : ""}`}
                  onClick={() =>
                    runAction("Select market", async () => {
                      startTransition(() => {
                        setMarketData(market);
                        syncMarketId(String(market.market_id));
                      });
                      setFeedback(`Market ${market.market_id} selected.`);
                    })
                  }
                >
                  <div className="market-tile-top">
                    <strong>#{market.market_id}</strong>
                    <span className={`status-pill status-${market.status}`}>{market.status}</span>
                  </div>
                  <h3>
                    {market.home_team} vs {market.away_team}
                  </h3>
                  <p>{market.league}</p>
                  <dl>
                    <div>
                      <dt>Kickoff</dt>
                      <dd>{formatTimestamp(market.kickoff_ts)}</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd>{market.total_staked}</dd>
                    </div>
                  </dl>
                </button>
              ))
            ) : (
              <EmptyState label="No markets loaded yet. Refresh after you create the first market." />
            )}
          </div>
        </article>

        <article className="console-card">
          <div className="card-heading">
            <h2>Read State</h2>
            <p>Read contract, market, and bettor views directly from chain RPC.</p>
          </div>
          <div className="stack">
            <button
              className="ghost-button"
              disabled={busyAction === "Query config" || !hasRequiredChainConfig()}
              onClick={() =>
                runAction("Query config", async () => {
                  const response = await queryConfig();
                  startTransition(() => {
                    setConfigData(response);
                  });
                  setFeedback("Config loaded.");
                })
              }
            >
              Load Config
            </button>

            <label className="field">
              <span>Market ID</span>
              <input
                value={lookup.marketId}
                onChange={(event) => {
                  const marketId = event.target.value;
                  setLookup((current) => ({ ...current, marketId }));
                }}
              />
            </label>

            <button
              className="ghost-button"
              disabled={busyAction === "Query market" || !hasRequiredChainConfig()}
              onClick={() =>
                runAction("Query market", async () => {
                  const response = await queryMarket(
                    parseInteger(deferredMarketId || lookup.marketId, "market id"),
                  );
                  startTransition(() => {
                    setMarketData(response);
                    syncMarketId(String(response.market_id));
                  });
                  setFeedback("Market loaded.");
                })
              }
            >
              Load Market
            </button>

            <label className="field">
              <span>Bettor Address</span>
              <input
                value={lookup.bettor}
                onChange={(event) =>
                  setLookup((current) => ({ ...current, bettor: event.target.value }))
                }
                placeholder={`${appConfig.addressPrefix}1...`}
              />
            </label>

            <button
              className="ghost-button"
              disabled={busyAction === "Query bettor" || !hasRequiredChainConfig()}
              onClick={() =>
                runAction("Query bettor", async () => {
                  const response = await queryBettor(
                    parseInteger(lookup.marketId, "market id"),
                    lookup.bettor,
                  );
                  startTransition(() => {
                    setBettorData(response);
                  });
                  setFeedback("Bettor view loaded.");
                })
              }
            >
              Load Bettor
            </button>
          </div>
        </article>

        <article className="console-card">
          <div className="card-heading">
            <h2>Create Market</h2>
            <p>Admin flow for new 1X2 soccer markets.</p>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>League</span>
              <input
                value={createMarket.league}
                onChange={(event) =>
                  setCreateMarket((current) => ({ ...current, league: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Home Team</span>
              <input
                value={createMarket.homeTeam}
                onChange={(event) =>
                  setCreateMarket((current) => ({ ...current, homeTeam: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Away Team</span>
              <input
                value={createMarket.awayTeam}
                onChange={(event) =>
                  setCreateMarket((current) => ({ ...current, awayTeam: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Kickoff Unix Timestamp</span>
              <input
                value={createMarket.kickoffTs}
                onChange={(event) =>
                  setCreateMarket((current) => ({ ...current, kickoffTs: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Close Unix Timestamp</span>
              <input
                value={createMarket.closeTs}
                onChange={(event) =>
                  setCreateMarket((current) => ({ ...current, closeTs: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Oracle Address</span>
              <input
                value={createMarket.oracle}
                onChange={(event) =>
                  setCreateMarket((current) => ({ ...current, oracle: event.target.value }))
                }
              />
            </label>
          </div>
          <button
            className="primary-button"
            disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
            onClick={() =>
              withExecute(
                {
                  create_market: {
                    league: createMarket.league,
                    home_team: createMarket.homeTeam,
                    away_team: createMarket.awayTeam,
                    kickoff_ts: createMarket.kickoffTs,
                    close_ts: createMarket.closeTs,
                    oracle: createMarket.oracle,
                  },
                },
                "Create market",
              )
            }
          >
            Create Market
          </button>
        </article>
      </section>

      <section className="console-grid">
        <article className="console-card full-span">
          <div className="card-heading">
            <h2>Betting Actions</h2>
            <p>Better, admin, and oracle transactions mapped to contract executes.</p>
          </div>

          <div className="compact-group">
            <label className="field">
              <span>Bet Market ID</span>
              <input
                value={placeBet.marketId}
                onChange={(event) =>
                  setPlaceBet((current) => ({ ...current, marketId: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Outcome</span>
              <select
                value={placeBet.outcome}
                onChange={(event) =>
                  setPlaceBet((current) => ({
                    ...current,
                    outcome: event.target.value as Outcome,
                  }))
                }
              >
                <option value="home_win">Home Win</option>
                <option value="draw">Draw</option>
                <option value="away_win">Away Win</option>
              </select>
            </label>
            <label className="field">
              <span>Stake Amount</span>
              <input
                value={placeBet.amount}
                onChange={(event) =>
                  setPlaceBet((current) => ({ ...current, amount: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="button-row">
            <button
              className="primary-button"
              disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
              onClick={() =>
                withExecute(
                  {
                    place_bet: {
                      market_id: parseInteger(placeBet.marketId, "market id"),
                      outcome: placeBet.outcome,
                    },
                  },
                  "Place bet",
                  [{ amount: placeBet.amount, denom: appConfig.stakeDenom }],
                )
              }
            >
              Place Bet
            </button>
          </div>

          <div className="compact-group">
            <label className="field">
              <span>Settle Market ID</span>
              <input
                value={settleMarket.marketId}
                onChange={(event) =>
                  setSettleMarket((current) => ({ ...current, marketId: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Settlement Outcome</span>
              <select
                value={settleMarket.outcome}
                onChange={(event) =>
                  setSettleMarket((current) => ({
                    ...current,
                    outcome: event.target.value as Outcome,
                  }))
                }
              >
                <option value="home_win">Home Win</option>
                <option value="draw">Draw</option>
                <option value="away_win">Away Win</option>
              </select>
            </label>
          </div>

          <div className="button-row">
            <button
              className="ghost-button"
              disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
              onClick={() =>
                withExecute(
                  {
                    settle_market: {
                      market_id: parseInteger(settleMarket.marketId, "market id"),
                      outcome: settleMarket.outcome,
                    },
                  },
                  "Settle market",
                )
              }
            >
              Settle
            </button>
            <button
              className="ghost-button"
              disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
              onClick={() =>
                withExecute(
                  {
                    cancel_market: {
                      market_id: parseInteger(settleMarket.marketId, "market id"),
                    },
                  },
                  "Cancel market",
                )
              }
            >
              Cancel
            </button>
            <button
              className="ghost-button"
              disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
              onClick={() =>
                withExecute(
                  {
                    claim: {
                      market_id: parseInteger(settleMarket.marketId, "market id"),
                    },
                  },
                  "Claim payout",
                )
              }
            >
              Claim
            </button>
            <button
              className="ghost-button"
              disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
              onClick={() =>
                withExecute(
                  {
                    refund: {
                      market_id: parseInteger(settleMarket.marketId, "market id"),
                    },
                  },
                  "Refund stake",
                )
              }
            >
              Refund
            </button>
            <button
              className="ghost-button"
              disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
              onClick={() =>
                withExecute(
                  {
                    withdraw_fees: {},
                  },
                  "Withdraw fees",
                )
              }
            >
              Withdraw Fees
            </button>
          </div>
        </article>
      </section>

      <section className="data-grid">
        <DataCard title="Config Snapshot">
          {configData ? (
            <dl className="data-list">
              <div><dt>Admin</dt><dd>{configData.admin}</dd></div>
              <div><dt>Treasury Bps</dt><dd>{configData.treasury_bps}</dd></div>
              <div><dt>Stake Denom</dt><dd>{configData.stake_denom}</dd></div>
              <div><dt>Accrued Fees</dt><dd>{configData.accrued_fees}</dd></div>
              <div><dt>Next Market</dt><dd>{configData.next_market_id}</dd></div>
            </dl>
          ) : (
            <EmptyState label="Load config to inspect contract-wide parameters." />
          )}
        </DataCard>

        <DataCard title="Market Snapshot">
          {marketData ? (
            <dl className="data-list">
              <div><dt>Fixture</dt><dd>{marketData.home_team} vs {marketData.away_team}</dd></div>
              <div><dt>League</dt><dd>{marketData.league}</dd></div>
              <div><dt>Status</dt><dd>{marketData.status}</dd></div>
              <div><dt>Oracle</dt><dd>{marketData.oracle}</dd></div>
              <div><dt>Kickoff</dt><dd>{formatTimestamp(marketData.kickoff_ts)}</dd></div>
              <div><dt>Close</dt><dd>{formatTimestamp(marketData.close_ts)}</dd></div>
              <div><dt>Settled At</dt><dd>{formatTimestamp(marketData.settled_at)}</dd></div>
              <div><dt>Outcome</dt><dd>{marketData.settled_outcome ?? "Not settled"}</dd></div>
              <div><dt>Total Staked</dt><dd>{marketData.total_staked}</dd></div>
              <div><dt>Home Pool</dt><dd>{marketData.home_pool}</dd></div>
              <div><dt>Draw Pool</dt><dd>{marketData.draw_pool}</dd></div>
              <div><dt>Away Pool</dt><dd>{marketData.away_pool}</dd></div>
              <div><dt>Payout Pool</dt><dd>{marketData.total_payout_pool}</dd></div>
            </dl>
          ) : (
            <EmptyState label="Load a market to inspect pools, status, and settlement data." />
          )}
        </DataCard>

        <DataCard title="Bettor Snapshot">
          {bettorData ? (
            <dl className="data-list">
              <div><dt>Bettor</dt><dd>{bettorData.bettor}</dd></div>
              <div><dt>Market</dt><dd>{bettorData.market_id}</dd></div>
              <div><dt>Home Stake</dt><dd>{bettorData.home_stake}</dd></div>
              <div><dt>Draw Stake</dt><dd>{bettorData.draw_stake}</dd></div>
              <div><dt>Away Stake</dt><dd>{bettorData.away_stake}</dd></div>
              <div><dt>Claimed</dt><dd>{String(bettorData.claimed)}</dd></div>
              <div><dt>Refunded</dt><dd>{String(bettorData.refunded)}</dd></div>
            </dl>
          ) : (
            <EmptyState label="Load a bettor record to inspect staking and claim state." />
          )}
        </DataCard>
      </section>

      <section className="feedback-bar">
        <span className="feedback-label">Console Feed</span>
        <p>{busyAction ? `${busyAction} in progress...` : feedback}</p>
      </section>
    </main>
  );
}

function DataCard({
  children,
  title,
}: Readonly<{ children: React.ReactNode; title: string }>) {
  return (
    <article className="data-card">
      <div className="card-heading">
        <h2>{title}</h2>
      </div>
      {children}
    </article>
  );
}

function EmptyState({ label }: Readonly<{ label: string }>) {
  return <p className="empty-state">{label}</p>;
}
