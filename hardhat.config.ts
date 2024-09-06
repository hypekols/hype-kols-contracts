import { vars, type HardhatUserConfig } from "hardhat/config";
import { PRIVATE_KEY } from "./env";
import "@nomicfoundation/hardhat-toolbox";

const COINMARKETCAP_API_KEY = vars.get("COINMARKETCAP_API_KEY");
const ETHERSCAN_API_KEY = vars.get("ETHERSCAN_API_KEY");
const BASESCAN_API_KEY = vars.get("BASESCAN_API_KEY");
const ALCHEMY_API_KEY = vars.get("ALCHEMY_API_KEY");

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
    ],
  },
  etherscan: {
    apiKey: {
      mainnet: `${ETHERSCAN_API_KEY}`,
      sepolia: `${ETHERSCAN_API_KEY}`,
      base: `${BASESCAN_API_KEY}`,
      baseSepolia: `${BASESCAN_API_KEY}`,
    }
  },
  gasReporter: {
    enabled: true,
    coinmarketcap: `${COINMARKETCAP_API_KEY}`,
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    ethereum: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      chainId: 1,
      accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`],
    },
    base: {
      url: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      chainId: 8453,
      accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`],
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      chainId: 11155111,
      accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`],
    },
    baseSepolia: {
      url: `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      chainId: 84532,
      accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`],
    },
  },
};

export default config;
