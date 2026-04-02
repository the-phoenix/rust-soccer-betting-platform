export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">PitchPool</p>
        <h1>On-chain soccer markets for bettors, operators, and auditors.</h1>
        <p className="lede">
          Next.js frontend scaffold for the CosmWasm contract. The next step wires
          wallet connection, contract queries, and execute actions into this shell.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Markets</h2>
          <p>Browse 1X2 pools, market status, settlement state, and pool balances.</p>
        </article>
        <article className="panel">
          <h2>Trading Actions</h2>
          <p>Place bets, settle or cancel markets, then claim winnings or refunds.</p>
        </article>
        <article className="panel">
          <h2>Contract State</h2>
          <p>Inspect config, fee accruals, bettor ledgers, and contract responses.</p>
        </article>
      </section>
    </main>
  );
}
