const { SuiClient, getFullnodeUrl } = require('@mysten/sui.js/client');
const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography');
const dotenv = require('dotenv');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs').promises;
const SocksProxyAgent = require('socks-proxy-agent').SocksProxyAgent;

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  wallet: (msg) => console.log(`${colors.yellow}[➤] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`\n${colors.cyan}[⏳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`--------------------------------------------------`);
    console.log(`    Merak Testnet Auto Bot - Airdrop Insiders     `);
    console.log(`--------------------------------------------------${colors.reset}\n`);
  },
};

dotenv.config();

const CONFIG = {
  WRAP: {
    enabled: true,
    amount: 100_000_000,
  },
  SWAP_wSUI_wDUBHE: {
    enabled: true,
    amount: 100_000,
    repeat: 1,
  },
  SWAP_wDUBHE_wSUI: {
    enabled: true,
    amount: 100_000,
    repeat: 1,
  },
  SWAP_wSUI_wSTARS: {
    enabled: true,
    amount: 100_000,
    repeat: 1,
  },
  SWAP_wSTARS_wSUI: {
    enabled: true,
    amount: 100_000,
    repeat: 1,
  },
  ADD_LIQUIDITY_wSUI_wDUBHE: {
    enabled: true,
    asset0: 0,
    asset1: 1,
    amount0: 1_000_000,
    amount1: 5765,
    min0: 1,
    min1: 1,
    label: 'Add Liquidity wSUI-wDUBHE',
  },
  ADD_LIQUIDITY_wSUI_wSTARS: {
    enabled: true,
    asset0: 0,
    asset1: 3,
    amount0: 1_000_000,
    amount1: 19149,
    min0: 1,
    min1: 1,
    label: 'Add Liquidity wSUI-wSTARS',
  },
  ADD_LIQUIDITY_wDUBHE_wSTARS: {
    enabled: true,
    asset0: 1,
    asset1: 3,
    amount0: 2000,
    amount1: 13873,
    min0: 1,
    min1: 1,
    label: 'Add Liquidity wDUBHE-wSTARS',
  },
  DELAY_BETWEEN_TX_MS: 5000,
};

