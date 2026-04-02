import { CosmWasmClient, SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import type { OfflineSigner } from "@cosmjs/proto-signing";

import { appConfig } from "./config";
import type {
  BettorResponse,
  ConfigResponse,
  ExecuteMessage,
  MarketResponse,
} from "./contract-types";

export async function connectQueryClient() {
  return CosmWasmClient.connect(appConfig.rpcEndpoint);
}

export async function connectSigningClient(signer: OfflineSigner) {
  return SigningCosmWasmClient.connectWithSigner(appConfig.rpcEndpoint, signer);
}

export async function queryConfig() {
  const client = await connectQueryClient();
  return client.queryContractSmart(appConfig.contractAddress, {
    config: {},
  }) as Promise<ConfigResponse>;
}

export async function queryMarket(marketId: number) {
  const client = await connectQueryClient();
  return client.queryContractSmart(appConfig.contractAddress, {
    market: { market_id: marketId },
  }) as Promise<MarketResponse>;
}

export async function queryMarkets(limit = 12) {
  const config = await queryConfig();
  const highestMarketId = Math.max(config.next_market_id - 1, 0);
  const marketIds = Array.from(
    { length: Math.min(limit, highestMarketId) },
    (_, index) => highestMarketId - index,
  ).filter((marketId) => marketId > 0);

  const markets = await Promise.all(
    marketIds.map(async (marketId) => {
      try {
        return await queryMarket(marketId);
      } catch {
        return null;
      }
    }),
  );

  return markets.filter((market): market is MarketResponse => market !== null);
}

export async function queryBettor(marketId: number, bettor: string) {
  const client = await connectQueryClient();
  return client.queryContractSmart(appConfig.contractAddress, {
    bettor: { market_id: marketId, bettor },
  }) as Promise<BettorResponse>;
}

export async function executeContract(
  signerAddress: string,
  signer: OfflineSigner,
  message: ExecuteMessage,
  funds?: { amount: string; denom: string }[],
) {
  const client = await connectSigningClient(signer);
  return client.execute(
    signerAddress,
    appConfig.contractAddress,
    message,
    "auto",
    undefined,
    funds,
  );
}
