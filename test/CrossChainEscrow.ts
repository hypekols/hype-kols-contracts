import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import { BigNumberish, Signature } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const wormholeSource = 10002;
const wormholeDest = 10003;
const wormholeDestFee = 20000;
const wormholeDestRelay = ethers.randomBytes(32);

const threeDays = BigInt(60 * 60 * 24 * 3);

const initialOrgBalance = ethers.parseUnits("1000000", 6);

describe("CrossChainEscrow", function () {
    type Fixture = Awaited<ReturnType<typeof deployFixture>>;

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
            usdc,
            wormholeRelayer,
            wallets: {
                owner,
                platform,
                treasury,
                org,
                kol,
            },
            typeData: {
                domain: {
                    crossChainEscrow: {
                        name: "CrossChainEscrow",
                        version: "1",
                        chainId,
                        verifyingContract: crossChainEscrow.target as string,
                    },
                    usdc: {
                        name: "USDC",
                        version: "1",
                        chainId,
                        verifyingContract: usdc.target as string,
                    },
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
                permit: {
                    Permit: [
                        { name: "owner", type: "address" },
                        { name: "spender", type: "address" },
                        { name: "value", type: "uint256" },
                        { name: "nonce", type: "uint256" },
                        { name: "deadline", type: "uint256" },
                    ],
                },
            },
        };
    }

    async function addEscrow(fixture: Fixture, bridged: boolean) {
        const escrowReference = ethers.randomBytes(32);
        const beneficiary = bridged ? ethers.randomBytes(32) : ethers.zeroPadBytes(fixture.wallets.kol.address, 32);
        const amount = ethers.parseUnits("100", 6);
        const serviceFee = ethers.parseUnits("1", 6);
        const nonce = 0;

        const deadline = (await time.latest()) + 60 * 60;
        const permit = await fixture.wallets.org.signTypedData(fixture.typeData.domain.usdc, fixture.typeData.permit, {
            owner: fixture.wallets.org.address,
            spender: fixture.sut.target,
            value: amount + serviceFee,
            nonce,
            deadline,
        });

        const platformSignature = Signature.from(
            await fixture.wallets.platform.signTypedData(
                fixture.typeData.domain.crossChainEscrow,
                fixture.typeData.create,
                {
                    escrowReference,
                    creator: fixture.wallets.org.address,
                    wormholeChainId: bridged ? wormholeDest : wormholeSource,
                    beneficiary,
                    amount,
                    serviceFee,
                    nonce,
                }
            )
        );

        const amountsStruct = {
            escrow: amount,
            serviceFee,
        };

        await fixture.sut.createEscrow(
            platformSignature,
            escrowReference,
            fixture.wallets.org.address,
            bridged ? wormholeDest : wormholeSource,
            beneficiary,
            amountsStruct,
            permit,
            deadline
        );

        return {
            ...fixture,
            escrow: {
                escrowReference,
                beneficiary,
                amount,
                serviceFee,
                nonce,
                deadline,
            },
        };
    }

    async function setPredictableTimestamp() {
        const now = BigInt(await time.latest());
        const next = now + 1n;
        await time.setNextBlockTimestamp(next);

        return next;
    }

    describe("Deployment", function () {
        it("Should set the usdc address", async function () {
            const { sut, usdc } = await loadFixture(deployFixture);

            expect(await sut.USDC()).to.be.equal(usdc.target);
        });

        it("Should set the wormhole relayer address", async function () {
            const { sut, wormholeRelayer } = await loadFixture(deployFixture);

            expect(await sut.WORMHOLE()).to.be.equal(wormholeRelayer.target);
        });

        it("Should set the wormhole chain id", async function () {
            const { sut } = await loadFixture(deployFixture);

            expect(await sut.WORMHOLE_CHAIN_ID()).to.be.equal(wormholeSource);
        });

        it("Should set the treasury", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            expect(await sut.treasury()).to.be.equal(wallets.treasury.address);
        });

        it("Should set the platform signer", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            expect(await sut.platformSigner()).to.be.equal(wallets.platform.address);
        });

        it("Should set the platform resolution timeout to 3 days", async function () {
            const { sut } = await loadFixture(deployFixture);

            expect(await sut.platformResolutionTimeout()).to.be.equal(threeDays);
        });

        it("Should set the owner", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            expect(await sut.owner()).to.be.equal(wallets.owner.address);
        });

        it("Should set the domain separator", async function () {
            const { sut, typeData } = await loadFixture(deployFixture);

            const typeHash = ethers.keccak256(
                ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
            );

            const expected = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
                    [
                        typeHash,
                        ethers.keccak256(ethers.toUtf8Bytes(typeData.domain.crossChainEscrow.name)),
                        ethers.keccak256(ethers.toUtf8Bytes(typeData.domain.crossChainEscrow.version)),
                        typeData.domain.crossChainEscrow.chainId,
                        typeData.domain.crossChainEscrow.verifyingContract,
                    ]
                )
            );

            expect(await sut.DOMAIN_SEPARATOR()).to.be.equal(expected);
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
        async function signStartDispute(fixture: Fixture, signer: HardhatEthersSigner, escrowId: BigNumberish) {
            return Signature.from(
                await signer.signTypedData(fixture.typeData.domain.crossChainEscrow, fixture.typeData.startDispute, {
                    escrowId,
                    nonce: await fixture.sut.nonces(fixture.wallets.owner.address),
                })
            );
        }

        it("Should revert if the escrow does not exist", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, wallets } = fixture;

            const escrowId = 0;
            const signature = await signStartDispute(fixture, wallets.platform, escrowId);

            await expect(sut.startDispute(signature, escrowId)).to.be.revertedWithCustomError(sut, "EscrowNotFound");
        });

        it("Should revert if the signature is invalid", async function () {
            const fixture = await addEscrow(await loadFixture(deployFixture), false);
            const { sut, wallets } = fixture;

            const escrowId = 0;
            const signature = await signStartDispute(fixture, wallets.org, escrowId);

            await expect(sut.startDispute(signature, escrowId)).to.be.revertedWithCustomError(
                sut,
                "UnauthorizedSender"
            );
        });

        it("Should revert if the resolution process has already started", async function () {
            const fixture = await addEscrow(await loadFixture(deployFixture), false);
            const { sut, wallets } = fixture;

            const escrowId = 0;

            let signature = await signStartDispute(fixture, wallets.platform, escrowId);
            await sut.startDispute(signature, escrowId);

            signature = await signStartDispute(fixture, wallets.platform, escrowId);
            await expect(sut.startDispute(signature, escrowId)).to.be.revertedWithCustomError(sut, "AlreadyStarted");
        });

        it("Should set the allowPlatformResolutionTimestamp value to a timestamp 3 days in the future", async function () {
            const fixture = await addEscrow(await loadFixture(deployFixture), false);
            const { sut, wallets } = fixture;

            const nextTimestamp = await setPredictableTimestamp();

            const escrowId = 0;
            const signature = await signStartDispute(fixture, wallets.platform, escrowId);

            await sut.startDispute(signature, escrowId);

            const escrow = await sut.getEscrow(escrowId);
            expect(escrow.allowPlatformResolutionTimestamp).to.be.equal(nextTimestamp + threeDays);
        });

        it("Should emit the DisputeStarted event", async function () {
            const fixture = await addEscrow(await loadFixture(deployFixture), false);
            const { sut, wallets } = fixture;

            const nextTimestamp = await setPredictableTimestamp();

            const escrowId = 0;
            const signature = await signStartDispute(fixture, wallets.platform, escrowId);

            await expect(sut.startDispute(signature, escrowId))
                .to.emit(sut, "DisputeStarted")
                .withArgs(escrowId, nextTimestamp + threeDays);
        });
    });

    describe("resolveDispute", function () {
        async function startDispute(fixture: Fixture) {
            const escrowId = 0;
            const signature = Signature.from(
                await fixture.wallets.platform.signTypedData(
                    fixture.typeData.domain.crossChainEscrow,
                    fixture.typeData.startDispute,
                    {
                        escrowId,
                        nonce: await fixture.sut.nonces(fixture.wallets.owner.address),
                    }
                )
            );

            await fixture.sut.startDispute(signature, escrowId);

            return fixture;
        }

        async function signResolveDispute(
            fixture: Fixture,
            signer: HardhatEthersSigner,
            escrowId: BigNumberish,
            creatorAmount: BigNumberish,
            beneficiaryAmount: BigNumberish
        ) {
            return Signature.from(
                await signer.signTypedData(fixture.typeData.domain.crossChainEscrow, fixture.typeData.resolveDispute, {
                    escrowId,
                    creatorAmount,
                    beneficiaryAmount,
                    nonce: await fixture.sut.nonces(fixture.wallets.owner.address),
                })
            );
        }

        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("setTreasury", function () {
        it("Should set the treasury", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            const expected = wallets.kol.address;
            await sut.setTreasury(expected);

            expect(await sut.treasury()).to.be.equal(expected);
        });

        it("should only be callable by the owner", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            await expect(sut.connect(wallets.kol).setTreasury(wallets.kol.address)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });
    });

    describe("setPlatformSigner", function () {
        it("Should set the platformSigner", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            const expected = wallets.kol.address;
            await sut.setPlatformSigner(expected);

            expect(await sut.platformSigner()).to.be.equal(expected);
        });

        it("should only be callable by the owner", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            await expect(sut.connect(wallets.kol).setPlatformSigner(wallets.kol.address)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });
    });

    describe("setPlatformResolutionTimeout", function () {
        it("Should set the platformResolutionTimeout", async function () {
            const { sut } = await loadFixture(deployFixture);

            const expected = 60 * 60 * 24 * 7;
            await sut.setPlatformResolutionTimeout(expected);

            expect(await sut.platformResolutionTimeout()).to.be.equal(expected);
        });

        it("should only be callable by the owner", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            await expect(sut.connect(wallets.kol).setPlatformResolutionTimeout(0)).to.be.revertedWithCustomError(
                sut,
                "OwnableUnauthorizedAccount"
            );
        });
    });
});
