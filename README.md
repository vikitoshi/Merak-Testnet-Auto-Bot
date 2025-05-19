# Merak Testnet Auto Bot

An automated bot for interacting with the Merak Testnet on Sui blockchain. This bot performs various DeFi operations including wrapping SUI, token swaps, and adding liquidity to pools.

## Features

- 🚀 Automated wrapping of SUI to wSUI
- 🔄 Token swaps between various pairs:
  - wSUI ↔ wDUBHE
  - wSUI ↔ wSTARS
- 💧 Liquidity provision to pools:
  - wSUI-wDUBHE
  - wSUI-wSTARS
  - wDUBHE-wSTARS
- ⏳ Configurable delays between transactions
- 🔄 Multiple wallet support
- 🌐 Proxy support (HTTP/SOCKS)

## Prerequisites

- Node.js v18 or higher
- Yarn or npm
- Sui Testnet wallets with funds

## Installation

1. Clone the repository:
```bash
git clone https://github.com/vikitoshi/Merak-Testnet-Auto-Bot.git
cd Merak-Testnet-Auto-Bot
```

2. Install dependencies:
```bash
npm install
```

## Configuration

1. Create a `.env` file in the project root with your wallet private keys or mnemonics:
```
PRIVATE_KEY_1=your_private_key_here
MNEMONIC_1="your mnemonic phrase here"
# Add more wallets as needed
```

2. Optional: Add proxies to `proxies.txt` (one per line):
```
http://user:pass@ip:port
socks5://user:pass@ip:port
```
## Usage

Run the bot:
```bash
node index.js
```

The bot will:
1. Ask for the number of transactions per wallet
2. Process all configured operations for each wallet
3. Show a countdown until the next daily run

## Transaction Flow

1. Wrap SUI to wSUI (if enabled)
2. Perform token swaps (if enabled):
   - wSUI → wDUBHE
   - wDUBHE → wSUI
   - wSUI → wSTARS
   - wSTARS → wSUI
3. Add liquidity to pools (if enabled):
   - wSUI-wDUBHE
   - wSUI-wSTARS
   - wDUBHE-wSTARS

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
