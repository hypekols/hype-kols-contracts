import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import { AddressLike, BigNumberish, BytesLike, Signature } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setPredictableTimestamp } from "./helpers";

const wormholeSource = 10002;
const wormholeDest = 10003;
const wormholeDestFee = 20000;
const wormholeDestRelay = ethers.randomBytes(32);

const threeDays = BigInt(60 * 60 * 24 * 3);

const initialOrgBalance = ethers.parseUnits("1000000", 6);

describe("CrossChainEscrow", function () {
    type Fixture = Awaited<ReturnType<typeof deployFixture>>;

    // ############################ COMMON FIXTURES ############################

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

        const domains = {
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
        };

        const types = {
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
        };

        async function signCreateEscrow(
            signer: HardhatEthersSigner,
            escrowReference: BytesLike,
            creator: AddressLike,
            wormholeChainId: number,
            beneficiary: BytesLike,
            amount: bigint,
            serviceFee: bigint,
            nonce: bigint
        ) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.create, {
                    escrowReference,
                    creator,
                    wormholeChainId,
                    beneficiary,
                    amount,
                    serviceFee,
                    nonce,
                })
            );
        }

        async function signIncreaseEscrow(
            signer: HardhatEthersSigner,
            escrowId: bigint,
            amount: bigint,
            serviceFee: bigint,
            nonce: bigint
        ) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.increase, {
                    escrowId,
                    amount,
                    serviceFee,
                    nonce,
                })
            );
        }

        async function signReleaseEscrow(signer: HardhatEthersSigner, escrowId: bigint, amount: bigint, nonce: bigint) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.release, {
                    escrowId,
                    amount,
                    nonce,
                })
            );
        }

        async function signElectedSigner(
            signer: HardhatEthersSigner,
            nonEvmSigner: BytesLike,
            electedSigner: string,
            nonce: bigint
        ) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.electedSigner, {
                    nonEvmSigner,
                    electedSigner,
                    nonce,
                })
            );
        }

        async function signAmicableResolution(signer: HardhatEthersSigner, escrowId: bigint, amount: bigint) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.amicable, {
                    escrowId,
                    amount,
                })
            );
        }

        async function signStartDispute(signer: HardhatEthersSigner, escrowId: bigint, nonce: bigint) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.startDispute, {
                    escrowId,
                    nonce,
                })
            );
        }

        async function signResolveDispute(
            signer: HardhatEthersSigner,
            escrowId: bigint,
            creatorAmount: bigint,
            beneficiaryAmount: bigint,
            nonce: bigint
        ) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.resolveDispute, {
                    escrowId,
                    creatorAmount,
                    beneficiaryAmount,
                    nonce,
                })
            );
        }

        async function signPermit(
            signer: HardhatEthersSigner,
            owner: string,
            spender: string,
            value: BigNumberish,
            nonce: bigint,
            deadline: bigint
        ) {
            return signer.signTypedData(domains.usdc, types.permit, {
                owner,
                spender,
                value,
                nonce,
                deadline,
            });
        }

        return {
            sut: crossChainEscrow,
            usdc,
            wormholeRelayer,
            domains,
            types,
            signTypeData: {
                create: signCreateEscrow,
                increase: signIncreaseEscrow,
                release: signReleaseEscrow,
                electedSigner: signElectedSigner,
                amicable: signAmicableResolution,
                startDispute: signStartDispute,
                resolveDispute: signResolveDispute,
                permit: signPermit,
            },
            nonces: {
                org: () => usdc.nonces(org.address),
                platform: () => crossChainEscrow.nonces(platform.address),
                owner: () => crossChainEscrow.nonces(owner.address),
            },
            wallets: {
                owner,
                platform,
                treasury,
                org,
                kol,
            },
        };
    }

    async function deployDirectEscrowFixture() {
        const fixture = await loadFixture(deployFixture);

        const wormholeChainId = wormholeSource;
        const beneficiary = ethers.zeroPadBytes(fixture.wallets.kol.address, 32);

        return createEscrow(fixture, wormholeChainId, beneficiary);
    }

    async function deployBridgedEscrowFixture() {
        const fixture = await loadFixture(deployFixture);

        const wormholeChainId = wormholeDest;
        const beneficiary = ethers.randomBytes(32);

        return createEscrow(fixture, wormholeChainId, beneficiary);
    }

    // ############################ HELPERS ############################

    async function createEscrow(fixture: Fixture, wormholeChainId: number, beneficiary: BytesLike) {
        const { sut, signTypeData, wallets, nonces } = fixture;

        const escrowReference = ethers.randomBytes(32);
        const creator = wallets.org.address;
        const amount = ethers.parseUnits("100", 6);
        const serviceFee = ethers.parseUnits("1", 6);

        const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

        const platformSignature = await signTypeData.create(
            wallets.platform,
            escrowReference,
            creator,
            wormholeChainId,
            beneficiary,
            amount,
            serviceFee,
            await nonces.owner()
        );

        const amountsStruct = {
            escrow: amount,
            serviceFee,
        };

        const id = await sut.nextEscrowId();

        await sut.createEscrow(
            platformSignature,
            escrowReference,
            creator,
            wormholeChainId,
            beneficiary,
            amountsStruct,
            permit,
            deadline
        );

        return {
            ...fixture,
            escrow: {
                id,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
            },
        };
    }

    async function getPermit(fixture: Fixture, amount: bigint) {
        const { sut, wallets, signTypeData, nonces } = fixture;

        const deadline = BigInt(await time.latest()) + 60n;
        return {
            permit: await signTypeData.permit(
                wallets.org,
                wallets.org.address,
                sut.target.toString(),
                amount,
                await nonces.org(),
                deadline
            ),
            deadline,
        };
    }

    // ############################ TESTS ############################

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
            const { sut, domains } = await loadFixture(deployFixture);

            const typeHash = ethers.keccak256(
                ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
            );

            const expected = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
                    [
                        typeHash,
                        ethers.keccak256(ethers.toUtf8Bytes(domains.crossChainEscrow.name)),
                        ethers.keccak256(ethers.toUtf8Bytes(domains.crossChainEscrow.version)),
                        domains.crossChainEscrow.chainId,
                        domains.crossChainEscrow.verifyingContract,
                    ]
                )
            );

            expect(await sut.DOMAIN_SEPARATOR()).to.be.equal(expected);
        });
    });

    describe("createEscrow", function () {
        const escrowReference = ethers.randomBytes(32);
        const amount = ethers.parseUnits("100", 6);
        const serviceFee = ethers.parseUnits("1", 6);

        it("Should revert if the signature is invalid", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const creator = wallets.org.address;
            const wormholeChainId = wormholeSource;
            const beneficiary = ethers.zeroPadBytes(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.org, // invalid signer
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.createEscrow(
                    platformSignature,
                    escrowReference,
                    creator,
                    wormholeChainId,
                    beneficiary,
                    amountsStruct,
                    permit,
                    deadline
                )
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert if the escrow is bridged and no contract is registered by wormhole", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const creator = wallets.org.address;
            const wormholeChainId = 999; // invalid chain id
            const beneficiary = ethers.zeroPadBytes(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.createEscrow(
                    platformSignature,
                    escrowReference,
                    creator,
                    wormholeChainId,
                    beneficiary,
                    amountsStruct,
                    permit,
                    deadline
                )
            ).to.be.revertedWithCustomError(sut, "WormholeNotRegistered");
        });

        it("Should revert if the permit has an invalid signer", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, usdc, signTypeData, wallets, nonces } = fixture;

            const creator = wallets.org.address;
            const wormholeChainId = wormholeSource;
            const beneficiary = ethers.zeroPadBytes(fixture.wallets.kol.address, 32);

            const deadline = BigInt(await time.latest()) + 60n;
            const permit = await signTypeData.permit(
                wallets.platform, // invalid signer
                wallets.org.address,
                sut.target.toString(),
                amount,
                await nonces.org(),
                deadline
            );

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.createEscrow(
                    platformSignature,
                    escrowReference,
                    creator,
                    wormholeChainId,
                    beneficiary,
                    amountsStruct,
                    permit,
                    deadline
                )
            ).to.be.revertedWithCustomError(usdc, "ERC2612InvalidSigner");
        });

        it("Should revert if the permit has an invalid amount", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, usdc, signTypeData, wallets, nonces } = fixture;

            const creator = wallets.org.address;
            const wormholeChainId = wormholeSource;
            const beneficiary = ethers.zeroPadBytes(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount); // missing service fee

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.createEscrow(
                    platformSignature,
                    escrowReference,
                    creator,
                    wormholeChainId,
                    beneficiary,
                    amountsStruct,
                    permit,
                    deadline
                )
            ).to.be.revertedWithCustomError(usdc, "ERC2612InvalidSigner");
        });

        it("Should create a direct escrow", async function () {
            const { sut, escrow } = await loadFixture(deployDirectEscrowFixture);

            const escrowData = await sut.getEscrow(escrow.id);

            expect(escrowData.wormholeChainId).to.be.equal(wormholeSource);

            expect(escrowData.amount).to.be.equal(escrow.amount);
            expect(escrowData.creator).to.be.equal(escrow.creator);
            expect(escrowData.allowPlatformResolutionTimestamp).to.be.equal(0);
            expect(escrowData.beneficiary).to.be.equal(escrow.beneficiary);
        });

        it("Should create a bridged escrow", async function () {
            const { sut, escrow } = await loadFixture(deployBridgedEscrowFixture);

            const escrowData = await sut.getEscrow(escrow.id);

            expect(escrowData.wormholeChainId).to.be.equal(wormholeDest);

            expect(escrowData.amount).to.be.equal(escrow.amount);
            expect(escrowData.creator).to.be.equal(escrow.creator);
            expect(escrowData.allowPlatformResolutionTimestamp).to.be.equal(0);
            expect(escrowData.beneficiary).to.equal(ethers.hexlify(escrow.beneficiary));
        });

        it("Should custody the USDC", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, usdc, signTypeData, wallets, nonces } = fixture;

            const creator = wallets.org.address;
            const wormholeChainId = wormholeSource;
            const beneficiary = ethers.zeroPadBytes(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            const sutBalanceBefore = await usdc.balanceOf(sut.target);
            const orgBalanceBefore = await usdc.balanceOf(wallets.org.address);
            const treasuryBalanceBefore = await usdc.balanceOf(wallets.treasury.address);

            await sut.createEscrow(
                platformSignature,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amountsStruct,
                permit,
                deadline
            );

            const sutBalanceAfter = await usdc.balanceOf(sut.target);
            const orgBalanceAfter = await usdc.balanceOf(wallets.org.address);
            const treasuryBalanceAfter = await usdc.balanceOf(wallets.treasury.address);

            expect(sutBalanceAfter).to.be.equal(sutBalanceBefore + amount);
            expect(orgBalanceAfter).to.be.equal(orgBalanceBefore - amount - serviceFee);
            expect(treasuryBalanceAfter).to.be.equal(treasuryBalanceBefore + serviceFee);
        });

        it("Should emit the EscrowCreated event", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const creator = wallets.org.address;
            const wormholeChainId = wormholeSource;
            const beneficiary = ethers.zeroPadBytes(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            const id = await sut.nextEscrowId();

            await expect(
                sut.createEscrow(
                    platformSignature,
                    escrowReference,
                    creator,
                    wormholeChainId,
                    beneficiary,
                    amountsStruct,
                    permit,
                    deadline
                )
            )
                .to.emit(sut, "EscrowCreated")
                .withArgs(id, escrowReference, creator, wormholeChainId, beneficiary, amount, serviceFee);
        });

        it("Should increment the nextEscrowId", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const creator = wallets.org.address;
            const wormholeChainId = wormholeSource;
            const beneficiary = ethers.zeroPadBytes(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            const id = await sut.nextEscrowId();

            await sut.createEscrow(
                platformSignature,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amountsStruct,
                permit,
                deadline
            );

            expect(await sut.nextEscrowId()).to.be.equal(id + 1n);
        });
    });

    describe("increaseEscrow", function () {
        const amount = ethers.parseUnits("150", 6);
        const serviceFee = ethers.parseUnits("3", 6);

        it("Should revert if the escrow does not exist", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, signTypeData, wallets, nonces, escrow } = fixture;

            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.increase(
                wallets.platform,
                escrow.id + 1n, // invalid escrow id
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.increaseEscrow(
                    platformSignature,
                    escrow.id + 1n, // invalid escrow id
                    amountsStruct,
                    permit,
                    deadline
                )
            ).to.be.revertedWithCustomError(sut, "EscrowNotFound");
        });

        it("Should revert if the signature is invalid", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, signTypeData, wallets, nonces, escrow } = fixture;

            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.increase(
                wallets.org, // invalid signer
                escrow.id,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert if the permit has an invalid signer", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, usdc, signTypeData, wallets, nonces, escrow } = fixture;

            const deadline = BigInt(await time.latest()) + 60n;
            const permit = await signTypeData.permit(
                wallets.platform, // invalid signer
                wallets.org.address,
                sut.target.toString(),
                amount,
                await nonces.org(),
                deadline
            );

            const platformSignature = await signTypeData.increase(
                wallets.platform,
                escrow.id,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline)
            ).to.be.revertedWithCustomError(usdc, "ERC2612InvalidSigner");
        });

        it("Should revert if the permit has an invalid amount", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, usdc, signTypeData, wallets, nonces, escrow } = fixture;

            const { permit, deadline } = await getPermit(fixture, amount); // missing service fee

            const platformSignature = await signTypeData.increase(
                wallets.platform,
                escrow.id,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline)
            ).to.be.revertedWithCustomError(usdc, "ERC2612InvalidSigner");
        });

        it("Should increment the escrow amount", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, signTypeData, wallets, nonces, escrow } = fixture;

            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.increase(
                wallets.platform,
                escrow.id,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            const escrowDataBefore = await sut.getEscrow(escrow.id);

            await sut.increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline);

            const escrowDataAfter = await sut.getEscrow(escrow.id);

            expect(escrowDataAfter.amount).to.be.equal(escrowDataBefore.amount + amount);
        });

        it("Should custody the USDC", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, usdc, signTypeData, wallets, nonces, escrow } = fixture;

            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.increase(
                wallets.platform,
                escrow.id,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            const sutBalanceBefore = await usdc.balanceOf(sut.target);
            const orgBalanceBefore = await usdc.balanceOf(wallets.org.address);
            const treasuryBalanceBefore = await usdc.balanceOf(wallets.treasury.address);

            await sut.increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline);

            const sutBalanceAfter = await usdc.balanceOf(sut.target);
            const orgBalanceAfter = await usdc.balanceOf(wallets.org.address);
            const treasuryBalanceAfter = await usdc.balanceOf(wallets.treasury.address);

            expect(sutBalanceAfter).to.be.equal(sutBalanceBefore + amount);
            expect(orgBalanceAfter).to.be.equal(orgBalanceBefore - amount - serviceFee);
            expect(treasuryBalanceAfter).to.be.equal(treasuryBalanceBefore + serviceFee);
        });

        it("Should emit the EscrowIncreased event", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, signTypeData, wallets, nonces, escrow } = fixture;

            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.increase(
                wallets.platform,
                escrow.id,
                amount,
                serviceFee,
                await nonces.owner()
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(sut.increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline))
                .to.emit(sut, "EscrowIncreased")
                .withArgs(escrow.id, amount, serviceFee);
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
        const nonEvmSigner = ethers.hexlify(ethers.randomBytes(32));

        it("Should revert if the signature is invalid", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const platformSignature = await signTypeData.electedSigner(
                wallets.org, // invalid signer
                nonEvmSigner,
                wallets.kol.address,
                await nonces.owner()
            );

            await expect(
                sut.setElectedSigner(platformSignature, nonEvmSigner, wallets.kol.address)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should set the elected signer", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const platformSignature = await signTypeData.electedSigner(
                wallets.platform,
                nonEvmSigner,
                wallets.kol.address,
                await nonces.owner()
            );

            await sut.setElectedSigner(platformSignature, nonEvmSigner, wallets.kol.address);
            expect(await sut.getElectedSigner(nonEvmSigner)).to.be.equal(wallets.kol.address);
        });

        it("Should emit the SignerElected event", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const platformSignature = await signTypeData.electedSigner(
                wallets.platform,
                nonEvmSigner,
                wallets.kol.address,
                await nonces.owner()
            );

            await expect(sut.setElectedSigner(platformSignature, nonEvmSigner, wallets.kol.address))
                .to.emit(sut, "SignerElected")
                .withArgs(nonEvmSigner, wallets.kol.address);
        });
    });

    describe("amicableResolution", function () {
        it("Should ", async function () {
            const { sut } = await loadFixture(deployFixture);
        });
    });

    describe("startDispute", function () {
        it("Should revert if the escrow does not exist", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const missingEscrowId = escrow.id + 1n;

            const signature = await signTypeData.startDispute(wallets.platform, missingEscrowId, await nonces.owner());

            await expect(sut.startDispute(signature, missingEscrowId)).to.be.revertedWithCustomError(
                sut,
                "EscrowNotFound"
            );
        });

        it("Should revert if the signature is invalid", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const signature = await signTypeData.startDispute(wallets.platform, escrow.id + 1n, await nonces.owner());

            await expect(sut.startDispute(signature, escrow.id)).to.be.revertedWithCustomError(
                sut,
                "UnauthorizedSender"
            );
        });

        it("Should revert if the resolution process has already started", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            let signature = await signTypeData.startDispute(wallets.platform, escrow.id, await nonces.owner());
            await sut.startDispute(signature, escrow.id);

            signature = await signTypeData.startDispute(wallets.platform, escrow.id, await nonces.owner());
            await expect(sut.startDispute(signature, escrow.id)).to.be.revertedWithCustomError(sut, "AlreadyStarted");
        });

        it("Should set the allowPlatformResolutionTimestamp value to a timestamp 3 days in the future", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const signature = await signTypeData.startDispute(wallets.platform, escrow.id, await nonces.owner());

            const nextTimestamp = await setPredictableTimestamp();
            await sut.startDispute(signature, escrow.id);

            const escrowData = await sut.getEscrow(escrow.id);
            expect(escrowData.allowPlatformResolutionTimestamp).to.be.equal(nextTimestamp + threeDays);
        });

        it("Should emit the DisputeStarted event", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const signature = await signTypeData.startDispute(wallets.platform, escrow.id, await nonces.owner());

            const nextTimestamp = await setPredictableTimestamp();
            await expect(sut.startDispute(signature, escrow.id))
                .to.emit(sut, "DisputeStarted")
                .withArgs(escrow.id, nextTimestamp + threeDays);
        });
    });

    describe("resolveDispute", function () {
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