const CONTRACTS = {
  WRAP_TARGET: '0xa6477a6bf50e2389383b34a76d59ccfbec766ff2decefe38e1d8436ef8a9b245::dubhe_wrapper_system::wrap',
  DEX_TARGET: '0xa6477a6bf50e2389383b34a76d59ccfbec766ff2decefe38e1d8436ef8a9b245::dubhe_dex_system::swap_exact_tokens_for_tokens',
  SHARED_OBJECT: '0x8ece4cb6de126eb5c7a375f90c221bdc16c81ad8f6f894af08e0b6c25fb50a45',
  PATHS: {
    wSUI_wDUBHE: [BigInt(0), BigInt(1)],
    wDUBHE_wSUI: [BigInt(1), BigInt(0)],
    wSUI_wSTARS: [BigInt(0), BigInt(3)],
    wSTARS_wSUI: [BigInt(3), BigInt(0)],
  },
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function loadProxies() {
  try {
    const data = await fs.readFile('proxies.txt', 'utf8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line);
    if (proxies.length === 0) {
      logger.warn('No proxies found in proxies.txt. Running without proxy.');
      return [];
    }
    logger.info(`Loaded ${proxies.length} proxies from proxies.txt`);
    return proxies;
  } catch (e) {
    logger.error(`Failed to read proxies.txt: ${e.message}`);
    return [];
  }
}

function parseProxy(proxy) {
  let protocol = 'http';
  let auth = null;
  let host = proxy;

  if (proxy.includes('://')) {
    const [proto, rest] = proxy.split('://');
    protocol = proto.toLowerCase();
    host = rest;
  }

  if (host.includes('@')) {
    const [credentials, hostPort] = host.split('@');
    auth = credentials;
    host = hostPort;
  }

  const [ip, port] = host.split(':');
  if (!ip || !port) {
    logger.error(`Invalid proxy format: ${proxy}`);
    return null;
  }

  const proxyUrl = `${protocol}://${auth ? auth + '@' : ''}${ip}:${port}`;

  let agent;
  if (['socks4', 'socks5'].includes(protocol)) {
    agent = new SocksProxyAgent(proxyUrl);
  } else if (['http', 'https'].includes(protocol)) {
    agent = new HttpsProxyAgent(proxyUrl);
  } else {
    logger.error(`Unsupported proxy protocol: ${protocol}`);
    return null;
  }

  return { agent, url: proxyUrl, protocol };
}

function getRandomProxy(proxies) {
  if (!proxies.length) return null;
  const randomIndex = Math.floor(Math.random() * proxies.length);
  const proxy = parseProxy(proxies[randomIndex]);
  if (!proxy) {
    logger.warn(`Skipping invalid proxy: ${proxies[randomIndex]}`);
    proxies.splice(randomIndex, 1); 
    return getRandomProxy(proxies); 
  }
  return proxy;
}

function getTransactionCount() {
  return new Promise((resolve) => {
    rl.question(`${colors.cyan}Enter the number of transactions per wallet for this cycle (1-100): ${colors.reset}`, (answer) => {
      const count = parseInt(answer, 10);
      if (isNaN(count) || count < 1 || count > 100) {
        logger.error('Invalid input. Please enter a number between 1 and 100.');
        resolve(getTransactionCount());
      } else {
        logger.info(`Set ${count} transactions per wallet for this cycle.`);
        resolve(count);
      }
    });
  });
}

function readKeys() {
  const keys = [];
  const envVars = Object.keys(process.env);

  const privateKeys = envVars.filter((key) => key.startsWith('PRIVATE_KEY_'));
  for (const key of privateKeys) {
    const value = process.env[key]?.trim();
    if (value) {
      try {
        const { secretKey } = decodeSuiPrivateKey(value);
        keys.push({ type: 'privateKey', value });
      } catch (e) {
        logger.error(`Invalid private key for ${key}: ${e.message}`);
      }
    }
  }

  const mnemonics = envVars.filter((key) => key.startsWith('MNEMONIC_'));
  for (const key of mnemonics) {
    const value = process.env[key]?.trim();
    if (value) {
      try {
        const keypair = Ed25519Keypair.deriveKeypair(value);
        keys.push({ type: 'mnemonic', value, keypair });
      } catch (e) {
        logger.error(`Invalid mnemonic for ${key}: ${e.message}`);
      }
    }
  }

  if (keys.length === 0) {
    logger.error('No valid private keys or mnemonics found in .env');
    process.exit(1);
  }
  return keys;
}

function displayCountdown() {
  const nextRun = new Date();
  nextRun.setDate(nextRun.getDate() + 1);
  nextRun.setHours(0, 0, 0, 0);

  const updateCountdown = () => {
    const now = new Date();
    const timeLeft = nextRun - now;
    if (timeLeft <= 0) {
      logger.info('Starting daily transactions...');
      return true;
    }

    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
    process.stdout.write(`\r${colors.cyan}Next run in: ${hours}h ${minutes}m ${seconds}s${colors.reset}`);
    return false;
  };

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (updateCountdown()) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}

async function wrapWsuI(client, keypair) {
  logger.loading(`Wrapping wSUI for ${keypair.getPublicKey().toSuiAddress()}`);
  const txb = new TransactionBlock();
  const [splitCoin] = txb.splitCoins(txb.gas, [CONFIG.WRAP.amount]);
  txb.moveCall({
    target: CONTRACTS.WRAP_TARGET,
    arguments: [
      txb.object(CONTRACTS.SHARED_OBJECT),
      splitCoin,
      txb.pure.address(keypair.getPublicKey().toSuiAddress()),
    ],
    typeArguments: ['0x2::sui::SUI'],
  });
  try {
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: txb,
    });
    logTx('Wrap wSUI', keypair, result?.digest);
    logger.success(`Wrapped wSUI for ${keypair.getPublicKey().toSuiAddress()}`);
  } catch (e) {
    logError('Wrap', keypair, e);
    throw e;
  }
}

