export type SolanaAddress = string;

export type TokenHolding = {
    symbol?: string;
    name?: string;
    balance: number;
    price: number;
    value: number;
    icon?: string;
    address: SolanaAddress;
};

export type Holdings = {
    tokens: TokenHolding[];
    totalValue: number;
};

export type TokenPnL = {
    address: SolanaAddress;
    symbol?: string;
    invested: number;
    currentValue: number;
    realizedPnL: number;
    unrealizedPnL: number;
    totalPnL: number;
    totalPnLPercent: number;
    avgBuyPrice: number;
};

export type DefiPositionType = 'deposit' | 'borrow';

export type DefiPosition = {
    protocol: string;
    protocolIcon?: string;
    token?: string;
    tokenIcon?: string;
    type: DefiPositionType | string;
    amount: number;
    value: number;
    apy: number;
    source: 'lambda' | 'dialect' | string;
};

export type DefiSummary = {
    positions: DefiPosition[];
    totalDeposits: number;
    totalBorrows: number;
};

export type CashEvent = {
    kind: 'buy_swap' | 'sell_swap' | 'buy_transfer';
    mint: SolanaAddress;
    amount: number;
    usd: number;
    ts: number;
    signature?: string | null;
    source?: string | null;
};

export type BuyAggregate = {
    amountBought: number;
    totalCostUsd: number;
    txCount: number;
    firstTs: number;
    lastTs: number;
};

export type SellAggregate = {
    amountSold: number;
    totalProceedsUsd: number;
    txCount: number;
    firstTs: number;
    lastTs: number;
};

export type TradePnLRow = {
    mint: SolanaAddress;
    symbol?: string;
    name?: string;
    icon?: string;
    currentAmount: number;
    currentPrice: number;
    currentValue: number;
    costBasis: number;
    avgCostPerToken: number;
    pnl: number;
    pnlPercent: number;
    householdSpent: number | null;
    householdBought: number | null;
    householdHeld: number | null;
    txCount: number;
    costSource: string;
    attribution: 'wallet' | 'household';
};

export type TradeHistoryRow = {
    kind: 'buy_swap' | 'sell_swap' | 'buy_transfer';
    side: 'buy' | 'sell';
    wallet: SolanaAddress;
    walletShort: string;
    mint: SolanaAddress;
    symbol?: string | null;
    amount: number;
    usd: number;
    ts: number;
    signature?: string | null;
    source?: string | null;
    fromExternal: boolean;
    fromAccount?: string | null;
};

export type TradePnLSummary = {
    currentValue: number;
    investedTotal: number;
    investedGross: number;
    realizedReceipts: number;
    absoluteReturnUsd: number;
    absoluteReturnPct: number | null;
    xirrPct: number | null;
    benchmarkSolXirrPct: number | null;
    cashflowCount: number;
};

export type TradePnLResult = {
    perWallet: Record<SolanaAddress, TradePnLRow[]>;
    totals: { totalPnL: number; totalCostBasis: number; totalValue: number };
    summary: TradePnLSummary;
    tradeHistory: TradeHistoryRow[];
    solPriceUsd: number;
    walletsScanned: number;
    hasUnpriced: boolean;
};

export type ApiProvider = 'birdeye' | 'lambda' | 'dialect';

export type ApiStats = {
    calls: number;
    errors: number;
    timeouts: number;
    totalLatencyMs: number;
    latencies: number[];
};
