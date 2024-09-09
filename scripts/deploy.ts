import { AddressLike } from "ethers";
import hre from "hardhat";
import { ethers } from "hardhat";

const usdcAddress = {
    1: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

const wormholeRelayerAddress = {
    1: "0x4cb69FaE7e7Af841e44E1A1c30Af640739378bb2",
    11155111: "0x4cb69FaE7e7Af841e44E1A1c30Af640739378bb2",
    8453: "0x4cb69FaE7e7Af841e44E1A1c30Af640739378bb2",
    84532: "0x4cb69FaE7e7Af841e44E1A1c30Af640739378bb2",
} as const;

const wormholeSourceChainId = {
    1: 2,
    11155111: 10002,
    8453: 30,
    84532: 10004,
} as const;

type validChainId = 1 | 11155111 | 8453 | 84532;

async function main() {
    const network = await ethers.provider.getNetwork();
    const chainId = network.chainId;
    const chainIdIndex: validChainId = Number(chainId) as validChainId;

    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts to", network.name, "chainId", chainId, "deployer", deployer.address);

    const CrossChainEscrow = await hre.ethers.getContractFactory("CrossChainEscrow");
    const crossChainEscrow = await CrossChainEscrow.deploy(
        usdcAddress[chainIdIndex],
        wormholeRelayerAddress[chainIdIndex],
        wormholeSourceChainId[chainIdIndex],
        deployer.address,
        deployer.address
    );

    await crossChainEscrow.waitForDeployment();

    // NOTE: This should be done by the treasury which might not be the deployer for mainnet
    const usdc = await ethers.getContractAt("IERC20", usdcAddress[chainIdIndex]);
    const tx = await usdc.approve(crossChainEscrow.target, ethers.MaxUint256);

    await tx.wait();

    console.log("CrossChainEscrow deployed to:", crossChainEscrow.target);

    await sleep(20000);

    await verify(crossChainEscrow.target, [
        usdcAddress[chainIdIndex],
        wormholeRelayerAddress[chainIdIndex],
        wormholeSourceChainId[chainIdIndex],
        deployer.address,
        deployer.address,
    ]);
}

async function verify(address: AddressLike, args: any[]) {
    await sleep(1000);
    return hre.run("verify:verify", {
        address,
        constructorArguments: args,
    });
}

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
