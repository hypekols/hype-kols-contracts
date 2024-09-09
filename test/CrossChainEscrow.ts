import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import { AddressLike, BigNumberish, BytesLike, Signature } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setPredictableTimestamp } from "./helpers";

const nativeDrop = 0;

const wormholeSource = 10002;
const wormholeDest = 10003;
const wormholeDestFee = 20000n;
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
        await wormholeRelayer.mockContractRegistered(wormholeDest, wormholeDestRelay);

        const [owner, platform, treasury, org, kol, relayer, attacker] = await hre.ethers.getSigners();

        const CrossChainEscrow = await hre.ethers.getContractFactory("CrossChainEscrow");
        const crossChainEscrow = await CrossChainEscrow.deploy(
            usdc.target,
            wormholeRelayer.target,
            wormholeSource,
            platform.address,
            treasury.address
        );

        await usdc.mint(org.address, initialOrgBalance);
        await usdc.connect(treasury).approve(crossChainEscrow.target, ethers.MaxUint256);

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
            updateBeneficiary: {
                UpdateBeneficiary: [
                    { name: "escrowId", type: "uint256" },
                    { name: "wormholeChainId", type: "uint16" },
                    { name: "beneficiary", type: "bytes32" },
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
            electEvmAddress: {
                ElectEvmAddress: [
                    { name: "nonEvmAddress", type: "bytes32" },
                    { name: "electedAddress", type: "address" },
                    { name: "nonce", type: "uint256" },
                ],
            },
            amicable: {
                ResolveAmicably: [
                    { name: "escrowId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "nonce", type: "uint256" },
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

        async function signUpdateBeneficiary(
            signer: HardhatEthersSigner,
            escrowId: bigint,
            wormholeChainId: number,
            beneficiary: BytesLike,
            nonce: bigint
        ) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.updateBeneficiary, {
                    escrowId,
                    wormholeChainId,
                    beneficiary,
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

        async function signElectEvmAddress(
            signer: HardhatEthersSigner,
            nonEvmAddress: BytesLike,
            electedAddress: string,
            nonce: bigint
        ) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.electEvmAddress, {
                    nonEvmAddress,
                    electedAddress,
                    nonce,
                })
            );
        }

        async function signAmicableResolution(
            signer: HardhatEthersSigner,
            escrowId: bigint,
            amount: bigint,
            nonce: bigint
        ) {
            return Signature.from(
                await signer.signTypedData(domains.crossChainEscrow, types.amicable, {
                    escrowId,
                    amount,
                    nonce,
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
                updateBeneficiary: signUpdateBeneficiary,
                release: signReleaseEscrow,
                electEvmAddress: signElectEvmAddress,
                amicable: signAmicableResolution,
                startDispute: signStartDispute,
                resolveDispute: signResolveDispute,
                permit: signPermit,
            },
            nonces: {
                escrow: async (escrowId: bigint) => await crossChainEscrow.getEscrowNonce(escrowId),
                address: async (address: AddressLike) => await crossChainEscrow.getAddressNonce(address),
                permit: async (address: AddressLike) => await usdc.nonces(address),
            },
            wallets: {
                owner,
                platform,
                treasury,
                org,
                kol,
                relayer,
                attacker,
            },
        };
    }

    async function deployDirectEscrowFixture() {
        const fixture = await loadFixture(deployFixture);

        const wormholeChainId = wormholeSource;
        const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);

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
            await nonces.address(creator)
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

    async function startDispute(fixture: Fixture, escrowId: bigint) {
        const { sut, signTypeData, wallets, nonces } = fixture;

        const platformSignature = await signTypeData.startDispute(
            wallets.platform,
            escrowId,
            await nonces.escrow(escrowId)
        );

        await sut.startDispute(platformSignature, escrowId);

        return fixture;
    }

    async function setElectedEvmAddress(
        fixture: Fixture,
        nonEvmAddress: BytesLike,
        electedWallet: HardhatEthersSigner
    ) {
        const { sut, signTypeData, wallets, nonces } = fixture;

        const platformSignature = await signTypeData.electEvmAddress(
            wallets.platform,
            nonEvmAddress,
            electedWallet.address,
            await nonces.address(electedWallet.address)
        );

        await sut.setElectedEvmAddress(platformSignature, nonEvmAddress, electedWallet.address);

        return fixture;
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
                await nonces.permit(wallets.org.address),
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
            const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.org, // invalid signer
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.address(creator)
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

        it("Should revert on signature replay", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const creator = wallets.org.address;
            const wormholeChainId = wormholeSource;
            const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.address(creator)
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await sut
                .connect(wallets.relayer)
                .createEscrow(
                    platformSignature,
                    escrowReference,
                    creator,
                    wormholeChainId,
                    beneficiary,
                    amountsStruct,
                    permit,
                    deadline
                );

            await expect(
                sut
                    .connect(wallets.attacker)
                    .createEscrow(
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
            const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.address(creator)
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
            const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);

            const deadline = BigInt(await time.latest()) + 60n;
            const permit = await signTypeData.permit(
                wallets.platform, // invalid signer
                wallets.org.address,
                sut.target.toString(),
                amount,
                await nonces.permit(wallets.org.address),
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
                await nonces.address(creator)
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
            const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount); // missing service fee

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.address(creator)
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
            const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.address(creator)
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
            const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.address(creator)
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
            const beneficiary = ethers.zeroPadValue(fixture.wallets.kol.address, 32);
            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.create(
                wallets.platform,
                escrowReference,
                creator,
                wormholeChainId,
                beneficiary,
                amount,
                serviceFee,
                await nonces.address(creator)
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
                await nonces.escrow(escrow.id)
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
                await nonces.escrow(escrow.id)
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await expect(
                sut.increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert on signature replay", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, signTypeData, wallets, nonces, escrow } = fixture;

            const { permit, deadline } = await getPermit(fixture, amount + serviceFee);

            const platformSignature = await signTypeData.increase(
                wallets.platform,
                escrow.id,
                amount,
                serviceFee,
                await nonces.escrow(escrow.id)
            );

            const amountsStruct = {
                escrow: amount,
                serviceFee,
            };

            await sut
                .connect(wallets.relayer)
                .increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline);

            await expect(
                sut
                    .connect(wallets.attacker)
                    .increaseEscrow(platformSignature, escrow.id, amountsStruct, permit, deadline)
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
                await nonces.permit(wallets.org.address),
                deadline
            );

            const platformSignature = await signTypeData.increase(
                wallets.platform,
                escrow.id,
                amount,
                serviceFee,
                await nonces.escrow(escrow.id)
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
                await nonces.escrow(escrow.id)
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
                await nonces.escrow(escrow.id)
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
                await nonces.escrow(escrow.id)
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
                await nonces.escrow(escrow.id)
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

    describe("updateBeneficiary", function () {
        it("Should revert if the escrow does not exist", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            await expect(
                sut.connect(wallets.kol).updateBeneficiary(escrow.id + 1n, escrow.wormholeChainId, escrow.beneficiary)
            ).to.be.revertedWithCustomError(sut, "EscrowNotFound");
        });

        it("Should revert if the caller is not the beneficiary", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            await expect(
                sut.connect(wallets.org).updateBeneficiary(escrow.id, escrow.wormholeChainId, escrow.beneficiary)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert if the beneficiary address is not evm", async function () {
            const fixture = await loadFixture(deployBridgedEscrowFixture);
            const { sut, escrow } = fixture;

            await expect(
                sut.updateBeneficiary(escrow.id, escrow.wormholeChainId, escrow.beneficiary)
            ).to.be.revertedWithCustomError(sut, "InvalidAddress");
        });

        it("Should revert if the chain is not supported", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            await expect(
                sut.connect(wallets.kol).updateBeneficiary(escrow.id, 999, escrow.beneficiary)
            ).to.be.revertedWithCustomError(sut, "WormholeNotRegistered");
        });

        it("Should set the beneficiary and wormhole chain id", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            const wormholeChainId = wormholeDest;
            const beneficiary = ethers.hexlify(ethers.randomBytes(32));

            await sut.connect(wallets.kol).updateBeneficiary(escrow.id, wormholeChainId, beneficiary);

            const escrowData = await sut.getEscrow(escrow.id);

            expect(escrowData.beneficiary).to.be.equal(beneficiary);
            expect(escrowData.wormholeChainId).to.be.equal(wormholeChainId);
        });

        it("Should set the beneficiary and wormhole chain id with an elected wallet", async function () {
            const fixture = await loadFixture(deployBridgedEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets } = await setElectedEvmAddress(
                fixture,
                fixture.escrow.beneficiary,
                fixture.wallets.kol
            );

            const wormholeChainId = wormholeDest;
            const beneficiary = ethers.hexlify(ethers.randomBytes(32));

            await sut.connect(wallets.kol).updateBeneficiary(escrow.id, wormholeChainId, beneficiary);

            const escrowData = await sut.getEscrow(escrow.id);

            expect(escrowData.beneficiary).to.be.equal(beneficiary);
            expect(escrowData.wormholeChainId).to.be.equal(wormholeChainId);
        });

        it("Should emit the BeneficiaryUpdated event", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            const wormholeChainId = wormholeDest;
            const beneficiary = ethers.hexlify(ethers.randomBytes(32));

            await expect(sut.connect(wallets.kol).updateBeneficiary(escrow.id, wormholeChainId, beneficiary))
                .to.emit(sut, "BeneficiaryUpdated")
                .withArgs(escrow.id, wormholeChainId, beneficiary);
        });
    });

    describe("relayedUpdateBeneficiary", function () {
        it("Should revert if the escrow does not exist", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const beneficiarySignature = await signTypeData.updateBeneficiary(
                wallets.kol,
                escrow.id + 1n,
                escrow.wormholeChainId,
                escrow.beneficiary,
                await nonces.escrow(escrow.id)
            );

            await expect(
                sut.relayedUpdateBeneficiary(
                    beneficiarySignature,
                    escrow.id + 1n,
                    escrow.wormholeChainId,
                    escrow.beneficiary
                )
            ).to.be.revertedWithCustomError(sut, "EscrowNotFound");
        });

        it("Should revert if the signer is not the beneficiary", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const beneficiarySignature = await signTypeData.updateBeneficiary(
                wallets.org,
                escrow.id,
                escrow.wormholeChainId,
                escrow.beneficiary,
                await nonces.escrow(escrow.id)
            );

            await expect(
                sut.relayedUpdateBeneficiary(
                    beneficiarySignature,
                    escrow.id,
                    escrow.wormholeChainId,
                    escrow.beneficiary
                )
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert if the beneficiary address is not evm", async function () {
            const fixture = await loadFixture(deployBridgedEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const beneficiarySignature = await signTypeData.updateBeneficiary(
                wallets.kol,
                escrow.id,
                escrow.wormholeChainId,
                escrow.beneficiary,
                await nonces.escrow(escrow.id)
            );

            await expect(
                sut.relayedUpdateBeneficiary(
                    beneficiarySignature,
                    escrow.id,
                    escrow.wormholeChainId,
                    escrow.beneficiary
                )
            ).to.be.revertedWithCustomError(sut, "InvalidAddress");
        });

        it("Should revert if the chain is not supported", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const beneficiarySignature = await signTypeData.updateBeneficiary(
                wallets.kol,
                escrow.id,
                999,
                escrow.beneficiary,
                await nonces.escrow(escrow.id)
            );

            await expect(
                sut.relayedUpdateBeneficiary(beneficiarySignature, escrow.id, 999, escrow.beneficiary)
            ).to.be.revertedWithCustomError(sut, "WormholeNotRegistered");
        });

        it("Should set the beneficiary and wormhole chain id", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const wormholeChainId = wormholeDest;
            const beneficiary = ethers.hexlify(ethers.randomBytes(32));

            const beneficiarySignature = await signTypeData.updateBeneficiary(
                wallets.kol,
                escrow.id,
                wormholeChainId,
                beneficiary,
                await nonces.escrow(escrow.id)
            );

            await sut.relayedUpdateBeneficiary(beneficiarySignature, escrow.id, wormholeChainId, beneficiary);

            const escrowData = await sut.getEscrow(escrow.id);

            expect(escrowData.beneficiary).to.be.equal(beneficiary);
            expect(escrowData.wormholeChainId).to.be.equal(wormholeChainId);
        });

        it("Should set the beneficiary and wormhole chain id with an elected wallet", async function () {
            const fixture = await loadFixture(deployBridgedEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await setElectedEvmAddress(
                fixture,
                fixture.escrow.beneficiary,
                fixture.wallets.kol
            );

            const wormholeChainId = wormholeDest;
            const beneficiary = ethers.hexlify(ethers.randomBytes(32));

            const beneficiarySignature = await signTypeData.updateBeneficiary(
                wallets.kol,
                escrow.id,
                wormholeChainId,
                beneficiary,
                await nonces.escrow(escrow.id)
            );

            await sut.relayedUpdateBeneficiary(beneficiarySignature, escrow.id, wormholeChainId, beneficiary);

            const escrowData = await sut.getEscrow(escrow.id);

            expect(escrowData.beneficiary).to.be.equal(beneficiary);
            expect(escrowData.wormholeChainId).to.be.equal(wormholeChainId);
        });

        it("Should emit the BeneficiaryUpdated event", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const wormholeChainId = wormholeDest;
            const beneficiary = ethers.hexlify(ethers.randomBytes(32));

            const beneficiarySignature = await signTypeData.updateBeneficiary(
                wallets.kol,
                escrow.id,
                wormholeChainId,
                beneficiary,
                await nonces.escrow(escrow.id)
            );

            await expect(sut.relayedUpdateBeneficiary(beneficiarySignature, escrow.id, wormholeChainId, beneficiary))
                .to.emit(sut, "BeneficiaryUpdated")
                .withArgs(escrow.id, wormholeChainId, beneficiary);
        });
    });

    describe("releaseEscrow", function () {
        it("Should revert if the escrow does not exist", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            await expect(
                sut.connect(wallets.org).releaseEscrow(escrow.id + 1n, escrow.amount)
            ).to.be.revertedWithCustomError(sut, "EscrowNotFound");
        });

        it("Should revert if the caller is not the creator", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            await expect(
                sut.connect(wallets.kol).releaseEscrow(escrow.id, escrow.amount)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert if the amount is too large", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            await expect(sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount + 1n)).to.be.reverted; //underflow
        });

        it("Should decrement the escrow amount", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, escrow } = fixture;

            await sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount);

            const escrowData = await sut.getEscrow(escrow.id);
            expect(escrowData.amount).to.be.equal(0);
        });

        describe("direct", function () {
            it("Should transfer the amount to the beneficiary", async function () {
                const fixture = await loadFixture(deployDirectEscrowFixture);
                const { sut, usdc, wallets, escrow } = fixture;

                const beneficiaryBalanceBefore = await usdc.balanceOf(wallets.kol.address);
                const sutBalanceBefore = await usdc.balanceOf(sut.target);

                await sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount);

                const beneficiaryBalanceAfter = await usdc.balanceOf(wallets.kol.address);
                const sutBalanceAfter = await usdc.balanceOf(sut.target);

                expect(beneficiaryBalanceAfter).to.be.equal(beneficiaryBalanceBefore + escrow.amount);
                expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
            });

            it("Should emit the EscrowReleased event", async function () {
                const fixture = await loadFixture(deployDirectEscrowFixture);
                const { sut, wallets, escrow } = fixture;

                const messageSequence = 0;

                await expect(sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount))
                    .to.emit(sut, "EscrowReleased")
                    .withArgs(escrow.id, escrow.amount, messageSequence);
            });
        });

        describe("bridged", function () {
            describe("has fee", function () {
                let fixture: Awaited<ReturnType<typeof deployBridgedEscrowFixture>>;

                this.beforeEach(async function () {
                    fixture = await loadFixture(deployBridgedEscrowFixture);

                    await fixture.wormholeRelayer.mockRelayerFee(wormholeDest, fixture.usdc.target, wormholeDestFee);
                });

                it("Should forward the call to wormhole including the fee", async function () {
                    const { sut, wormholeRelayer, usdc, wallets, escrow } = fixture;

                    await expect(sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount))
                        .to.emit(wormholeRelayer, "TransferTokensWithRelayCalled")
                        .withArgs(
                            usdc.target,
                            escrow.amount + wormholeDestFee,
                            nativeDrop,
                            wormholeDest,
                            escrow.beneficiary
                        );
                });

                it("Should transfer the fee from the treasury", async function () {
                    const { sut, wormholeRelayer, usdc, wallets, escrow } = fixture;

                    const sutBalanceBefore = await usdc.balanceOf(sut.target);
                    const wormholeBalanceBefore = await usdc.balanceOf(wormholeRelayer.target);
                    const treasuryBalanceBefore = await usdc.balanceOf(wallets.treasury.address);

                    await sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount);

                    const sutBalanceAfter = await usdc.balanceOf(sut.target);
                    const wormholeBalanceAfter = await usdc.balanceOf(wormholeRelayer.target);
                    const treasuryBalanceAfter = await usdc.balanceOf(wallets.treasury.address);

                    expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
                    expect(wormholeBalanceAfter).to.be.equal(wormholeBalanceBefore + wormholeDestFee + escrow.amount);
                    expect(treasuryBalanceAfter).to.be.equal(treasuryBalanceBefore - wormholeDestFee);
                });

                it("Should emit the BridgeFeePaid event", async function () {
                    const { sut, wallets, escrow } = fixture;

                    await expect(sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount))
                        .to.emit(sut, "BridgeFeePaid")
                        .withArgs(escrow.id, wormholeDestFee);
                });
            });

            it("Should transfer the amount to wormhole", async function () {
                const fixture = await loadFixture(deployBridgedEscrowFixture);
                const { sut, wormholeRelayer, usdc, wallets, escrow } = fixture;

                const sutBalanceBefore = await usdc.balanceOf(sut.target);
                const wormholeBalanceBefore = await usdc.balanceOf(wormholeRelayer.target);

                await sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount);

                const sutBalanceAfter = await usdc.balanceOf(sut.target);
                const wormholeBalanceAfter = await usdc.balanceOf(wormholeRelayer.target);

                expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
                expect(wormholeBalanceAfter).to.be.equal(wormholeBalanceBefore + escrow.amount);
            });

            it("Should forward the call to wormhole", async function () {
                const fixture = await loadFixture(deployBridgedEscrowFixture);
                const { sut, wormholeRelayer, usdc, wallets, escrow } = fixture;

                await expect(sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount))
                    .to.emit(wormholeRelayer, "TransferTokensWithRelayCalled")
                    .withArgs(usdc.target, escrow.amount, nativeDrop, wormholeDest, escrow.beneficiary);
            });

            it("Should emit the EscrowReleased event", async function () {
                const fixture = await loadFixture(deployBridgedEscrowFixture);
                const { sut, wormholeRelayer, wallets, escrow } = fixture;

                const messageSequence = 15;
                await wormholeRelayer.mockMessageSequence(messageSequence);

                await expect(sut.connect(wallets.org).releaseEscrow(escrow.id, escrow.amount))
                    .to.emit(sut, "EscrowReleased")
                    .withArgs(escrow.id, escrow.amount, messageSequence);
            });
        });
    });

    describe("relayedReleaseEscrow", function () {
        it("Should revert if the escrow does not exist", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const creatorSignature = await signTypeData.release(
                wallets.org,
                escrow.id,
                escrow.amount,
                await nonces.escrow(escrow.id)
            );

            await expect(
                sut.relayedReleaseEscrow(creatorSignature, escrow.id + 1n, escrow.amount)
            ).to.be.revertedWithCustomError(sut, "EscrowNotFound");
        });

        it("Should revert if the signer is not the creator", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const creatorSignature = await signTypeData.release(
                wallets.platform, // invalid signer
                escrow.id,
                escrow.amount,
                await nonces.escrow(escrow.id)
            );

            await expect(
                sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert on signature replay", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const creatorSignature = await signTypeData.release(
                wallets.org,
                escrow.id,
                escrow.amount,
                await nonces.escrow(escrow.id)
            );

            await sut.connect(wallets.relayer).relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount);

            await expect(
                sut.connect(wallets.attacker).relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert if the amount is too large", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const creatorSignature = await signTypeData.release(
                wallets.org,
                escrow.id,
                escrow.amount,
                await nonces.escrow(escrow.id)
            );

            await expect(sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount + 1n)).to.be.reverted; //underflow
        });

        it("Should decrement the escrow amount", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { sut, wallets, signTypeData, escrow, nonces } = fixture;

            const creatorSignature = await signTypeData.release(
                wallets.org,
                escrow.id,
                escrow.amount,
                await nonces.escrow(escrow.id)
            );

            await sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount);

            const escrowData = await sut.getEscrow(escrow.id);
            expect(escrowData.amount).to.be.equal(0);
        });

        describe("direct", function () {
            it("Should transfer the amount to the beneficiary", async function () {
                const fixture = await loadFixture(deployDirectEscrowFixture);
                const { sut, usdc, wallets, signTypeData, escrow, nonces } = fixture;

                const creatorSignature = await signTypeData.release(
                    wallets.org,
                    escrow.id,
                    escrow.amount,
                    await nonces.escrow(escrow.id)
                );

                const beneficiaryBalanceBefore = await usdc.balanceOf(wallets.kol.address);
                const sutBalanceBefore = await usdc.balanceOf(sut.target);

                await sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount);

                const beneficiaryBalanceAfter = await usdc.balanceOf(wallets.kol.address);
                const sutBalanceAfter = await usdc.balanceOf(sut.target);

                expect(beneficiaryBalanceAfter).to.be.equal(beneficiaryBalanceBefore + escrow.amount);
                expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
            });

            it("Should emit the EscrowReleased event", async function () {
                const fixture = await loadFixture(deployDirectEscrowFixture);
                const { sut, wallets, signTypeData, escrow, nonces } = fixture;

                const creatorSignature = await signTypeData.release(
                    wallets.org,
                    escrow.id,
                    escrow.amount,
                    await nonces.escrow(escrow.id)
                );

                const messageSequence = 0;

                await expect(sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount))
                    .to.emit(sut, "EscrowReleased")
                    .withArgs(escrow.id, escrow.amount, messageSequence);
            });
        });

        describe("bridged", function () {
            describe("has fee", function () {
                let fixture: Awaited<ReturnType<typeof deployBridgedEscrowFixture>>;

                this.beforeEach(async function () {
                    fixture = await loadFixture(deployBridgedEscrowFixture);

                    await fixture.wormholeRelayer.mockRelayerFee(wormholeDest, fixture.usdc.target, wormholeDestFee);
                });

                it("Should forward the call to wormhole including the fee", async function () {
                    const { sut, usdc, wormholeRelayer, wallets, signTypeData, escrow, nonces } = fixture;

                    const creatorSignature = await signTypeData.release(
                        wallets.org,
                        escrow.id,
                        escrow.amount,
                        await nonces.escrow(escrow.id)
                    );

                    await expect(sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount))
                        .to.emit(wormholeRelayer, "TransferTokensWithRelayCalled")
                        .withArgs(
                            usdc.target,
                            escrow.amount + wormholeDestFee,
                            nativeDrop,
                            wormholeDest,
                            escrow.beneficiary
                        );
                });

                it("Should transfer the fee from the treasury", async function () {
                    const { sut, usdc, wormholeRelayer, wallets, signTypeData, escrow, nonces } = fixture;

                    const creatorSignature = await signTypeData.release(
                        wallets.org,
                        escrow.id,
                        escrow.amount,
                        await nonces.escrow(escrow.id)
                    );

                    const sutBalanceBefore = await usdc.balanceOf(sut.target);
                    const wormholeBalanceBefore = await usdc.balanceOf(wormholeRelayer.target);
                    const treasuryBalanceBefore = await usdc.balanceOf(wallets.treasury.address);

                    await sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount);

                    const sutBalanceAfter = await usdc.balanceOf(sut.target);
                    const wormholeBalanceAfter = await usdc.balanceOf(wormholeRelayer.target);
                    const treasuryBalanceAfter = await usdc.balanceOf(wallets.treasury.address);

                    expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
                    expect(wormholeBalanceAfter).to.be.equal(wormholeBalanceBefore + wormholeDestFee + escrow.amount);
                    expect(treasuryBalanceAfter).to.be.equal(treasuryBalanceBefore - wormholeDestFee);
                });

                it("Should emit the BridgeFeePaid event", async function () {
                    const { sut, wallets, signTypeData, escrow, nonces } = fixture;

                    const creatorSignature = await signTypeData.release(
                        wallets.org,
                        escrow.id,
                        escrow.amount,
                        await nonces.escrow(escrow.id)
                    );

                    await expect(sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount))
                        .to.emit(sut, "BridgeFeePaid")
                        .withArgs(escrow.id, wormholeDestFee);
                });
            });

            it("Should transfer the amount to wormhole", async function () {
                const fixture = await loadFixture(deployBridgedEscrowFixture);
                const { sut, usdc, wormholeRelayer, wallets, signTypeData, escrow, nonces } = fixture;

                const creatorSignature = await signTypeData.release(
                    wallets.org,
                    escrow.id,
                    escrow.amount,
                    await nonces.escrow(escrow.id)
                );

                const sutBalanceBefore = await usdc.balanceOf(sut.target);
                const wormholeBalanceBefore = await usdc.balanceOf(wormholeRelayer.target);

                await sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount);

                const sutBalanceAfter = await usdc.balanceOf(sut.target);
                const wormholeBalanceAfter = await usdc.balanceOf(wormholeRelayer.target);

                expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
                expect(wormholeBalanceAfter).to.be.equal(wormholeBalanceBefore + escrow.amount);
            });

            it("Should forward the call to wormhole", async function () {
                const fixture = await loadFixture(deployBridgedEscrowFixture);
                const { sut, usdc, wormholeRelayer, wallets, signTypeData, escrow, nonces } = fixture;

                const creatorSignature = await signTypeData.release(
                    wallets.org,
                    escrow.id,
                    escrow.amount,
                    await nonces.escrow(escrow.id)
                );

                await expect(sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount))
                    .to.emit(wormholeRelayer, "TransferTokensWithRelayCalled")
                    .withArgs(usdc.target, escrow.amount, nativeDrop, wormholeDest, escrow.beneficiary);
            });

            it("Should emit the EscrowReleased event", async function () {
                const fixture = await loadFixture(deployBridgedEscrowFixture);
                const { sut, wormholeRelayer, wallets, signTypeData, escrow, nonces } = fixture;

                const creatorSignature = await signTypeData.release(
                    wallets.org,
                    escrow.id,
                    escrow.amount,
                    await nonces.escrow(escrow.id)
                );

                const messageSequence = 15;
                await wormholeRelayer.mockMessageSequence(messageSequence);

                await expect(sut.relayedReleaseEscrow(creatorSignature, escrow.id, escrow.amount))
                    .to.emit(sut, "EscrowReleased")
                    .withArgs(escrow.id, escrow.amount, messageSequence);
            });
        });
    });

    describe("setElectedEvmAddress", function () {
        const nonEvmAddress = ethers.hexlify(ethers.randomBytes(32));

        it("Should revert if the signature is invalid", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const platformSignature = await signTypeData.electEvmAddress(
                wallets.org, // invalid signer
                nonEvmAddress,
                wallets.kol.address,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut.setElectedEvmAddress(platformSignature, nonEvmAddress, wallets.kol.address)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert on signature replay", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const platformSignature = await signTypeData.electEvmAddress(
                wallets.platform,
                nonEvmAddress,
                wallets.kol.address,
                await nonces.address(wallets.kol.address)
            );

            await sut
                .connect(wallets.relayer)
                .setElectedEvmAddress(platformSignature, nonEvmAddress, wallets.kol.address);

            await expect(
                sut
                    .connect(wallets.attacker)
                    .setElectedEvmAddress(platformSignature, nonEvmAddress, wallets.kol.address)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should set the elected evm address", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const platformSignature = await signTypeData.electEvmAddress(
                wallets.platform,
                nonEvmAddress,
                wallets.kol.address,
                await nonces.address(wallets.kol.address)
            );

            await sut.setElectedEvmAddress(platformSignature, nonEvmAddress, wallets.kol.address);
            expect(await sut.getElectedAddress(nonEvmAddress)).to.be.equal(wallets.kol.address);
        });

        it("Should emit the EvmAddressElected event", async function () {
            const fixture = await loadFixture(deployFixture);
            const { sut, signTypeData, wallets, nonces } = fixture;

            const platformSignature = await signTypeData.electEvmAddress(
                wallets.platform,
                nonEvmAddress,
                wallets.kol.address,
                await nonces.address(wallets.kol.address)
            );

            await expect(sut.setElectedEvmAddress(platformSignature, nonEvmAddress, wallets.kol.address))
                .to.emit(sut, "EvmAddressElected")
                .withArgs(nonEvmAddress, wallets.kol.address);
        });
    });

    describe("amicableResolution", function () {
        it("Should revert if the escrow does not exist", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const missingId = escrow.id + 1n;

            const half = escrow.amount / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                missingId,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                missingId,
                half,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut.amicableResolution(creatorSignature, beneficiarySignature, missingId, half, half)
            ).to.be.revertedWithCustomError(sut, "EscrowNotFound");
        });

        it("Should revert if the creator signature is wrong", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const half = escrow.amount / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                half,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut.amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half)
            ).to.be.revertedWithCustomError(sut, "InvalidSignature");
        });

        it("Should revert if the creator signature is reused", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const half = escrow.amount / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            let beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                half,
                await nonces.address(wallets.kol.address)
            );

            await sut
                .connect(wallets.relayer)
                .amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half);

            beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                half,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut
                    .connect(wallets.attacker)
                    .amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half)
            ).to.be.revertedWithCustomError(sut, "InvalidSignature");
        });

        it("Should revert if the beneficiary signature is wrong", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const half = escrow.amount / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut.amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half)
            ).to.be.revertedWithCustomError(sut, "InvalidSignature");
        });

        it("Should revert if the beneficiary signature is reused", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const half = escrow.amount / 2n;

            let creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                half,
                await nonces.address(wallets.kol.address)
            );

            await sut
                .connect(wallets.relayer)
                .amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half);

            creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );

            await expect(
                sut
                    .connect(wallets.attacker)
                    .amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half)
            ).to.be.revertedWithCustomError(sut, "InvalidSignature");
        });

        it("Should revert if the beneficiary address is not evm", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployBridgedEscrowFixture);

            const half = escrow.amount / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                half,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut.amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half)
            ).to.be.revertedWithCustomError(sut, "InvalidAddress");
        });

        it("Should use the elected signer", async function () {
            const fixture = await loadFixture(deployBridgedEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await setElectedEvmAddress(
                fixture,
                fixture.escrow.beneficiary,
                fixture.wallets.kol
            );

            const half = escrow.amount / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                half,
                await nonces.address(wallets.kol.address)
            );

            await expect(sut.amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half))
                .to.emit(sut, "DisputeResolved")
                .withArgs(escrow.id, half, half);
        });

        it("Should revert if the full amount is not accounted for", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const half = escrow.amount / 2n;
            const quarter = half / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                quarter,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut.amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, quarter)
            ).to.be.revertedWithCustomError(sut, "InvalidResolution");
        });

        it("Should revert if the combined amount is too much", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const half = escrow.amount / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                escrow.amount,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut.amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, escrow.amount)
            ).to.be.revertedWithCustomError(sut, "InvalidResolution");
        });

        it("Should set the amount to 0", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const half = escrow.amount / 2n;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                half,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                half,
                await nonces.address(wallets.kol.address)
            );

            await sut.amicableResolution(creatorSignature, beneficiarySignature, escrow.id, half, half);

            const escrowData = await sut.getEscrow(escrow.id);
            expect(escrowData.amount).to.be.equal(0);
        });

        it("Should emit the DisputeResolved event", async function () {
            const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

            const creatorAmount = escrow.amount / 4n;
            const beneficiaryAmount = escrow.amount - creatorAmount;

            const creatorSignature = await signTypeData.amicable(
                wallets.org,
                escrow.id,
                creatorAmount,
                await nonces.address(wallets.org.address)
            );
            const beneficiarySignature = await signTypeData.amicable(
                wallets.kol,
                escrow.id,
                beneficiaryAmount,
                await nonces.address(wallets.kol.address)
            );

            await expect(
                sut.amicableResolution(
                    creatorSignature,
                    beneficiarySignature,
                    escrow.id,
                    creatorAmount,
                    beneficiaryAmount
                )
            )
                .to.emit(sut, "DisputeResolved")
                .withArgs(escrow.id, creatorAmount, beneficiaryAmount);
        });

        describe("creator", function () {
            it("Should transfer the amount to the creator", async function () {
                const { sut, usdc, wallets, signTypeData, escrow, nonces } =
                    await loadFixture(deployDirectEscrowFixture);

                const creatorAmount = escrow.amount;
                const beneficiaryAmount = 0n;

                const creatorSignature = await signTypeData.amicable(
                    wallets.org,
                    escrow.id,
                    creatorAmount,
                    await nonces.address(wallets.org.address)
                );
                const beneficiarySignature = await signTypeData.amicable(
                    wallets.kol,
                    escrow.id,
                    beneficiaryAmount,
                    await nonces.address(wallets.kol.address)
                );

                const creatorBalanceBefore = await usdc.balanceOf(escrow.creator);

                await sut.amicableResolution(
                    creatorSignature,
                    beneficiarySignature,
                    escrow.id,
                    creatorAmount,
                    beneficiaryAmount
                );

                const creatorBalanceAfter = await usdc.balanceOf(escrow.creator);

                expect(creatorBalanceAfter).to.be.equal(creatorBalanceBefore + creatorAmount);
            });

            it("Should emit EscrowRefunded", async function () {
                const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

                const creatorAmount = escrow.amount;
                const beneficiaryAmount = 0n;

                const creatorSignature = await signTypeData.amicable(
                    wallets.org,
                    escrow.id,
                    creatorAmount,
                    await nonces.address(wallets.org.address)
                );
                const beneficiarySignature = await signTypeData.amicable(
                    wallets.kol,
                    escrow.id,
                    beneficiaryAmount,
                    await nonces.address(wallets.kol.address)
                );

                await expect(
                    sut.amicableResolution(
                        creatorSignature,
                        beneficiarySignature,
                        escrow.id,
                        creatorAmount,
                        beneficiaryAmount
                    )
                )
                    .to.emit(sut, "EscrowRefunded")
                    .withArgs(escrow.id, creatorAmount);
            });
        });

        describe("beneficiary", function () {
            describe("direct", function () {
                it("Should transfer the amount to the beneficiary", async function () {
                    const { sut, usdc, wallets, signTypeData, escrow, nonces } =
                        await loadFixture(deployDirectEscrowFixture);

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const creatorSignature = await signTypeData.amicable(
                        wallets.org,
                        escrow.id,
                        creatorAmount,
                        await nonces.address(wallets.org.address)
                    );
                    const beneficiarySignature = await signTypeData.amicable(
                        wallets.kol,
                        escrow.id,
                        beneficiaryAmount,
                        await nonces.address(wallets.kol.address)
                    );

                    const beneficiaryBalanceBefore = await usdc.balanceOf(wallets.kol.address);

                    await sut.amicableResolution(
                        creatorSignature,
                        beneficiarySignature,
                        escrow.id,
                        creatorAmount,
                        beneficiaryAmount
                    );

                    const beneficiaryBalanceAfter = await usdc.balanceOf(wallets.kol.address);

                    expect(beneficiaryBalanceAfter).to.be.equal(beneficiaryBalanceBefore + beneficiaryAmount);
                });

                it("Should emit EscrowReleased", async function () {
                    const { sut, wallets, signTypeData, escrow, nonces } = await loadFixture(deployDirectEscrowFixture);

                    const messageSequence = 0n;

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const creatorSignature = await signTypeData.amicable(
                        wallets.org,
                        escrow.id,
                        creatorAmount,
                        await nonces.address(wallets.org.address)
                    );
                    const beneficiarySignature = await signTypeData.amicable(
                        wallets.kol,
                        escrow.id,
                        beneficiaryAmount,
                        await nonces.address(wallets.kol.address)
                    );

                    await expect(
                        sut.amicableResolution(
                            creatorSignature,
                            beneficiarySignature,
                            escrow.id,
                            creatorAmount,
                            beneficiaryAmount
                        )
                    )
                        .to.emit(sut, "EscrowReleased")
                        .withArgs(escrow.id, beneficiaryAmount, messageSequence);
                });
            });

            describe("bridged", function () {
                describe("has fee", function () {
                    let fixture: Awaited<ReturnType<typeof deployBridgedEscrowFixture>>;

                    this.beforeEach(async function () {
                        fixture = await loadFixture(deployBridgedEscrowFixture);

                        await setElectedEvmAddress(fixture, fixture.escrow.beneficiary, fixture.wallets.kol);

                        await fixture.wormholeRelayer.mockRelayerFee(
                            wormholeDest,
                            fixture.usdc.target,
                            wormholeDestFee
                        );
                    });

                    it("Should forward the call to wormhole including the fee", async function () {
                        const { sut, wormholeRelayer, usdc, wallets, signTypeData, escrow, nonces } = fixture;

                        const creatorAmount = 0n;
                        const beneficiaryAmount = escrow.amount;

                        const creatorSignature = await signTypeData.amicable(
                            wallets.org,
                            escrow.id,
                            creatorAmount,
                            await nonces.address(wallets.org.address)
                        );
                        const beneficiarySignature = await signTypeData.amicable(
                            wallets.kol,
                            escrow.id,
                            beneficiaryAmount,
                            await nonces.address(wallets.kol.address)
                        );

                        await expect(
                            sut.amicableResolution(
                                creatorSignature,
                                beneficiarySignature,
                                escrow.id,
                                creatorAmount,
                                beneficiaryAmount
                            )
                        )
                            .to.emit(wormholeRelayer, "TransferTokensWithRelayCalled")
                            .withArgs(
                                usdc.target,
                                escrow.amount + wormholeDestFee,
                                nativeDrop,
                                wormholeDest,
                                escrow.beneficiary
                            );
                    });

                    it("Should transfer the fee from the treasury", async function () {
                        const { sut, wormholeRelayer, usdc, wallets, signTypeData, escrow, nonces } = fixture;

                        const creatorAmount = 0n;
                        const beneficiaryAmount = escrow.amount;

                        const creatorSignature = await signTypeData.amicable(
                            wallets.org,
                            escrow.id,
                            creatorAmount,
                            await nonces.address(wallets.org.address)
                        );
                        const beneficiarySignature = await signTypeData.amicable(
                            wallets.kol,
                            escrow.id,
                            beneficiaryAmount,
                            await nonces.address(wallets.kol.address)
                        );

                        const sutBalanceBefore = await usdc.balanceOf(sut.target);
                        const wormholeBalanceBefore = await usdc.balanceOf(wormholeRelayer.target);
                        const treasuryBalanceBefore = await usdc.balanceOf(wallets.treasury.address);

                        await sut.amicableResolution(
                            creatorSignature,
                            beneficiarySignature,
                            escrow.id,
                            creatorAmount,
                            beneficiaryAmount
                        );

                        const sutBalanceAfter = await usdc.balanceOf(sut.target);
                        const wormholeBalanceAfter = await usdc.balanceOf(wormholeRelayer.target);
                        const treasuryBalanceAfter = await usdc.balanceOf(wallets.treasury.address);

                        expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
                        expect(wormholeBalanceAfter).to.be.equal(
                            wormholeBalanceBefore + wormholeDestFee + escrow.amount
                        );
                        expect(treasuryBalanceAfter).to.be.equal(treasuryBalanceBefore - wormholeDestFee);
                    });

                    it("Should emit the BridgeFeePaid event", async function () {
                        const { sut, wallets, signTypeData, escrow, nonces } = fixture;

                        const creatorAmount = 0n;
                        const beneficiaryAmount = escrow.amount;

                        const creatorSignature = await signTypeData.amicable(
                            wallets.org,
                            escrow.id,
                            creatorAmount,
                            await nonces.address(wallets.org.address)
                        );
                        const beneficiarySignature = await signTypeData.amicable(
                            wallets.kol,
                            escrow.id,
                            beneficiaryAmount,
                            await nonces.address(wallets.kol.address)
                        );

                        await expect(
                            sut.amicableResolution(
                                creatorSignature,
                                beneficiarySignature,
                                escrow.id,
                                creatorAmount,
                                beneficiaryAmount
                            )
                        )
                            .to.emit(sut, "BridgeFeePaid")
                            .withArgs(escrow.id, wormholeDestFee);
                    });
                });

                it("Should transfer the amount to wormhole", async function () {
                    const fixture = await loadFixture(deployBridgedEscrowFixture);
                    const { escrow } = fixture;
                    const { sut, wormholeRelayer, usdc, signTypeData, wallets, nonces } = await setElectedEvmAddress(
                        fixture,
                        fixture.escrow.beneficiary,
                        fixture.wallets.kol
                    );

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const creatorSignature = await signTypeData.amicable(
                        wallets.org,
                        escrow.id,
                        creatorAmount,
                        await nonces.address(wallets.org.address)
                    );
                    const beneficiarySignature = await signTypeData.amicable(
                        wallets.kol,
                        escrow.id,
                        beneficiaryAmount,
                        await nonces.address(wallets.kol.address)
                    );

                    const sutBalanceBefore = await usdc.balanceOf(sut.target);
                    const wormholeBalanceBefore = await usdc.balanceOf(wormholeRelayer.target);

                    await sut.amicableResolution(
                        creatorSignature,
                        beneficiarySignature,
                        escrow.id,
                        creatorAmount,
                        beneficiaryAmount
                    );

                    const sutBalanceAfter = await usdc.balanceOf(sut.target);
                    const wormholeBalanceAfter = await usdc.balanceOf(wormholeRelayer.target);

                    expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
                    expect(wormholeBalanceAfter).to.be.equal(wormholeBalanceBefore + escrow.amount);
                });

                it("Should forward the call to wormhole", async function () {
                    const fixture = await loadFixture(deployBridgedEscrowFixture);
                    const { escrow } = fixture;
                    const { sut, wormholeRelayer, usdc, signTypeData, wallets, nonces } = await setElectedEvmAddress(
                        fixture,
                        fixture.escrow.beneficiary,
                        fixture.wallets.kol
                    );

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const creatorSignature = await signTypeData.amicable(
                        wallets.org,
                        escrow.id,
                        creatorAmount,
                        await nonces.address(wallets.org.address)
                    );
                    const beneficiarySignature = await signTypeData.amicable(
                        wallets.kol,
                        escrow.id,
                        beneficiaryAmount,
                        await nonces.address(wallets.kol.address)
                    );

                    await expect(
                        sut.amicableResolution(
                            creatorSignature,
                            beneficiarySignature,
                            escrow.id,
                            creatorAmount,
                            beneficiaryAmount
                        )
                    )
                        .to.emit(wormholeRelayer, "TransferTokensWithRelayCalled")
                        .withArgs(usdc.target, escrow.amount, nativeDrop, wormholeDest, escrow.beneficiary);
                });

                it("Should emit the EscrowReleased event", async function () {
                    const fixture = await loadFixture(deployBridgedEscrowFixture);
                    const { escrow } = fixture;
                    const { sut, wormholeRelayer, signTypeData, wallets, nonces } = await setElectedEvmAddress(
                        fixture,
                        fixture.escrow.beneficiary,
                        fixture.wallets.kol
                    );

                    const messageSequence = 15;
                    await wormholeRelayer.mockMessageSequence(messageSequence);

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const creatorSignature = await signTypeData.amicable(
                        wallets.org,
                        escrow.id,
                        creatorAmount,
                        await nonces.address(wallets.org.address)
                    );
                    const beneficiarySignature = await signTypeData.amicable(
                        wallets.kol,
                        escrow.id,
                        beneficiaryAmount,
                        await nonces.address(wallets.kol.address)
                    );

                    await expect(
                        sut.amicableResolution(
                            creatorSignature,
                            beneficiarySignature,
                            escrow.id,
                            creatorAmount,
                            beneficiaryAmount
                        )
                    )
                        .to.emit(sut, "EscrowReleased")
                        .withArgs(escrow.id, escrow.amount, messageSequence);
                });
            });
        });
    });

    describe("startDispute", function () {
        it("Should revert if the escrow does not exist", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const missingEscrowId = escrow.id + 1n;

            const signature = await signTypeData.startDispute(
                wallets.platform,
                missingEscrowId,
                await nonces.escrow(missingEscrowId)
            );

            await expect(sut.startDispute(signature, missingEscrowId)).to.be.revertedWithCustomError(
                sut,
                "EscrowNotFound"
            );
        });

        it("Should revert if the signature is invalid", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const signature = await signTypeData.startDispute(
                wallets.platform,
                escrow.id + 1n,
                await nonces.escrow(escrow.id)
            );

            await expect(sut.startDispute(signature, escrow.id)).to.be.revertedWithCustomError(
                sut,
                "UnauthorizedSender"
            );
        });

        it("Should revert on signature replay", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const signature = await signTypeData.startDispute(
                wallets.platform,
                escrow.id,
                await nonces.escrow(escrow.id)
            );

            await sut.connect(wallets.relayer).startDispute(signature, escrow.id);

            await expect(
                sut.connect(wallets.attacker).startDispute(signature, escrow.id)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert if the resolution process has already started", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            let signature = await signTypeData.startDispute(
                wallets.platform,
                escrow.id,
                await nonces.escrow(escrow.id)
            );
            await sut.startDispute(signature, escrow.id);

            signature = await signTypeData.startDispute(wallets.platform, escrow.id, await nonces.escrow(escrow.id));
            await expect(sut.startDispute(signature, escrow.id)).to.be.revertedWithCustomError(sut, "AlreadyStarted");
        });

        it("Should set the allowPlatformResolutionTimestamp value to a timestamp 3 days in the future", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const signature = await signTypeData.startDispute(
                wallets.platform,
                escrow.id,
                await nonces.escrow(escrow.id)
            );

            const nextTimestamp = await setPredictableTimestamp();
            await sut.startDispute(signature, escrow.id);

            const escrowData = await sut.getEscrow(escrow.id);
            expect(escrowData.allowPlatformResolutionTimestamp).to.be.equal(nextTimestamp + threeDays);
        });

        it("Should emit the DisputeStarted event", async function () {
            const { sut, signTypeData, escrow, wallets, nonces } = await loadFixture(deployDirectEscrowFixture);

            const signature = await signTypeData.startDispute(
                wallets.platform,
                escrow.id,
                await nonces.escrow(escrow.id)
            );

            const nextTimestamp = await setPredictableTimestamp();
            await expect(sut.startDispute(signature, escrow.id))
                .to.emit(sut, "DisputeStarted")
                .withArgs(escrow.id, nextTimestamp + threeDays);
        });
    });

    describe("resolveDispute", function () {
        it("Should revert if the escrow does not exist", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

            const half = escrow.amount / 2n;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.platform,
                escrow.id + 1n,
                half,
                half,
                await nonces.escrow(escrow.id)
            );

            const data = await sut.getEscrow(escrow.id);
            await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

            await expect(
                sut.resolveDispute(platformSignature, escrow.id + 1n, half, half)
            ).to.be.revertedWithCustomError(sut, "EscrowNotFound");
        });

        it("Should revert if the signature is invalid", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

            const half = escrow.amount / 2n;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.org, // invalid signer
                escrow.id,
                half,
                half,
                await nonces.escrow(escrow.id)
            );

            const data = await sut.getEscrow(escrow.id);
            await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

            await expect(sut.resolveDispute(platformSignature, escrow.id, half, half)).to.be.revertedWithCustomError(
                sut,
                "UnauthorizedSender"
            );
        });

        it("Should revert on signature replay", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

            const half = escrow.amount / 2n;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.platform,
                escrow.id,
                half,
                half,
                await nonces.escrow(escrow.id)
            );

            const data = await sut.getEscrow(escrow.id);
            await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

            await sut.connect(wallets.relayer).resolveDispute(platformSignature, escrow.id, half, half);

            await expect(
                sut.connect(wallets.attacker).resolveDispute(platformSignature, escrow.id, half, half)
            ).to.be.revertedWithCustomError(sut, "UnauthorizedSender");
        });

        it("Should revert if the dispute has not been started", async function () {
            const { sut, wallets, signTypeData, nonces, escrow } = await loadFixture(deployDirectEscrowFixture);
            const half = escrow.amount / 2n;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.platform,
                escrow.id,
                half,
                half,
                await nonces.escrow(escrow.id)
            );

            await expect(sut.resolveDispute(platformSignature, escrow.id, half, half)).to.be.revertedWithCustomError(
                sut,
                "CannotResolveYet"
            );
        });

        it("Should revert if the dispute is in timeout", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

            const half = escrow.amount / 2n;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.platform,
                escrow.id,
                half,
                half,
                await nonces.escrow(escrow.id)
            );

            const data = await sut.getEscrow(escrow.id);
            await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp - 1n);

            await expect(sut.resolveDispute(platformSignature, escrow.id, half, half)).to.be.revertedWithCustomError(
                sut,
                "CannotResolveYet"
            );
        });

        it("Should revert if the full amount is not accounted for", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

            const half = escrow.amount / 2n;
            const quarter = half / 2n;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.platform,
                escrow.id,
                half,
                quarter,
                await nonces.escrow(escrow.id)
            );

            const data = await sut.getEscrow(escrow.id);
            await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

            await expect(sut.resolveDispute(platformSignature, escrow.id, half, quarter)).to.be.revertedWithCustomError(
                sut,
                "InvalidResolution"
            );
        });

        it("Should revert if the combined amount is too much", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

            const half = escrow.amount / 2n;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.platform,
                escrow.id,
                half,
                escrow.amount,
                await nonces.escrow(escrow.id)
            );

            const data = await sut.getEscrow(escrow.id);
            await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

            await expect(
                sut.resolveDispute(platformSignature, escrow.id, half, escrow.amount)
            ).to.be.revertedWithCustomError(sut, "InvalidResolution");
        });

        it("Should set the amount to 0", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

            const half = escrow.amount / 2n;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.platform,
                escrow.id,
                half,
                half,
                await nonces.escrow(escrow.id)
            );

            const data = await sut.getEscrow(escrow.id);
            await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

            await sut.resolveDispute(platformSignature, escrow.id, half, half);

            const escrowData = await sut.getEscrow(escrow.id);
            expect(escrowData.amount).to.be.equal(0);
        });

        it("Should emit the DisputeResolved event", async function () {
            const fixture = await loadFixture(deployDirectEscrowFixture);
            const { escrow } = fixture;
            const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

            const creatorAmount = escrow.amount / 4n;
            const beneficiaryAmount = escrow.amount - creatorAmount;

            const platformSignature = await signTypeData.resolveDispute(
                wallets.platform,
                escrow.id,
                creatorAmount,
                beneficiaryAmount,
                await nonces.escrow(escrow.id)
            );

            const data = await sut.getEscrow(escrow.id);
            await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

            await expect(sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount))
                .to.emit(sut, "DisputeResolved")
                .withArgs(escrow.id, creatorAmount, beneficiaryAmount);
        });

        describe("creator", function () {
            it("Should transfer the amount to the creator", async function () {
                const fixture = await loadFixture(deployDirectEscrowFixture);
                const { escrow } = fixture;
                const { sut, usdc, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

                const creatorAmount = escrow.amount;
                const beneficiaryAmount = 0n;

                const platformSignature = await signTypeData.resolveDispute(
                    wallets.platform,
                    escrow.id,
                    creatorAmount,
                    beneficiaryAmount,
                    await nonces.escrow(escrow.id)
                );

                const data = await sut.getEscrow(escrow.id);
                await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                const creatorBalanceBefore = await usdc.balanceOf(escrow.creator);

                await sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount);

                const creatorBalanceAfter = await usdc.balanceOf(escrow.creator);

                expect(creatorBalanceAfter).to.be.equal(creatorBalanceBefore + creatorAmount);
            });

            it("Should emit EscrowRefunded", async function () {
                const fixture = await loadFixture(deployDirectEscrowFixture);
                const { escrow } = fixture;
                const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

                const creatorAmount = escrow.amount;
                const beneficiaryAmount = 0n;

                const platformSignature = await signTypeData.resolveDispute(
                    wallets.platform,
                    escrow.id,
                    creatorAmount,
                    beneficiaryAmount,
                    await nonces.escrow(escrow.id)
                );

                const data = await sut.getEscrow(escrow.id);
                await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                await expect(sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount))
                    .to.emit(sut, "EscrowRefunded")
                    .withArgs(escrow.id, creatorAmount);
            });
        });

        describe("beneficiary", function () {
            describe("direct", function () {
                it("Should transfer the amount to the beneficiary", async function () {
                    const fixture = await loadFixture(deployDirectEscrowFixture);
                    const { escrow } = fixture;
                    const { sut, usdc, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const platformSignature = await signTypeData.resolveDispute(
                        wallets.platform,
                        escrow.id,
                        creatorAmount,
                        beneficiaryAmount,
                        await nonces.escrow(escrow.id)
                    );

                    const data = await sut.getEscrow(escrow.id);
                    await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                    const beneficiaryBalanceBefore = await usdc.balanceOf(wallets.kol.address);

                    await sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount);

                    const beneficiaryBalanceAfter = await usdc.balanceOf(wallets.kol.address);

                    expect(beneficiaryBalanceAfter).to.be.equal(beneficiaryBalanceBefore + beneficiaryAmount);
                });

                it("Should emit EscrowReleased", async function () {
                    const fixture = await loadFixture(deployDirectEscrowFixture);
                    const { escrow } = fixture;
                    const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

                    const messageSequence = 0n;

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const platformSignature = await signTypeData.resolveDispute(
                        wallets.platform,
                        escrow.id,
                        creatorAmount,
                        beneficiaryAmount,
                        await nonces.escrow(escrow.id)
                    );

                    const data = await sut.getEscrow(escrow.id);
                    await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                    await expect(sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount))
                        .to.emit(sut, "EscrowReleased")
                        .withArgs(escrow.id, beneficiaryAmount, messageSequence);
                });
            });

            describe("bridged", function () {
                describe("has fee", function () {
                    let fixture: Awaited<ReturnType<typeof deployBridgedEscrowFixture>>;

                    this.beforeEach(async function () {
                        fixture = await loadFixture(deployBridgedEscrowFixture);

                        await setElectedEvmAddress(fixture, fixture.escrow.beneficiary, fixture.wallets.kol);

                        await fixture.wormholeRelayer.mockRelayerFee(
                            wormholeDest,
                            fixture.usdc.target,
                            wormholeDestFee
                        );
                    });

                    it("Should forward the call to wormhole including the fee", async function () {
                        const { escrow } = fixture;
                        const { sut, usdc, wormholeRelayer, wallets, signTypeData, nonces } = await startDispute(
                            fixture,
                            escrow.id
                        );

                        const creatorAmount = 0n;
                        const beneficiaryAmount = escrow.amount;

                        const platformSignature = await signTypeData.resolveDispute(
                            wallets.platform,
                            escrow.id,
                            creatorAmount,
                            beneficiaryAmount,
                            await nonces.escrow(escrow.id)
                        );

                        const data = await sut.getEscrow(escrow.id);
                        await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                        await expect(sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount))
                            .to.emit(wormholeRelayer, "TransferTokensWithRelayCalled")
                            .withArgs(
                                usdc.target,
                                escrow.amount + wormholeDestFee,
                                nativeDrop,
                                wormholeDest,
                                escrow.beneficiary
                            );
                    });

                    it("Should transfer the fee from the treasury", async function () {
                        const { escrow } = fixture;
                        const { sut, usdc, wormholeRelayer, wallets, signTypeData, nonces } = await startDispute(
                            fixture,
                            escrow.id
                        );

                        const creatorAmount = 0n;
                        const beneficiaryAmount = escrow.amount;

                        const platformSignature = await signTypeData.resolveDispute(
                            wallets.platform,
                            escrow.id,
                            creatorAmount,
                            beneficiaryAmount,
                            await nonces.escrow(escrow.id)
                        );

                        const data = await sut.getEscrow(escrow.id);
                        await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                        const sutBalanceBefore = await usdc.balanceOf(sut.target);
                        const wormholeBalanceBefore = await usdc.balanceOf(wormholeRelayer.target);
                        const treasuryBalanceBefore = await usdc.balanceOf(wallets.treasury.address);

                        await sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount);

                        const sutBalanceAfter = await usdc.balanceOf(sut.target);
                        const wormholeBalanceAfter = await usdc.balanceOf(wormholeRelayer.target);
                        const treasuryBalanceAfter = await usdc.balanceOf(wallets.treasury.address);

                        expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
                        expect(wormholeBalanceAfter).to.be.equal(
                            wormholeBalanceBefore + wormholeDestFee + escrow.amount
                        );
                        expect(treasuryBalanceAfter).to.be.equal(treasuryBalanceBefore - wormholeDestFee);
                    });

                    it("Should emit the BridgeFeePaid event", async function () {
                        const { escrow } = fixture;
                        const { sut, wallets, signTypeData, nonces } = await startDispute(fixture, escrow.id);

                        const creatorAmount = 0n;
                        const beneficiaryAmount = escrow.amount;

                        const platformSignature = await signTypeData.resolveDispute(
                            wallets.platform,
                            escrow.id,
                            creatorAmount,
                            beneficiaryAmount,
                            await nonces.escrow(escrow.id)
                        );

                        const data = await sut.getEscrow(escrow.id);
                        await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                        await expect(sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount))
                            .to.emit(sut, "BridgeFeePaid")
                            .withArgs(escrow.id, wormholeDestFee);
                    });
                });

                it("Should transfer the amount to wormhole", async function () {
                    const fixture = await loadFixture(deployBridgedEscrowFixture);
                    const { escrow } = fixture;
                    const { sut, usdc, wormholeRelayer, wallets, signTypeData, nonces } = await setElectedEvmAddress(
                        await startDispute(fixture, escrow.id),
                        fixture.escrow.beneficiary,
                        fixture.wallets.kol
                    );

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const platformSignature = await signTypeData.resolveDispute(
                        wallets.platform,
                        escrow.id,
                        creatorAmount,
                        beneficiaryAmount,
                        await nonces.escrow(escrow.id)
                    );

                    const data = await sut.getEscrow(escrow.id);
                    await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);
                    const sutBalanceBefore = await usdc.balanceOf(sut.target);
                    const wormholeBalanceBefore = await usdc.balanceOf(wormholeRelayer.target);

                    await sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount);

                    const sutBalanceAfter = await usdc.balanceOf(sut.target);
                    const wormholeBalanceAfter = await usdc.balanceOf(wormholeRelayer.target);

                    expect(sutBalanceAfter).to.be.equal(sutBalanceBefore - escrow.amount);
                    expect(wormholeBalanceAfter).to.be.equal(wormholeBalanceBefore + escrow.amount);
                });

                it("Should forward the call to wormhole", async function () {
                    const fixture = await loadFixture(deployBridgedEscrowFixture);
                    const { escrow } = fixture;
                    const { sut, usdc, wormholeRelayer, wallets, signTypeData, nonces } = await setElectedEvmAddress(
                        await startDispute(fixture, escrow.id),
                        fixture.escrow.beneficiary,
                        fixture.wallets.kol
                    );

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const platformSignature = await signTypeData.resolveDispute(
                        wallets.platform,
                        escrow.id,
                        creatorAmount,
                        beneficiaryAmount,
                        await nonces.escrow(escrow.id)
                    );

                    const data = await sut.getEscrow(escrow.id);
                    await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                    await expect(sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount))
                        .to.emit(wormholeRelayer, "TransferTokensWithRelayCalled")
                        .withArgs(usdc.target, escrow.amount, nativeDrop, wormholeDest, escrow.beneficiary);
                });

                it("Should emit the EscrowReleased event", async function () {
                    const fixture = await loadFixture(deployBridgedEscrowFixture);
                    const { escrow } = fixture;
                    const { sut, usdc, wormholeRelayer, wallets, signTypeData, nonces } = await setElectedEvmAddress(
                        await startDispute(fixture, escrow.id),
                        fixture.escrow.beneficiary,
                        fixture.wallets.kol
                    );

                    const messageSequence = 15;
                    await wormholeRelayer.mockMessageSequence(messageSequence);

                    const creatorAmount = 0n;
                    const beneficiaryAmount = escrow.amount;

                    const platformSignature = await signTypeData.resolveDispute(
                        wallets.platform,
                        escrow.id,
                        creatorAmount,
                        beneficiaryAmount,
                        await nonces.escrow(escrow.id)
                    );

                    const data = await sut.getEscrow(escrow.id);
                    await time.setNextBlockTimestamp(data.allowPlatformResolutionTimestamp);

                    await expect(sut.resolveDispute(platformSignature, escrow.id, creatorAmount, beneficiaryAmount))
                        .to.emit(sut, "EscrowReleased")
                        .withArgs(escrow.id, escrow.amount, messageSequence);
                });
            });
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
