"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";

import {
  queryBettor,
  queryConfig,
  queryMarket,
  queryMarkets,
} from "../lib/anchor-client";
import { appConfig, hasRequiredChainConfig } from "../lib/config";
import type {
  BettorResponse,
  ConfigResponse,
  MarketResponse,
  Outcome,
} from "../lib/contract-types";
import {
  cancelMarket,
  claim,
  createMarket,
  placeBet,
  refund,
  settleMarket,
  withdrawFees,
} from "../lib/execute-client";
import {
  formatTimestamp,
  lamportsToSol,
  parseInteger,
  shortenAddress,
} from "../lib/format";
import {
  pushActivityEntry,
  readActivityHistory,
  type ActivityEntry,
} from "../lib/history";
import { connectWallet, type SolanaWallet } from "../lib/wallet";

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
  amount: "100000000",
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
  const [wallet, setWallet] = useState<SolanaWallet | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState(
    "Configure Solana env vars, then connect a wallet.",
  );
  const [configData, setConfigData] = useState<ConfigResponse | null>(null);
  const [marketData, setMarketData] = useState<MarketResponse | null>(null);
  const [bettorData, setBettorData] = useState<BettorResponse | null>(null);
  const [marketList, setMarketList] = useState<MarketResponse[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [createMarketForm, setCreateMarketForm] = useState(initialCreateMarket);
  const [placeBetForm, setPlaceBetForm] = useState(initialPlaceBet);
  const [settleForm, setSettleForm] = useState(initialSettle);
  const [lookup, setLookup] = useState(initialLookup);
  const deferredMarketId = useDeferredValue(lookup.marketId);

  useEffect(() => {
    setActivity(readActivityHistory());

    if (!hasRequiredChainConfig()) {
      setFeedback(
        "Missing Solana configuration. Copy apps/solana-web/.env.example to .env.local and fill in your RPC and program values.",
      );
      return;
    }

    startTransition(() => {
      void loadExplorer();
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

  async function loadExplorer() {
    const [config, markets] = await Promise.all([queryConfig(), queryMarkets()]);
    setConfigData(config);
    setMarketList(markets);

    if (!marketData && markets[0]) {
      setMarketData(markets[0]);
      syncMarketId(String(markets[0].market_id));
    }

    setFeedback(`Loaded ${markets.length} recent markets from Solana.`);
  }

  function syncMarketId(marketId: string) {
    setLookup((current) => ({ ...current, marketId }));
    setPlaceBetForm((current) => ({ ...current, marketId }));
    setSettleForm((current) => ({ ...current, marketId }));
  }

  function recordQuery(label: string, detail: string) {
    setActivity(
      pushActivityEntry({
        kind: "query",
        label,
        detail,
      }),
    );
  }

  function recordExecution(label: string, detail: string, signature?: string) {
    setActivity(
      pushActivityEntry({
        kind: "execute",
        label,
        detail,
        signature,
      }),
    );
  }

  async function ensureWallet() {
    if (wallet && walletAddress) {
      return { wallet, address: walletAddress };
    }

    const connection = await connectWallet();
    setWallet(connection.wallet);
    setWalletAddress(connection.address);
    return { wallet: connection.wallet, address: connection.address };
  }

  function withExecute(label: string, action: (wallet: SolanaWallet, address: string) => Promise<{ signature: string }>) {
    return runAction(label, async () => {
      const connection = await ensureWallet();
      const result = await action(connection.wallet, connection.address);
      recordExecution(label, label, result.signature);
      setFeedback(`${label} submitted: ${result.signature}`);
      await loadExplorer();
    });
  }

  async function refreshSelectedMarket() {
    const marketId = parseInteger(deferredMarketId, "market id");
    const market = await queryMarket(marketId);
    setMarketData(market);
    recordQuery("Market query", `Loaded market ${marketId}`);
    setFeedback(`Loaded market ${marketId}.`);
  }

  async function refreshBettor() {
    const marketId = parseInteger(lookup.marketId, "market id");
    if (!lookup.bettor) {
      throw new Error("Enter a bettor address first.");
    }

    const bettor = await queryBettor(marketId, lookup.bettor);
    setBettorData(bettor);
    recordQuery("Bettor query", `Loaded bettor ledger for market ${marketId}`);
    setFeedback(`Loaded bettor view for market ${marketId}.`);
  }

  return (
    <main className="dashboard-shell">
      <section className="masthead">
        <div>
          <p className="eyebrow">PitchPool Solana Console</p>
          <h1>Inspect Anchor market state from one board.</h1>
          <p className="lede">
            Browse recent Solana markets, inspect config and bettor ledgers, and
            connect an injected wallet before moving on to transaction flows.
          </p>
        </div>
        <div className="masthead-side">
          <button
            className="primary-button"
            disabled={Boolean(busyAction) || !hasRequiredChainConfig()}
            onClick={() =>
              runAction("Wallet connect", async () => {
                const connection = await connectWallet();
                setWallet(connection.wallet);
                setWalletAddress(connection.address);
                setLookup((current) => ({
                  ...current,
                  bettor: current.bettor || connection.address,
                }));
                setCreateMarketForm((current) => ({
                  ...current,
                  oracle: current.oracle || connection.address,
                }));
                setFeedback(`Wallet connected: ${connection.address}`);
              })
            }
          >
            {busyAction === "Wallet connect" ? "Connecting..." : "Connect Wallet"}
          </button>
          <dl className="status-list">
            <div>
              <dt>Cluster</dt>
              <dd>{appConfig.clusterName}</dd>
            </div>
            <div>
              <dt>Program</dt>
              <dd>{appConfig.programId || "Unset"}</dd>
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
              Recent markets are derived from the config account&apos;s
              <code> next_market_id </code>
              field and loaded newest-first.
            </p>
          </div>
          <div className="button-row">
            <button
              className="ghost-button"
              disabled={busyAction === "Refresh explorer" || !hasRequiredChainConfig()}
              onClick={() => runAction("Refresh explorer", loadExplorer)}
            >
              Refresh Markets
            </button>
          </div>
          <div className="market-list">
            {marketList.length > 0 ? (
              marketList.map((market) => (
                <button
                  key={market.address}
                  className={`market-tile ${marketData?.address === market.address ? "market-tile-active" : ""}`}
                  onClick={() =>
                    runAction("Select market", async () => {
                      setMarketData(market);
                      syncMarketId(String(market.market_id));
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
                      <span>Kickoff</span>
                      <span>{formatTimestamp(market.kickoff_ts)}</span>
                    </div>
                    <div>
                      <span>Total Pool</span>
                      <span>{lamportsToSol(market.total_staked)} SOL</span>
                    </div>
                  </dl>
                </button>
              ))
            ) : (
              <p className="empty-state">
                No markets found yet. Initialize the Anchor program and create
                a market first.
              </p>
            )}
          </div>
        </article>

        <article className="console-card">
          <div className="card-heading">
            <h2>Quick Lookups</h2>
            <p>Refresh the selected market or inspect a bettor ledger PDA.</p>
          </div>
          <div className="stack">
            <label className="field">
              <span>Market ID</span>
              <input
                value={lookup.marketId}
                onChange={(event) => syncMarketId(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Bettor Address</span>
              <input
                placeholder="Enter a Solana public key"
                value={lookup.bettor}
                onChange={(event) =>
                  setLookup((current) => ({ ...current, bettor: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="ghost-button"
              disabled={busyAction === "Load market"}
              onClick={() => runAction("Load market", refreshSelectedMarket)}
            >
              Load Market
            </button>
            <button
              className="ghost-button"
              disabled={busyAction === "Load bettor"}
              onClick={() => runAction("Load bettor", refreshBettor)}
            >
              Load Bettor
            </button>
          </div>
        </article>

        <article className="console-card full-span">
          <div className="card-heading">
            <h2>Write Actions</h2>
            <p>These controls submit transactions directly to the Anchor program.</p>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>League</span>
              <input
                value={createMarketForm.league}
                onChange={(event) =>
                  setCreateMarketForm((current) => ({
                    ...current,
                    league: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Oracle</span>
              <input
                value={createMarketForm.oracle}
                onChange={(event) =>
                  setCreateMarketForm((current) => ({
                    ...current,
                    oracle: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Home Team</span>
              <input
                value={createMarketForm.homeTeam}
                onChange={(event) =>
                  setCreateMarketForm((current) => ({
                    ...current,
                    homeTeam: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Away Team</span>
              <input
                value={createMarketForm.awayTeam}
                onChange={(event) =>
                  setCreateMarketForm((current) => ({
                    ...current,
                    awayTeam: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Kickoff Timestamp</span>
              <input
                placeholder="Unix seconds"
                value={createMarketForm.kickoffTs}
                onChange={(event) =>
                  setCreateMarketForm((current) => ({
                    ...current,
                    kickoffTs: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Close Timestamp</span>
              <input
                placeholder="Unix seconds"
                value={createMarketForm.closeTs}
                onChange={(event) =>
                  setCreateMarketForm((current) => ({
                    ...current,
                    closeTs: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="primary-button"
              disabled={busyAction === "Create market"}
              onClick={() =>
                withExecute("Create market", (connectedWallet, address) =>
                  createMarket(
                    {
                      signerAddress: address,
                      league: createMarketForm.league,
                      homeTeam: createMarketForm.homeTeam,
                      awayTeam: createMarketForm.awayTeam,
                      kickoffTs: parseInteger(
                        createMarketForm.kickoffTs,
                        "kickoff timestamp",
                      ),
                      closeTs: parseInteger(
                        createMarketForm.closeTs,
                        "close timestamp",
                      ),
                      oracle: createMarketForm.oracle || address,
                    },
                    connectedWallet,
                  ),
                )
              }
            >
              Create Market
            </button>
          </div>

          <div className="compact-group">
            <label className="field">
              <span>Bet Market ID</span>
              <input
                value={placeBetForm.marketId}
                onChange={(event) =>
                  setPlaceBetForm((current) => ({
                    ...current,
                    marketId: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Outcome</span>
              <select
                value={placeBetForm.outcome}
                onChange={(event) =>
                  setPlaceBetForm((current) => ({
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
              <span>Stake Lamports</span>
              <input
                value={placeBetForm.amount}
                onChange={(event) =>
                  setPlaceBetForm((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="ghost-button"
              disabled={busyAction === "Place bet"}
              onClick={() =>
                withExecute("Place bet", (connectedWallet, address) =>
                  placeBet(
                    address,
                    connectedWallet,
                    parseInteger(placeBetForm.marketId, "bet market id"),
                    placeBetForm.outcome,
                    parseInteger(placeBetForm.amount, "stake lamports"),
                  ),
                )
              }
            >
              Place Bet
            </button>
            <button
              className="ghost-button"
              disabled={busyAction === "Claim"}
              onClick={() =>
                withExecute("Claim", (connectedWallet, address) =>
                  claim(
                    address,
                    connectedWallet,
                    parseInteger(placeBetForm.marketId, "claim market id"),
                  ),
                )
              }
            >
              Claim
            </button>
            <button
              className="ghost-button"
              disabled={busyAction === "Refund"}
              onClick={() =>
                withExecute("Refund", (connectedWallet, address) =>
                  refund(
                    address,
                    connectedWallet,
                    parseInteger(placeBetForm.marketId, "refund market id"),
                  ),
                )
              }
            >
              Refund
            </button>
          </div>

          <div className="compact-group">
            <label className="field">
              <span>Settle Market ID</span>
              <input
                value={settleForm.marketId}
                onChange={(event) =>
                  setSettleForm((current) => ({
                    ...current,
                    marketId: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Outcome</span>
              <select
                value={settleForm.outcome}
                onChange={(event) =>
                  setSettleForm((current) => ({
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
            <div className="field">
              <span>Operator Actions</span>
              <div className="button-row inline-actions">
                <button
                  className="ghost-button"
                  disabled={busyAction === "Settle market"}
                  onClick={() =>
                    withExecute("Settle market", (connectedWallet, address) =>
                      settleMarket(
                        address,
                        connectedWallet,
                        parseInteger(settleForm.marketId, "settle market id"),
                        settleForm.outcome,
                      ),
                    )
                  }
                >
                  Settle
                </button>
                <button
                  className="ghost-button"
                  disabled={busyAction === "Cancel market"}
                  onClick={() =>
                    withExecute("Cancel market", (connectedWallet, address) =>
                      cancelMarket(
                        address,
                        connectedWallet,
                        parseInteger(settleForm.marketId, "cancel market id"),
                      ),
                    )
                  }
                >
                  Cancel
                </button>
                <button
                  className="ghost-button"
                  disabled={busyAction === "Withdraw fees"}
                  onClick={() =>
                    withExecute("Withdraw fees", (connectedWallet, address) =>
                      withdrawFees(address, connectedWallet),
                    )
                  }
                >
                  Withdraw Fees
                </button>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="data-grid">
        <article className="data-card">
          <div className="card-heading">
            <h2>Config</h2>
            <p>The singleton config PDA holds admin, fee accrual, and sequencing.</p>
          </div>
          {configData ? (
            <dl className="data-list">
              <div>
                <dt>Address</dt>
                <dd>{configData.address}</dd>
              </div>
              <div>
                <dt>Admin</dt>
                <dd>{configData.admin}</dd>
              </div>
              <div>
                <dt>Treasury Bps</dt>
                <dd>{configData.treasury_bps}</dd>
              </div>
              <div>
                <dt>Accrued Fees</dt>
                <dd>{lamportsToSol(configData.accrued_fees)} SOL</dd>
              </div>
              <div>
                <dt>Next Market ID</dt>
                <dd>{configData.next_market_id}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">Config not loaded yet.</p>
          )}
        </article>

        <article className="data-card">
          <div className="card-heading">
            <h2>Selected Market</h2>
            <p>The market PDA carries stake pools, status, oracle, and settlement data.</p>
          </div>
          {marketData ? (
            <dl className="data-list">
              <div>
                <dt>Address</dt>
                <dd>{marketData.address}</dd>
              </div>
              <div>
                <dt>Teams</dt>
                <dd>
                  {marketData.home_team} vs {marketData.away_team}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{marketData.status}</dd>
              </div>
              <div>
                <dt>Oracle</dt>
                <dd>{marketData.oracle}</dd>
              </div>
              <div>
                <dt>Kickoff</dt>
                <dd>{formatTimestamp(marketData.kickoff_ts)}</dd>
              </div>
              <div>
                <dt>Close</dt>
                <dd>{formatTimestamp(marketData.close_ts)}</dd>
              </div>
              <div>
                <dt>Settled</dt>
                <dd>{marketData.settled_outcome ?? "Not settled"}</dd>
              </div>
              <div>
                <dt>Total Staked</dt>
                <dd>{lamportsToSol(marketData.total_staked)} SOL</dd>
              </div>
              <div>
                <dt>Payout Pool</dt>
                <dd>{lamportsToSol(marketData.total_payout_pool)} SOL</dd>
              </div>
              <div>
                <dt>Home Pool</dt>
                <dd>{lamportsToSol(marketData.home_pool)} SOL</dd>
              </div>
              <div>
                <dt>Draw Pool</dt>
                <dd>{lamportsToSol(marketData.draw_pool)} SOL</dd>
              </div>
              <div>
                <dt>Away Pool</dt>
                <dd>{lamportsToSol(marketData.away_pool)} SOL</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">No market selected.</p>
          )}
        </article>

        <article className="data-card">
          <div className="card-heading">
            <h2>Bettor Ledger</h2>
            <p>The bettor PDA tracks per-outcome stake plus claim and refund flags.</p>
          </div>
          {bettorData ? (
            <dl className="data-list">
              <div>
                <dt>Address</dt>
                <dd>{bettorData.address}</dd>
              </div>
              <div>
                <dt>Bettor</dt>
                <dd>{bettorData.bettor}</dd>
              </div>
              <div>
                <dt>Market</dt>
                <dd>{bettorData.market}</dd>
              </div>
              <div>
                <dt>Home Stake</dt>
                <dd>{lamportsToSol(bettorData.home_stake)} SOL</dd>
              </div>
              <div>
                <dt>Draw Stake</dt>
                <dd>{lamportsToSol(bettorData.draw_stake)} SOL</dd>
              </div>
              <div>
                <dt>Away Stake</dt>
                <dd>{lamportsToSol(bettorData.away_stake)} SOL</dd>
              </div>
              <div>
                <dt>Claimed</dt>
                <dd>{bettorData.claimed ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Refunded</dt>
                <dd>{bettorData.refunded ? "Yes" : "No"}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">No bettor ledger loaded.</p>
          )}
        </article>

        <article className="data-card full-span">
          <div className="card-heading">
            <h2>Activity</h2>
            <p>Recent read activity is stored locally in the browser.</p>
          </div>
          {activity.length > 0 ? (
            <div className="history-list">
              {activity.map((entry) => (
                <article key={entry.id} className="history-item">
                  <div className="history-top">
                    <span className={`status-pill status-${entry.kind}`}>{entry.kind}</span>
                    <time dateTime={entry.timestamp}>
                      {new Date(entry.timestamp).toLocaleString()}
                    </time>
                  </div>
                  <strong>{entry.label}</strong>
                  <p>{entry.detail}</p>
                  {entry.signature ? (
                    <span className="history-hash">{entry.signature}</span>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">No local activity yet.</p>
          )}
        </article>
      </section>

      <section className="feedback-bar">
        <span className="feedback-label">Status</span>
        <p>{feedback}</p>
      </section>
    </main>
  );
}