async function swapTokens(client, keypair, { amount, path, label, repeat }) {
  for (let i = 0; i < repeat; i++) {
    logger.loading(`${label} (Run ${i + 1}/${repeat}) for ${keypair.getPublicKey().toSuiAddress()}`);
    const txb = new TransactionBlock();
    txb.moveCall({
      target: CONTRACTS.DEX_TARGET,
      arguments: [
        txb.object(CONTRACTS.SHARED_OBJECT),
        txb.pure(BigInt(amount), 'u256'),
        txb.pure(BigInt(1), 'u256'),
        txb.pure(path, 'vector<u256>'),
        txb.pure.address(keypair.getPublicKey().toSuiAddress()),
      ],
      typeArguments: [],
    });
    try {
      const result = await client.signAndExecuteTransactionBlock({
        signer: keypair,
        transactionBlock: txb,
      });
      logTx(`${label} (Run ${i + 1})`, keypair, result?.digest);
      logger.success(`${label} (Run ${i + 1}) completed for ${keypair.getPublicKey().toSuiAddress()}`);
    } catch (e) {
      logError(label, keypair, e);
    }
    if (i < repeat - 1 && CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }
}

async function addLiquidity(client, keypair, { sharedObject, asset0, asset1, amount0, amount1, min0, min1, recipient, label }) {
  logger.loading(`${label} for ${keypair.getPublicKey().toSuiAddress()}`);
  const txb = new TransactionBlock();
  txb.moveCall({
    target: '0xa6477a6bf50e2389383b34a76d59ccfbec766ff2decefe38e1d8436ef8a9b245::dubhe_dex_system::add_liquidity',
    arguments: [
      txb.object(sharedObject),
      txb.pure(BigInt(asset0), 'u256'),
      txb.pure(BigInt(asset1), 'u256'),
      txb.pure(BigInt(amount0), 'u256'),
      txb.pure(BigInt(amount1), 'u256'),
      txb.pure(BigInt(min0), 'u256'),
      txb.pure(BigInt(min1), 'u256'),
      txb.pure.address(recipient),
    ],
    typeArguments: [],
  });
  try {
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: txb,
    });
    logTx(label, keypair, result?.digest);
    logger.success(`${label} completed for ${keypair.getPublicKey().toSuiAddress()}`);
  } catch (e) {
    logError(label, keypair, e);
  }
}

function logTx(label, keypair, digest) {
  const address = keypair.getPublicKey().toSuiAddress();
  logger.step(`${label} for ${address}`);
  if (digest) {
    logger.info(`Transaction: https://testnet.suivision.xyz/txblock/${digest}`);
  } else {
    logger.error('Failed to retrieve transaction digest!');
  }
}

