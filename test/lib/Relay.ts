import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import { AddressLike, BytesLike, Signature } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { abi } from "../../artifacts/contracts/test/RelayHarness.sol/RelayHarness.json";
import { setPredictableTimestamp } from "../helpers";

const harnessInterface = new ethers.Interface(abi);

describe("Relay", function () {
    // ############################ COMMON FIXTURES ############################

    async function deployFixture() {
        const network = await ethers.provider.getNetwork();
        const chainId = network.chainId;

        const [owner, caller, signer] = await hre.ethers.getSigners();

        const SUT = await hre.ethers.getContractFactory("RelayHarness");
        const sut = await SUT.deploy();
        await sut.waitForDeployment();

        await sut.offsetNonce(caller.address, 5);
        await sut.offsetNonce(signer.address, 50);

        const domains = {
            relay: {
                name: "RelayHarness",
                version: "1",
                chainId,
                verifyingContract: sut.target as string,
            },
        };

        const types = {
            relayRequest: {
                RelayRequest: [
                    { name: "data", type: "bytes" },
                    { name: "relayer", type: "address" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint48" },
                ],
            },
        };

        async function signRelayRequest(
            signer: HardhatEthersSigner,
            data: BytesLike,
            relayer: AddressLike,
            nonce: bigint,
            deadline: bigint
        ) {
            const signed = Signature.from(
                await signer.signTypedData(domains.relay, types.relayRequest, {
                    data,
                    relayer,
                    nonce,
                    deadline,
                })
            );

            return {
                signature: {
                    r: signed.r,
                    s: signed.s,
                    v: signed.v,
                    deadline,
                },
                data,
            };
        }

        return {
            sut,
            sign: {
                relayRequest: signRelayRequest,
            },
            wallets: {
                owner,
                caller,
                signer,
            },
        };
    }

    // ############################ TESTS ############################

    describe("callAsSigner", function () {
        it("should revert if the deadline has expired", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = harnessInterface.encodeFunctionData("setValue", [100]);
            const deadline = (await setPredictableTimestamp()) - 1n;

            const relayRequest = await sign.relayRequest(
                wallets.signer,
                data,
                wallets.caller.address,
                await sut.nonces(wallets.caller.address),
                deadline
            );

            await expect(sut.connect(wallets.caller).callAsSigner(relayRequest)).to.be.revertedWithCustomError(
                sut,
                "ExpiredSignature"
            );
        });

        it("should increment the nonce", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = harnessInterface.encodeFunctionData("setValue", [100]);
            const deadline = (await setPredictableTimestamp()) + 10n;

            const previousNonce = await sut.nonces(wallets.caller.address);

            const relayRequest = await sign.relayRequest(
                wallets.signer,
                data,
                wallets.caller.address,
                previousNonce,
                deadline
            );

            await sut.connect(wallets.caller).callAsSigner(relayRequest);

            expect(await sut.nonces(wallets.caller.address)).to.equal(previousNonce + 1n);
        });

        it("should forward the call as the signer", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const callerAmount = 5n;
            const signerAmount = 100n;

            const data = harnessInterface.encodeFunctionData("setValue", [signerAmount]);
            const deadline = (await setPredictableTimestamp()) + 10n;

            const relayRequest = await sign.relayRequest(
                wallets.signer,
                data,
                wallets.caller.address,
                await sut.nonces(wallets.caller.address),
                deadline
            );

            await sut.connect(wallets.caller).setValue(callerAmount);
            await sut.connect(wallets.caller).callAsSigner(relayRequest);

            expect(await sut.getValue(wallets.caller.address)).to.equal(callerAmount);
            expect(await sut.getValue(wallets.signer.address)).to.equal(signerAmount);
        });

        it("should revert if the call reverts", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = harnessInterface.encodeFunctionData("revertWithError", []);
            const deadline = (await setPredictableTimestamp()) + 10n;

            const relayRequest = await sign.relayRequest(
                wallets.signer,
                data,
                wallets.caller.address,
                await sut.nonces(wallets.caller.address),
                deadline
            );

            await expect(sut.connect(wallets.caller).callAsSigner(relayRequest)).to.be.revertedWithCustomError(
                sut,
                "TestError"
            );
        });
    });

    describe("multiCallAsSigner", function () {
        it("should revert if a deadline has expired", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = [
                harnessInterface.encodeFunctionData("setValue", [100]),
                harnessInterface.encodeFunctionData("addValue", [50]),
            ];

            const deadline = (await setPredictableTimestamp()) - 10n;
            const nonce = await sut.nonces(wallets.caller.address);

            await expect(
                sut
                    .connect(wallets.caller)
                    .multiCallAsSigner([
                        await sign.relayRequest(wallets.signer, data[0], wallets.caller.address, nonce, deadline),
                        await sign.relayRequest(wallets.signer, data[1], wallets.caller.address, nonce + 1n, deadline),
                    ])
            ).to.be.revertedWithCustomError(sut, "ExpiredSignature");
        });

        it("should revert if a call reverts", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = [
                harnessInterface.encodeFunctionData("setValue", [100]),
                harnessInterface.encodeFunctionData("revertWithError", []),
            ];

            const deadline = (await setPredictableTimestamp()) + 10n;
            const nonce = await sut.nonces(wallets.caller.address);

            await expect(
                sut
                    .connect(wallets.caller)
                    .multiCallAsSigner([
                        await sign.relayRequest(wallets.signer, data[0], wallets.caller.address, nonce, deadline),
                        await sign.relayRequest(wallets.signer, data[1], wallets.caller.address, nonce + 1n, deadline),
                    ])
            ).to.be.revertedWithCustomError(sut, "TestError");
        });

        it("should increment the nonce x times", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = [
                harnessInterface.encodeFunctionData("setValue", [100]),
                harnessInterface.encodeFunctionData("addValue", [50]),
            ];

            const deadline = (await setPredictableTimestamp()) + 10n;
            const nonce = await sut.nonces(wallets.caller.address);

            await sut
                .connect(wallets.caller)
                .multiCallAsSigner([
                    await sign.relayRequest(wallets.signer, data[0], wallets.caller.address, nonce, deadline),
                    await sign.relayRequest(wallets.signer, data[1], wallets.caller.address, nonce + 1n, deadline),
                ]);

            expect(await sut.nonces(wallets.caller.address)).to.equal(nonce + 2n);
        });

        it("should forward the calls as the signer", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = [
                harnessInterface.encodeFunctionData("setValue", [100]),
                harnessInterface.encodeFunctionData("addValue", [50]),
            ];

            const deadline = (await setPredictableTimestamp()) + 10n;
            const nonce = await sut.nonces(wallets.caller.address);

            await sut
                .connect(wallets.caller)
                .multiCallAsSigner([
                    await sign.relayRequest(wallets.signer, data[0], wallets.caller.address, nonce, deadline),
                    await sign.relayRequest(wallets.signer, data[1], wallets.caller.address, nonce + 1n, deadline),
                ]);

            expect(await sut.getValue(wallets.signer.address)).to.equal(150n);
        });
    });

    describe("_msgSender", function () {
        it("should return msg.sender if the caller is external", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            await expect(sut.connect(wallets.caller).emitSender())
                .to.emit(sut, "Sender")
                .withArgs(wallets.caller.address);
        });

        it("should return the signer if the caller is the contract", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = harnessInterface.encodeFunctionData("emitSender", []);
            const deadline = (await setPredictableTimestamp()) + 10n;

            const relayRequest = await sign.relayRequest(
                wallets.signer,
                data,
                wallets.caller.address,
                await sut.nonces(wallets.caller.address),
                deadline
            );

            await expect(sut.connect(wallets.caller).callAsSigner(relayRequest))
                .to.emit(sut, "Sender")
                .withArgs(wallets.signer.address);
        });
    });

    describe("_msgData", function () {
        it("should return msg.data if the caller is external", async function () {
            const { sut, wallets } = await loadFixture(deployFixture);

            const data = harnessInterface.encodeFunctionData("emitData", []);

            await expect(sut.connect(wallets.caller).emitData()).to.emit(sut, "Data").withArgs(data);
        });

        it("should return the data without the signer if the caller is the contract", async function () {
            const { sut, sign, wallets } = await loadFixture(deployFixture);

            const data = harnessInterface.encodeFunctionData("emitData", []);
            const deadline = (await setPredictableTimestamp()) + 10n;

            const relayRequest = await sign.relayRequest(
                wallets.signer,
                data,
                wallets.caller.address,
                await sut.nonces(wallets.caller.address),
                deadline
            );

            await expect(sut.connect(wallets.caller).callAsSigner(relayRequest)).to.emit(sut, "Data").withArgs(data);
        });
    });
});
