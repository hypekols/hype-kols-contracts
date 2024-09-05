import { CrossChainEscrow } from "./../typechain-types/contracts/CrossChainEscrow";
import { WormholeRelayer } from "./../typechain-types/contracts/test/WormholeRelayer";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";

const wormholeSource = 10002;
const wormholeDest = 10003;
const wormholeDestFee = 20000;
const wormholeDestRelay = ethers.randomBytes(32);

const initialOrgBalance = ethers.parseUnits("1000000", 6);

describe("CrossChainEscrow", function () {
    async function deployFixture() {
        const network = await ethers.provider.getNetwork();
        const chainId = network.chainId;

        const USDC = await hre.ethers.getContractFactory("USDC");
        const usdc = await USDC.deploy();

        const WormholeRelayer = await hre.ethers.getContractFactory("WormholeRelayer");
        const wormholeRelayer = await WormholeRelayer.deploy();

        await wormholeRelayer.waitForDeployment();
        await wormholeRelayer.mockRelayerFee(wormholeDest, usdc.target, wormholeDestFee);
        await wormholeRelayer.mockContractRegistered(wormholeDest, wormholeDestRelay);

        const [owner, platform, treasury, org, kol] = await hre.ethers.getSigners();

        const CrossChainEscrow = await hre.ethers.getContractFactory("CrossChainEscrow");
        const crossChainEscrow = await CrossChainEscrow.deploy(
            usdc.target,
            wormholeRelayer.target,
            wormholeSource,
            platform.address,
            treasury.address
        );

        await usdc.mint(org.address, initialOrgBalance);

        return {
            sut: crossChainEscrow,
            wallets: {
                owner,
                platform,
                treasury,
                org,
                kol,
            },
            typeData: {
                domain: {
                    name: "CrossChainEscrow",
                    version: "1",
                    chainId,
                    verifyingContract: crossChainEscrow.target,
                },
                create: {
                    CreateEscrow: [
                        { name: "escrowReference", type: "bytes32" },
                        { name: "creator", type: "address" },
                        { name: "wormholeChainId", type: "uint16" },
                        { name: "beneficiary", type: "bytes32" },
                        { name: "amount", type: "uint256" },
                        { name: "serviceFee", type: "uint256" },
                        { name: "nonce", type: "uint256" },
                    ],
                },
                increase: {
                    IncreaseEscrow: [
                        { name: "escrowId", type: "uint256" },
                        { name: "amount", type: "uint256" },
                        { name: "serviceFee", type: "uint256" },
                        { name: "nonce", type: "uint256" },
                    ],
                },
                release: {
                    ReleaseEscrow: [
                        { name: "escrowId", type: "uint256" },
                        { name: "amount", type: "uint256" },
                        { name: "nonce", type: "uint256" },
                    ],
                },
                electedSigner: {
                    ElectedSigner: [
                        { name: "nonEvmSigner", type: "bytes32" },
                        { name: "electedSigner", type: "address" },
                        { name: "nonce", type: "uint256" },
                    ],
                },
                amicable: {
                    ResolveAmicably: [
                        { name: "escrowId", type: "uint256" },
                        { name: "amount", type: "uint256" },
                    ],
                },
                startDispute: {
                    StartDispute: [
                        { name: "escrowId", type: "uint256" },
                        { name: "nonce", type: "uint256" },
                    ],
                },
                resolveDispute: {
                    ResolveDispute: [
                        { name: "escrowId", type: "uint256" },
                        { name: "creatorAmount", type: "uint256" },
                        { name: "beneficiaryAmount", type: "uint256" },
                        { name: "nonce", type: "uint256" },
                    ],
                },
            },
        };
    }

    describe("Deployment", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("createEscrow", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("increaseEscrow", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("releaseEscrow", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("relayedReleaseEscrow", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("setElectedSigner", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("amicableResolution", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("startDispute", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("resolveDispute", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("setTreasury", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("setPlatformSigner", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("setPlatformResolutionTimeout", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });
});