function logError(label, keypair, e) {
  logger.error(`${label} failed for ${keypair.getPublicKey().toSuiAddress()}: ${e.message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replayWithKey(keyData, proxies) {
  let keypair;
  if (keyData.type === 'privateKey') {
    const { secretKey } = decodeSuiPrivateKey(keyData.value);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
  } else {
    keypair = keyData.keypair;
  }

  const address = keypair.getPublicKey().toSuiAddress();
  logger.wallet(`Processing wallet: ${address}`);

  const proxy = getRandomProxy(proxies);
  if (proxy) {
    logger.info(`Using proxy: ${proxy.url} (${proxy.protocol}) for ${address}`);
  } else {
    logger.warn(`No proxy used for ${address}`);
  }

  const clientOptions = {
    url: getFullnodeUrl('testnet'),
    transport: proxy ? { httpAgent: proxy.agent, httpsAgent: proxy.agent } : undefined,
  };
  const client = new SuiClient(clientOptions);

  if (CONFIG.WRAP.enabled) {
    try {
      await wrapWsuI(client, keypair);
    } catch {
      return;
    }
    if (CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }

  if (CONFIG.SWAP_wSUI_wDUBHE.enabled && CONFIG.SWAP_wSUI_wDUBHE.repeat > 0) {
    await swapTokens(client, keypair, {
      amount: CONFIG.SWAP_wSUI_wDUBHE.amount,
      path: CONTRACTS.PATHS.wSUI_wDUBHE,
      label: 'Swap wSUI -> wDUBHE',
      repeat: CONFIG.SWAP_wSUI_wDUBHE.repeat,
    });
    if (CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }

  if (CONFIG.SWAP_wDUBHE_wSUI.enabled && CONFIG.SWAP_wDUBHE_wSUI.repeat > 0) {
    await swapTokens(client, keypair, {
      amount: CONFIG.SWAP_wDUBHE_wSUI.amount,
      path: CONTRACTS.PATHS.wDUBHE_wSUI,
      label: 'Swap wDUBHE -> wSUI',
      repeat: CONFIG.SWAP_wDUBHE_wSUI.repeat,
    });
    if (CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }

  if (CONFIG.SWAP_wSUI_wSTARS.enabled && CONFIG.SWAP_wSUI_wSTARS.repeat > 0) {
    await swapTokens(client, keypair, {
      amount: CONFIG.SWAP_wSUI_wSTARS.amount,
      path: CONTRACTS.PATHS.wSUI_wSTARS,
      label: 'Swap wSUI -> wSTARS',
      repeat: CONFIG.SWAP_wSUI_wSTARS.repeat,
    });
    if (CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }

  if (CONFIG.SWAP_wSTARS_wSUI.enabled && CONFIG.SWAP_wSTARS_wSUI.repeat > 0) {
    await swapTokens(client, keypair, {
      amount: CONFIG.SWAP_wSTARS_wSUI.amount,
      path: CONTRACTS.PATHS.wSTARS_wSUI,
      label: 'Swap wSTARS -> wSUI',
      repeat: CONFIG.SWAP_wSTARS_wSUI.repeat,
    });
    if (CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }

  if (CONFIG.ADD_LIQUIDITY_wSUI_wSTARS.enabled) {
    await addLiquidity(client, keypair, {
      sharedObject: CONTRACTS.SHARED_OBJECT,
      asset0: CONFIG.ADD_LIQUIDITY_wSUI_wSTARS.asset0,
      asset1: CONFIG.ADD_LIQUIDITY_wSUI_wSTARS.asset1,
      amount0: CONFIG.ADD_LIQUIDITY_wSUI_wSTARS.amount0,
      amount1: CONFIG.ADD_LIQUIDITY_wSUI_wSTARS.amount1,
      min0: CONFIG.ADD_LIQUIDITY_wSUI_wSTARS.min0,
      min1: CONFIG.ADD_LIQUIDITY_wSUI_wSTARS.min1,
      recipient: address,
      label: CONFIG.ADD_LIQUIDITY_wSUI_wSTARS.label,
    });
    if (CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }

  if (CONFIG.ADD_LIQUIDITY_wSUI_wDUBHE.enabled) {
    await addLiquidity(client, keypair, {
      sharedObject: CONTRACTS.SHARED_OBJECT,
      asset0: CONFIG.ADD_LIQUIDITY_wSUI_wDUBHE.asset0,
      asset1: CONFIG.ADD_LIQUIDITY_wSUI_wDUBHE.asset1,
      amount0: CONFIG.ADD_LIQUIDITY_wSUI_wDUBHE.amount0,
      amount1: CONFIG.ADD_LIQUIDITY_wSUI_wDUBHE.amount1,
      min0: CONFIG.ADD_LIQUIDITY_wSUI_wDUBHE.min0,
      min1: CONFIG.ADD_LIQUIDITY_wSUI_wDUBHE.min1,
      recipient: address,
      label: CONFIG.ADD_LIQUIDITY_wSUI_wDUBHE.label,
    });
    if (CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }

  if (CONFIG.ADD_LIQUIDITY_wDUBHE_wSTARS.enabled) {
    await addLiquidity(client, keypair, {
      sharedObject: CONTRACTS.SHARED_OBJECT,
      asset0: CONFIG.ADD_LIQUIDITY_wDUBHE_wSTARS.asset0,
      asset1: CONFIG.ADD_LIQUIDITY_wDUBHE_wSTARS.asset1,
      amount0: CONFIG.ADD_LIQUIDITY_wDUBHE_wSTARS.amount0,
      amount1: CONFIG.ADD_LIQUIDITY_wDUBHE_wSTARS.amount1,
      min0: CONFIG.ADD_LIQUIDITY_wDUBHE_wSTARS.min0,
      min1: CONFIG.ADD_LIQUIDITY_wDUBHE_wSTARS.min1,
      recipient: address,
      label: CONFIG.ADD_LIQUIDITY_wDUBHE_wSTARS.label,
    });
    if (CONFIG.DELAY_BETWEEN_TX_MS) await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
  }
}

async function main() {
  logger.banner();
  const keys = readKeys();
  logger.info(`Loaded ${keys.length} wallet(s)`);
  const proxies = await loadProxies();

  while (true) {
    const txCount = await getTransactionCount();

    for (let i = 0; i < txCount; i++) {
      logger.info(`Starting transaction cycle ${i + 1}/${txCount}`);
      for (const keyData of keys) {
        try {
          await replayWithKey(keyData, proxies);
        } catch (e) {
          logger.error(`Error processing key: ${e.message}`);
        }
        if (CONFIG.DELAY_BETWEEN_TX_MS) {
          await sleep(CONFIG.DELAY_BETWEEN_TX_MS);
        }
      }
    }
    logger.success(`All ${txCount} transaction cycles completed`);
    await displayCountdown();
  }
}

main().catch((e) => {
  logger.error(`Fatal error: ${e.message}`);
  rl.close();
  process.exit(1);
});